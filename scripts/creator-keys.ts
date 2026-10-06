/**
 * Operator CLI for Creator Keys (docs/creator-keys.md). Runs with the OPERATOR (admin)
 * connection, never the runtime role:
 *
 *   pnpm creator-key:issue  --by <operator> [--note "<who/why>"] [--count N≤20]
 *   pnpm creator-key:list
 *   pnpm creator-key:revoke --id <key id> --by <operator> [--revoke-grant]
 *
 * Environment (shell, or .env locally):
 *   OPERATOR_DATABASE_URL  admin/operator connection. Required; DATABASE_URL is never used.
 *   CREATOR_KEY_PEPPER     must be the SAME pepper the server uses (issue only).
 *
 * The plaintext key is printed ONCE by `issue` and is never stored, logged or shown again.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch {
  // optional: production operators export variables in the shell
}

type Command = "issue" | "list" | "revoke";
const PLACEHOLDER_PEPPER = /change-me|dev-only|not-a-secret/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function die(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function isLocalUrl(url: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function main() {
  const command = process.argv[2] as Command | undefined;
  if (!command || !["issue", "list", "revoke"].includes(command)) {
    die("usage: creator-keys <issue|list|revoke> [options] (see the file header)");
  }
  const url = process.env.OPERATOR_DATABASE_URL;
  if (!url) die("OPERATOR_DATABASE_URL is not set (the runtime DATABASE_URL is never used)");

  const schema = await import("@/server/db/schema");
  const service = await import("@/server/creator-keys/service");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client, { schema });

  try {
    // Refuse early with a clear message if this connection lacks what the command needs
    // (e.g. someone pointed it at the runtime role, which can't issue or revoke).
    const needs: Record<Command, Array<[string, string]>> = {
      issue: [["creator_key", "INSERT"]],
      list: [["creator_key", "SELECT"]],
      revoke: [
        ["creator_key", "UPDATE"],
        ["entitlement_grant", "UPDATE"],
      ],
    };
    for (const [table, privilege] of needs[command]) {
      const [row] = await client<{ ok: boolean }[]>`
        select has_table_privilege(current_user, ${`public.${table}`}, ${privilege}) as ok`;
      if (!row?.ok) {
        die(`this connection lacks ${privilege} on ${table}: use the operator/admin connection`);
      }
    }

    if (command === "issue") {
      const pepper = process.env.CREATOR_KEY_PEPPER;
      if (!pepper || pepper.length < 32) die("CREATOR_KEY_PEPPER must be set (≥ 32 characters)");
      if (PLACEHOLDER_PEPPER.test(pepper) && !isLocalUrl(url)) {
        die("refusing to issue keys with a placeholder pepper against a non-local database");
      }
      const by = arg("by")?.trim();
      if (!by) die("--by <operator> is required (audit trail)");
      const note = arg("note")?.trim() || null;
      if (note && note.length > 200) die("--note is limited to 200 characters");
      const count = Number(arg("count") ?? "1");
      if (!Number.isInteger(count) || count < 1 || count > 20) die("--count must be 1..20");

      console.log(
        `Issuing ${count} Creator Key(s) — ${service.CREATOR_KEY_PLAN}, ` +
          `${service.CREATOR_BETA_GRANT_DAYS}-day grant, redeemable for ` +
          `${service.CREATOR_KEY_REDEEM_WINDOW_DAYS} days.\n`,
      );
      for (let i = 0; i < count; i++) {
        const k = await service.issueCreatorKey(db, { pepper, issuedBy: by, note });
        console.log(
          `  ${k.key}   id=${k.id}  hint=••••-${k.hint}  expires=${k.expiresAt.toISOString()}`,
        );
      }
      console.log("\nCopy the key(s) now: they are NOT stored and cannot be shown again.");
      return;
    }

    if (command === "list") {
      const rows = await service.listCreatorKeys(db);
      console.table(
        rows.map((r) => ({
          id: r.id,
          hint: `••••-${r.hint}`,
          state: r.state,
          issued: r.issuedAt.toISOString(),
          expires: r.expiresAt.toISOString(),
          redeemed: r.redeemedAt?.toISOString() ?? "",
          revoked: r.revokedAt?.toISOString() ?? "",
        })),
      );
      return;
    }

    const id = arg("id");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id))
      die("--id <key id> is required (never the key itself)");
    const by = arg("by")?.trim();
    if (!by) die("--by <operator> is required (audit trail)");
    const res = await service.revokeCreatorKey(db, {
      keyId: id,
      revokedBy: by,
      revokeGrant: flag("revoke-grant"),
    });
    if (!res.found) die(`no Creator Key with id ${id}`);
    console.log(
      `key: ${res.keyRevoked ? "revoked" : "already revoked"}` +
        (res.wasRedeemed
          ? ` · it was redeemed; grant: ${res.grantRevoked ? "revoked" : flag("revoke-grant") ? "already revoked" : "STILL ACTIVE (pass --revoke-grant to remove access)"}`
          : " · it was never redeemed"),
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
