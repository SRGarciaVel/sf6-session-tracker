/**
 * DEVELOPMENT ONLY: point an existing account at a different CFN (e.g. the seeded demo account
 * → your real CFN, to test the browser companion).
 *
 *   pnpm dev:reassign-cfn --email demo@sf6.local --cfn 1733837998 --dry-run
 *   pnpm dev:reassign-cfn --email demo@sf6.local --cfn 1733837998
 *
 * Uses the same service as the onboarding "change CFN" flow (upsertPlayerForUser): in ONE
 * transaction it removes the OLD CFN's sessions (active included), matches and character
 * ratings, keeps the account's overlays (same OBS URLs) and companion devices, and re-points the
 * player to the new CFN. Nothing of other accounts is touched.
 *
 * Profile for the new CFN: the companion snapshot of that CFN if this account owns one, else a
 * placeholder (name "CFN <id>", no characters) that the companion's first sync replaces.
 * Refuses to run with NODE_ENV=production. No CFN is hardcoded.
 */
import { and, count, eq, like } from "drizzle-orm";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to run in production");
  const email = arg("email");
  const cfnArg = arg("cfn");
  const dryRun = process.argv.includes("--dry-run");
  if (!email || !cfnArg) {
    console.error(
      "Usage: pnpm dev:reassign-cfn --email <account email> --cfn <CFN id> [--dry-run]",
    );
    process.exit(1);
  }

  const { cfnUserIdSchema } = await import("@sf6/capcom-core");
  const { closeDb, getDb } = await import("@/server/db/client");
  const schema = await import("@/server/db/schema");
  const { findPlayerByUserId, upsertPlayerForUser } = await import("@/server/players/service");
  const { buildCompanionState } = await import("@/server/companion/service");

  const cfn = cfnUserIdSchema.parse(cfnArg);
  const db = getDb();
  const [user] = await db.select().from(schema.authUser).where(eq(schema.authUser.email, email));
  if (!user) throw new Error(`No account with email ${email}`);
  const player = await findPlayerByUserId(db, user.id);

  const counts = async (playerId: string) => {
    const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    return {
      activeSessions: await one(
        db
          .select({ n: count() })
          .from(schema.gameSession)
          .where(
            and(eq(schema.gameSession.playerId, playerId), eq(schema.gameSession.status, "active")),
          ),
      ),
      sessions: await one(
        db
          .select({ n: count() })
          .from(schema.gameSession)
          .where(eq(schema.gameSession.playerId, playerId)),
      ),
      matches: await one(
        db.select({ n: count() }).from(schema.match).where(eq(schema.match.playerId, playerId)),
      ),
      seedMatches: await one(
        db
          .select({ n: count() })
          .from(schema.match)
          .where(
            and(eq(schema.match.playerId, playerId), like(schema.match.externalMatchId, "seed-%")),
          ),
      ),
      mockMatches: await one(
        db
          .select({ n: count() })
          .from(schema.match)
          .where(
            and(eq(schema.match.playerId, playerId), like(schema.match.externalMatchId, "mock-%")),
          ),
      ),
      characterRatings: await one(
        db
          .select({ n: count() })
          .from(schema.playerCharacterRating)
          .where(eq(schema.playerCharacterRating.playerId, playerId)),
      ),
      overlays: await one(
        db.select({ n: count() }).from(schema.overlay).where(eq(schema.overlay.playerId, playerId)),
      ),
    };
  };

  console.log(`account: ${email}`);
  if (player) {
    console.log(`current player: CFN ${player.cfnUserId} (${player.displayName})`);
    console.log("current data:", await counts(player.id));
    if (player.cfnUserId === cfn) {
      console.log(`already on CFN ${cfn} — nothing to do`);
      await closeDb();
      return;
    }
  } else {
    console.log("current player: none");
  }

  const [snapshot] = await db
    .select()
    .from(schema.companionSnapshot)
    .where(
      and(
        eq(schema.companionSnapshot.cfnUserId, cfn),
        eq(schema.companionSnapshot.userId, user.id),
      ),
    );
  const profile = snapshot?.profile ?? {
    cfnUserId: cfn,
    displayName: `CFN ${cfn}`,
    favoriteCharacterKey: null,
    characters: [],
  };
  console.log(
    `new CFN ${cfn} profile source: ${snapshot?.profile ? "companion snapshot" : "placeholder (first companion sync fills it)"}`,
  );

  if (dryRun) {
    console.log(
      "\nDRY RUN — would delete the OLD CFN's sessions/matches/ratings above, keep overlays + devices.",
    );
    await closeDb();
    return;
  }

  const updated = await upsertPlayerForUser(db, user.id, profile);
  console.log(`\nreassigned: player ${updated.id} → CFN ${updated.cfnUserId}`);
  console.log("data now:", await counts(updated.id));
  const state = await buildCompanionState(db, user.id);
  console.log("companion state (same function as GET /api/companion/state):", {
    cfnUserId: state.cfnUserId,
    displayName: state.displayName,
    activeSession: state.activeSession,
    knownReplayIds: state.knownReplayIds.length,
    ingestEnabled: state.ingestEnabled,
  });
  await closeDb();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
