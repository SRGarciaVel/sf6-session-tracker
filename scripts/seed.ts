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

const DEMO_EMAIL = "demo@sf6.local";
const DEMO_PASSWORD = "demo-password-123";
const DEMO_CFN = "1122334455";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  if ((process.env.SF6_PROVIDER ?? "mock") !== "mock")
    throw new Error("Seed requires SF6_PROVIDER=mock");

  const { getAuth } = await import("@/server/auth/auth");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { authUser, gameSession, match } = await import("@/server/db/schema");
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
    const pattern = [
      { daysAgo: 1, results: "WWLWWWLWLLWWWWWWLWLWWLLWWLWLW" },
      { daysAgo: 3, results: "LWLWWLLWWLWL" },
    ];
    const isMr = profile.masterRate !== null;
    for (const { daysAgo, results } of pattern) {
      const startedAt = new Date(Date.now() - daysAgo * 86_400_000);
      let rating = isMr ? (profile.masterRate ?? 1500) - 60 : (profile.leaguePoints ?? 15000) - 500;
      const initial = rating;
      const rows = [...results].map((c, i) => {
        const win = c === "W";
        rating += isMr ? (win ? 14 : -12) : win ? 110 : -80;
        return {
          playerId: player.id,
          externalMatchId: `seed-${randomBytes(6).toString("hex")}`,
          playedAt: new Date(startedAt.getTime() + (i + 1) * 4 * 60_000),
          mode: "ranked" as const,
          result: win ? ("win" as const) : ("loss" as const),
          playerCharacter: profile.mainCharacter,
          opponentName: `Rival${(i * 7) % 23}`,
          opponentCharacter: SF6_CHARACTERS[(i * 5) % SF6_CHARACTERS.length] ?? null,
          leaguePointsAfter: isMr ? profile.leaguePoints : rating,
          masterRateAfter: isMr ? rating : null,
        };
      });
      const endedAt = new Date(startedAt.getTime() + (results.length + 1) * 4 * 60_000);
      const [session] = await db
        .insert(gameSession)
        .values({
          playerId: player.id,
          status: "ended",
          startedAt,
          endedAt,
          initialRank: profile.rank,
          initialLeaguePoints: isMr ? profile.leaguePoints : initial,
          initialMasterRate: isMr ? initial : null,
          finalRank: profile.rank,
          finalLeaguePoints: isMr ? profile.leaguePoints : rating,
          finalMasterRate: isMr ? rating : null,
          filter: { modes: ["ranked"] },
        })
        .returning();
      if (session)
        await db.insert(match).values(rows.map((r) => ({ ...r, sessionId: session.id })));
    }
  }

  const [overlay] = await listOverlays(db, player.id);
  const appUrl = getEnv().APP_URL.replace(/\/$/, "");
  console.log("\n  Seed complete");
  console.log(`  Login:    ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  Player:   ${player.displayName} (CFN ${DEMO_CFN})`);
  if (overlay) console.log(`  Overlay:  ${appUrl}/overlay/${overlay.publicToken}`);
  console.log(
    "  Next:     pnpm dev → log in → Start session → use Dev tools to simulate matches\n",
  );
  await closeDb();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
