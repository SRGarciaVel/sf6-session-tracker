/**
 * Development seed: a demo account + mock CFN player + overlay + two past sessions.
 *
 *   pnpm db:seed
 *
 * Login: demo@sf6.local / demo-password-123
 * Refuses to run against production or a non-mock provider.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  if ((process.env.SF6_PROVIDER ?? "mock") !== "mock")
    throw new Error("Seed requires SF6_PROVIDER=mock");

  const { DEMO_CFN, DEMO_EMAIL, DEMO_PASSWORD } = await import("@/server/dev/demo");
  const { getAuth } = await import("@/server/auth/auth");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { authUser, gameSession, match, sessionCharacterBaseline } =
    await import("@/server/db/schema");
  const { getEnv } = await import("@/server/env");
  const { listOverlays } = await import("@/server/overlays/service");
  const { upsertPlayerForUser } = await import("@/server/players/service");
  const { getSF6DataProvider } = await import("@/server/sf6");
  const { SF6_CHARACTERS } = await import("@/server/sf6/providers/mock");

  const db = getDb();
  let [user] = await db.select().from(authUser).where(eq(authUser.email, DEMO_EMAIL));
  if (!user) {
    await getAuth().api.signUpEmail({
      body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Demo Streamer" },
    });
    [user] = await db.select().from(authUser).where(eq(authUser.email, DEMO_EMAIL));
  }
  if (!user) throw new Error("Could not create demo user");

  const profile = await getSF6DataProvider().getPlayerProfile(DEMO_CFN);
  const player = await upsertPlayerForUser(db, user.id, profile);

  const existing = await db
    .select({ id: gameSession.id })
    .from(gameSession)
    .where(eq(gameSession.playerId, player.id));
  if (existing.length === 0) {
    // Two closed multi-character sessions with per-character baselines and frozen finals.
    const plans = [
      {
        daysAgo: 1,
        legs: [
          { key: "aki", results: "WWLWWLW" },
          { key: "kimberly", results: "WLW" },
        ],
      },
      { daysAgo: 3, legs: [{ key: "kimberly", results: "LWWLWL" }] },
    ];
    for (const { daysAgo, legs } of plans) {
      const startedAt = new Date(Date.now() - daysAgo * 86_400_000);
      const [session] = await db
        .insert(gameSession)
        .values({
          playerId: player.id,
          status: "ended",
          startedAt,
          endedAt: new Date(startedAt.getTime() + 2 * 3_600_000),
          filter: { modes: ["ranked"] },
          ratingModel: "per_character",
        })
        .returning();
      if (!session) continue;
      let minute = 0;
      for (const leg of legs) {
        const char = profile.characters.find((c) => c.characterKey === leg.key);
        if (!char || !char.ratingSystem) continue;
        const system = char.ratingSystem;
        const step = system === "mr" ? { win: 14, loss: -12 } : { win: 110, loss: -80 };
        let rating = (system === "mr" ? char.masterRate : char.leaguePoints) ?? 0;
        rating -= [...leg.results].reduce((n, c) => n + (c === "W" ? step.win : step.loss), 0);
        const initial = rating;
        const rows = [...leg.results].map((c) => {
          const win = c === "W";
          const before = rating;
          rating += win ? step.win : step.loss;
          minute += 4;
          return {
            sessionId: session.id,
            playerId: player.id,
            externalMatchId: `seed-${randomBytes(6).toString("hex")}`,
            playedAt: new Date(startedAt.getTime() + minute * 60_000),
            mode: "ranked" as const,
            result: win ? ("win" as const) : ("loss" as const),
            characterKey: char.characterKey,
            characterName: char.characterName,
            opponentName: `Rival${minute % 23}`,
            opponentCharacter: SF6_CHARACTERS[minute % SF6_CHARACTERS.length] ?? null,
            ratingBeforeSystem: system,
            ratingBeforeValue: before,
            ratingAfterSystem: system,
            ratingAfterValue: rating,
          };
        });
        await db.insert(match).values(rows);
        const value = (v: number) => ({
          lp: system === "lp" ? v : null,
          mr: system === "mr" ? v : null,
        });
        await db.insert(sessionCharacterBaseline).values({
          sessionId: session.id,
          characterKey: char.characterKey,
          characterName: char.characterName,
          source: "session_start",
          initialRank: char.rank,
          initialRatingSystem: system,
          initialLeaguePoints: value(initial).lp,
          initialMasterRate: value(initial).mr,
          finalRank: char.rank,
          finalRatingSystem: system,
          finalLeaguePoints: value(rating).lp,
          finalMasterRate: value(rating).mr,
          capturedAt: startedAt,
          finalizedAt: session.endedAt,
        });
      }
    }
  }

  const [overlay] = await listOverlays(db, player.id);
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  console.log("\n  Seed complete");
  console.log(`  Login:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Player:   ${player.displayName} (CFN ${DEMO_CFN} — FAKE mock id, demo data only)`);
  if (overlay) console.log(`  Overlay:  ${appUrl}/overlay/${overlay.publicToken}`);
  console.log("  Next:     pnpm dev → log in → Start session → use Dev tools to simulate matches");
  console.log(
    "  Real CFN: pnpm dev:reassign-cfn --email <account> --cfn <your CFN>  (before using the companion)\n",
  );
  await closeDb();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
