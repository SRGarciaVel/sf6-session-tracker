/**
 * DEVELOPMENT ONLY: remove throwaway test accounts (`<x>@test.local`, created by E2E/i18n runs
 * against the dev server) and everything that belongs to them.
 *
 *   pnpm dev:cleanup-test-accounts                 # dry run (default): lists what would go
 *   pnpm dev:cleanup-test-accounts --confirm 11    # delete; N must equal the accounts found now
 *
 * Safety:
 *   - refuses NODE_ENV=production and any non-local DATABASE_URL / APP_URL;
 *   - selector = email domain exactly `test.local` (src/server/dev/test-accounts.ts);
 *     demo@sf6.local and every other account are never touched;
 *   - the delete needs `--confirm <N>` matching the current count, and runs in ONE transaction
 *     that re-checks the selected ids and row counts — any mismatch rolls everything back.
 *
 * Deletion follows the real foreign keys: every table hangs off auth_user with ON DELETE CASCADE
 * (sessions/accounts, player → sessions, matches, overlays, ratings → baselines, overlay
 * connections; companion devices, pairing codes, snapshots). Tables without an FK to the user are
 * deleted explicitly: auth_verification (by email) and this user's rate-limit buckets. Shared
 * mock CFN data (mock_cfn_*) is keyed by CFN, not by user, and is left alone.
 */
import { inArray, sql } from "drizzle-orm";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

function confirmArg(): number | null {
  const i = process.argv.indexOf("--confirm");
  if (i < 0) return null;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0) {
    console.error("--confirm needs the number of accounts shown by the dry run");
    process.exit(1);
  }
  return n;
}

async function main() {
  const { assertLocalDevDatabase, isTestAccountEmail } = await import("@/server/dev/test-accounts");
  const { getEnv } = await import("@/server/env");
  assertLocalDevDatabase(getEnv());
  const confirm = confirmArg();

  const { closeDb, getDb } = await import("@/server/db/client");
  const schema = await import("@/server/db/schema");
  const db = getDb();

  const users = (
    await db.select({ id: schema.authUser.id, email: schema.authUser.email }).from(schema.authUser)
  )
    .filter((u) => isTestAccountEmail(u.email))
    .sort((a, b) => a.email.localeCompare(b.email));
  const ids = users.map((u) => u.id);

  if (users.length === 0) {
    console.log("No @test.local accounts found — nothing to do.");
    await closeDb();
    return;
  }

  // Per-account inventory (counts only — never tokens, hashes or secrets).
  const rows = (await db.execute(sql`
    select u.id as user_id, u.email, p.id as player_id, p.cfn_user_id,
      (select count(*) from game_session s where s.player_id = p.id)::int as sessions,
      (select count(*) from game_session s where s.player_id = p.id and s.status = 'active')::int as active_sessions,
      (select count(*) from match m where m.player_id = p.id)::int as matches,
      (select count(*) from overlay o where o.player_id = p.id)::int as overlays,
      (select count(*) from player_character_rating r where r.player_id = p.id)::int as ratings,
      (select count(*) from session_character_baseline b join game_session s on s.id = b.session_id
        where s.player_id = p.id)::int as baselines,
      (select count(*) from overlay_connection c join overlay o on o.id = c.overlay_id
        where o.player_id = p.id)::int as overlay_connections,
      (select count(*) from auth_session a where a.user_id = u.id)::int as auth_sessions,
      (select count(*) from auth_account a where a.user_id = u.id)::int as auth_accounts,
      (select count(*) from companion_device d where d.user_id = u.id)::int as devices,
      (select count(*) from companion_pairing_code c where c.user_id = u.id)::int as pairing_codes,
      (select count(*) from companion_snapshot c where c.user_id = u.id)::int as snapshots,
      (select count(*) from auth_verification v where v.identifier = u.email)::int as verifications
    from auth_user u left join sf6_player p on p.user_id = u.id
    where u.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
    order by u.email
  `)) as unknown as Array<Record<string, string | number | null>>;

  console.table(
    rows.map((r) => ({
      email: r.email,
      user_id: r.user_id,
      player_id: r.player_id ?? "—",
      cfn: r.cfn_user_id ?? "—",
      sessions: `${r.sessions} (${r.active_sessions} active)`,
      matches: r.matches,
      overlays: r.overlays,
      devices: r.devices,
      snapshots: r.snapshots,
    })),
  );
  const keys = [
    "sessions",
    "matches",
    "overlays",
    "ratings",
    "baselines",
    "overlay_connections",
    "auth_sessions",
    "auth_accounts",
    "devices",
    "pairing_codes",
    "snapshots",
    "verifications",
  ] as const;
  const totals = Object.fromEntries(
    keys.map((k) => [k, rows.reduce((n, r) => n + Number(r[k]), 0)]),
  );
  console.log("rows that would be removed:", {
    accounts: users.length,
    players: rows.filter((r) => r.player_id).length,
    ...totals,
  });

  const outsiders = users.filter((u) => !u.email.toLowerCase().endsWith("@test.local"));
  if (outsiders.length > 0) throw new Error("selector returned a non-test account — aborting");

  if (confirm === null) {
    console.log(`\nDRY RUN — nothing deleted. To delete exactly these ${users.length} accounts:`);
    console.log(`  pnpm dev:cleanup-test-accounts --confirm ${users.length}`);
    await closeDb();
    return;
  }
  if (confirm !== users.length) {
    throw new Error(
      `--confirm ${confirm} does not match the ${users.length} accounts found now — aborting`,
    );
  }

  await db.transaction(async (tx) => {
    const emails = users.map((u) => u.email);
    await tx
      .delete(schema.authVerification)
      .where(inArray(schema.authVerification.identifier, emails));
    for (const id of ids) {
      await tx.execute(sql`delete from rate_limit_bucket where key like ${`%:${id}`}`);
    }
    // Root delete: ON DELETE CASCADE removes the rest (see header).
    const deleted = await tx
      .delete(schema.authUser)
      .where(inArray(schema.authUser.id, ids))
      .returning({ id: schema.authUser.id, email: schema.authUser.email });
    if (deleted.length !== users.length || deleted.some((d) => !isTestAccountEmail(d.email))) {
      throw new Error("deleted set differs from the previewed set — rolling back");
    }
  });
  console.log(`\nDeleted ${users.length} test accounts and their data (one transaction).`);
  await closeDb();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
