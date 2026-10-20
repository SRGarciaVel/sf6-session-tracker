/**
 * Phase 5.5 — the reported flicker through the REAL production path against a local Postgres
 * (TEST_DATABASE_URL, guarded): Companion syncs → ingestion → per-character ratings → session →
 * buildPlayerLiveState → public overlay payload.
 *
 *   profile 1829 (session start) → profile 1859 → battlelog-only sync with a new ranked match
 *   (no post-match rating, profile predates it) → profile 1861
 *
 * Fictitious identity (the fixture CFN and name are replaced before anything is stored).
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
const isLocal = (url: string | undefined) => {
  try {
    return !!url && ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};
const RUN = isLocal(TEST_DB);
if (RUN) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { readFileSync } = await import("node:fs");
const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionDevice } = await import("@/server/db/schema");
const { applyCompanionSync } = await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { buildPlayerLiveState, startSession } = await import("@/server/sessions/service");
const { withHeldRatings } = await import("@/domain/overlay/rating-hold");
const { pickRatingCharacter } = await import("@/domain/overlay/state");

const FIXTURE_CFN = "1733837998";
const SIM = "9990000055";

/** Real play.json normalization with Yasmine's MR edited; identity made fictitious. */
function profile(mr: number) {
  const raw = JSON.parse(
    readFileSync(`tests/fixtures/capcom/play-${FIXTURE_CFN}.json`, "utf8"),
  ) as {
    pageProps: {
      play: {
        character_league_infos: Array<{
          character_tool_name: string;
          league_info: Record<string, number>;
        }>;
      };
    };
  };
  const yas = raw.pageProps.play.character_league_infos.find(
    (c) => c.character_tool_name === "yasmine",
  )!;
  yas.league_info.master_rating = mr;
  const p = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: FIXTURE_CFN,
  }).profile;
  return core.toWireProfile({
    ...p,
    cfnUserId: SIM,
    displayName: "SIM",
    favoriteCharacterKey: "yasmine",
  });
}

describe.skipIf(!RUN)("rating continuity through the production path (local DB)", () => {
  const db = RUN ? getDb() : (null as never);
  const users: string[] = [];
  afterAll(async () => {
    if (users.length) await db.delete(authUser).where(inArray(authUser.id, users));
    await closeDb();
  });

  it("a battlelog-only sync after a match holds the last confirmed rating until the profile", async () => {
    const userId = randomUUID();
    users.push(userId);
    await db.insert(authUser).values({ id: userId, name: "SIM", email: `${userId}@test.local` });
    const [device] = await db
      .insert(companionDevice)
      .values({ userId, name: "SIM", tokenHash: randomUUID().replace(/-/g, "") })
      .returning();
    const sync = (body: Record<string, unknown>, now: Date) =>
      applyCompanionSync(
        db,
        device!,
        core.companionSyncRequestSchema.parse({
          cfnUserId: SIM,
          observedAt: now.toISOString(),
          profile: null,
          matches: [],
          gapSuspected: false,
          client: { version: "0.4.0", transport: "service_worker" },
          ...body,
        }),
        now,
      );

    // Onboarding + session start at 1829 (real snapshot provider path).
    expect((await sync({ profile: profile(1829) }, new Date())).ok).toBe(true);
    const provider = new CompanionSF6DataProvider(db, 300_000);
    const player = await upsertPlayerForUser(
      db,
      userId,
      await provider.getPlayerProfile(SIM, { scope: { userId } }),
    );
    await startSession(db, provider, player);

    const t = Date.now() + 60_000; // after the session start, strictly increasing below
    const at = (s: number) => new Date(t + s * 1_000);
    const yasmine = async (nowMs: number) => {
      const live = (await buildPlayerLiveState(db, player.id))!;
      const raw = live.session.characters.find((c) => c.characterKey === "yasmine")!;
      const shown = pickRatingCharacter(withHeldRatings(live, nowMs).session, "yasmine")!;
      return { raw, shown, status: live.session.status };
    };

    // 1. Profile 1859 ⇒ confirmed 1859, +30.
    await sync({ profile: profile(1859), battlelogObserved: false }, at(1));
    let y = await yasmine(at(1).getTime());
    expect(y.status).toBe("active");
    expect(y.raw).toMatchObject({ current: { value: 1859 }, delta: 30 });

    // 2. Battlelog-only sync with the new ranked match (Companion: battlelog every 30 s).
    const match = core.toWireMatch({
      externalMatchId: `SIM-${randomUUID().slice(0, 8)}`,
      playedAt: at(2),
      mode: "ranked",
      result: "win",
      characterKey: "yasmine",
      characterName: "Yasmine",
      opponent: { name: "SIM-OPP", characterKey: "ken", characterName: "Ken" },
      ratingBefore: null,
      ratingAfter: null,
    });
    const res = await sync({ matches: [match], battlelogObserved: true }, at(3));
    expect(res.ok && res.inserted).toBe(1);
    y = await yasmine(at(3).getTime());
    // The engine is honest (post-match rating unknown) and says why…
    expect(y.raw.current).toBeNull();
    expect(y.raw.heldRating).toMatchObject({ current: { value: 1859 }, delta: 30 });
    // …and the overlay projection keeps the last confirmed observation: never "--".
    expect(y.shown).toMatchObject({ current: { value: 1859 }, delta: 30 });

    // 3. Next profile (Companion: play.json every 90 s) ⇒ 1861, authoritative delta +32.
    await sync({ profile: profile(1861), battlelogObserved: false }, at(60));
    y = await yasmine(at(60).getTime());
    expect(y.raw).toMatchObject({ current: { value: 1861 }, delta: 32 });
    expect(y.raw.heldRating ?? null).toBeNull();
  });
});
