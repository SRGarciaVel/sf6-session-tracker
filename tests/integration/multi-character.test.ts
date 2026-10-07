/**
 * Per-character ratings end-to-end against Postgres: baselines at start, active character,
 * independent deltas, characters outside the baseline, frozen finals, history, legacy sessions.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, mockCfnCharacter, sessionCharacterBaseline, sf6Player } =
  await import("@/server/db/schema");
const { upsertPlayerForUser, updatePlayerProfile, listPlayerCharacters } =
  await import("@/server/players/service");
const { buildPlayerLiveState, endSession, listSessionHistory, startSession } =
  await import("@/server/sessions/service");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { listOverlays, updateOverlay } = await import("@/server/overlays/service");
const { pickRatingCharacter, resolveOverlayStats } = await import("@/domain/overlay/state");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { claimDuePlayers, pollPlayer } = await import("@/server/tracking/tracker");
const { logger } = await import("@/server/logger");

const config = {
  polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
  leaseMs: 60_000,
  profileRefreshMs: 300_000,
  startGraceMs: 90_000,
};

describe.skipIf(!TEST_DB)("per-character ratings (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const mock = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  const provider = TEST_DB
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);
  let cfn: string;
  let playerId: string;

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    cfn = String(7_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "mc", email: `${userId}@test.local` });
    playerId = (await upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn))).id;
  });

  async function player() {
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    if (!p) throw new Error("player missing");
    return p;
  }
  async function poll() {
    await db.execute(sql`update sf6_player set next_poll_at = now() where id = ${playerId}`);
    const claimed = (await claimDuePlayers(db, "mc", 50, 60_000)).filter((c) => c.id === playerId);
    for (const c of claimed) await pollPlayer(db, provider, c, config, "mc", logger);
  }
  async function live() {
    const l = await buildPlayerLiveState(db, playerId);
    if (!l) throw new Error("no live state");
    return l.session;
  }
  const char = (s: Awaited<ReturnType<typeof live>>, key: string) =>
    s.characters.find((c) => c.characterKey === key);
  async function mockRating(key: string) {
    const [row] = await db
      .select()
      .from(mockCfnCharacter)
      .where(and(eq(mockCfnCharacter.cfnUserId, cfn), eq(mockCfnCharacter.characterKey, key)));
    if (!row) throw new Error(`no mock ${key}`);
    return row;
  }

  it("captures a baseline for EVERY character at session start", async () => {
    const session = await startSession(db, provider, await player());
    const rows = await db
      .select()
      .from(sessionCharacterBaseline)
      .where(eq(sessionCharacterBaseline.sessionId, session.id));
    expect(rows.map((r) => r.characterKey).sort()).toEqual(["aki", "cammy", "kimberly"]);
    expect(rows.every((r) => r.source === "session_start")).toBe(true);
    const aki = rows.find((r) => r.characterKey === "aki");
    expect(aki).toMatchObject({ initialRatingSystem: "lp", initialMasterRate: null });
    const kim = rows.find((r) => r.characterKey === "kimberly");
    expect(kim?.initialRatingSystem).toBe("mr");
  });

  it("A.K.I. (LP) then Kimberly (MR): global W/L sums, ratings stay separate, active switches", async () => {
    await startSession(db, provider, await player());
    const akiStart = (await mockRating("aki")).leaguePoints;
    const kimStart = (await mockRating("kimberly")).masterRate;

    await mock.simulateMatch(cfn, { result: "win" }); // A.K.I.
    await poll();
    let s = await live();
    const akiAfter = (await mockRating("aki")).leaguePoints;
    expect(s).toMatchObject({ wins: 1, activeCharacterKey: "aki" });
    expect(char(s, "aki")?.delta).toBe(akiAfter - akiStart);

    await mock.setCharacter(cfn, "kimberly");
    await mock.simulateMatch(cfn, { result: "win" }); // Kimberly
    await poll();
    s = await live();
    const kimAfter = (await mockRating("kimberly")).masterRate ?? 0;
    expect(s).toMatchObject({ wins: 2, losses: 0, activeCharacterKey: "kimberly" });
    expect(char(s, "kimberly")).toMatchObject({
      ratingSystem: "mr",
      delta: kimAfter - (kimStart ?? 0),
    });
    // A.K.I. keeps exactly its own progress.
    expect(char(s, "aki")).toMatchObject({
      ratingSystem: "lp",
      delta: akiAfter - akiStart,
      wins: 1,
    });
    // Cammy was not played: no change.
    expect(char(s, "cammy")).toMatchObject({ games: 0, delta: 0 });
  });

  it("overlay: global W/L + active character; a pinned character overrides it", async () => {
    await startSession(db, provider, await player());
    await mock.simulateMatch(cfn, { result: "win" });
    await mock.setCharacter(cfn, "kimberly");
    await mock.simulateMatch(cfn, { result: "loss" });
    await poll();
    const [overlay] = await listOverlays(db, playerId);
    if (!overlay) throw new Error("no overlay");

    let payload = (await loadOverlayPayload(overlay.publicToken))?.payload;
    expect(payload?.live.session).toMatchObject({ wins: 1, losses: 1 });
    expect(
      pickRatingCharacter(payload!.live.session, payload!.config.ratingCharacterKey)?.characterKey,
    ).toBe("kimberly");

    await updateOverlay(db, overlay, { config: { ...overlay.config, ratingCharacterKey: "aki" } });
    payload = (await loadOverlayPayload(overlay.publicToken))?.payload;
    expect(
      pickRatingCharacter(payload!.live.session, payload!.config.ratingCharacterKey)?.characterKey,
    ).toBe("aki");
    expect(payload?.live.session).toMatchObject({ wins: 1, losses: 1 });
  });

  it("character outside the baseline: ratingBefore ⇒ delta; no ratingBefore ⇒ delta null", async () => {
    await startSession(db, provider, await player());
    await mock.setCharacter(cfn, "sagat"); // added AFTER the session started
    await mock.simulateMatch(cfn, { result: "win", omitRatingBefore: true });
    await poll();
    let sagat = char(await live(), "sagat");
    expect(sagat).toMatchObject({ wins: 1, baselineKnown: false, delta: null });
    expect(sagat?.current?.value).toBeGreaterThan(0);

    // New session: Sagat now exists in the profile → in the baseline.
    await startSession(db, provider, await player());
    await mock.simulateMatch(cfn, { result: "win" });
    await poll();
    sagat = char(await live(), "sagat");
    expect(sagat?.baselineKnown).toBe(true);
    expect(sagat?.delta).toBeGreaterThan(0);
  });

  it("ending a session freezes per-character finals; later profile changes don't rewrite history", async () => {
    const session = await startSession(db, provider, await player());
    await mock.simulateMatch(cfn, { result: "win" });
    await mock.setCharacter(cfn, "kimberly");
    await mock.simulateMatch(cfn, { result: "win" });
    await poll();
    await endSession(db, playerId, provider);

    const finals = await db
      .select()
      .from(sessionCharacterBaseline)
      .where(eq(sessionCharacterBaseline.sessionId, session.id));
    expect(finals.filter((r) => r.finalizedAt).length).toBe(3);
    const before = (await listSessionHistory(db, await player())).find((h) => h.id === session.id);

    // Play more after the session ended (next session).
    await startSession(db, provider, await player());
    for (let i = 0; i < 3; i++) await mock.simulateMatch(cfn, { result: "loss" });
    await poll();

    const history = await listSessionHistory(db, await player());
    const closed = history.find((h) => h.id === session.id);
    expect(closed?.summary.characters).toEqual(before?.summary.characters);
    const open = history[0];
    expect(open?.summary).toMatchObject({ status: "active", losses: 3, wins: 0 });
    // Independent progress per session and character.
    const kimClosed = closed?.summary.characters.find((c) => c.characterKey === "kimberly");
    const kimOpen = open?.summary.characters.find((c) => c.characterKey === "kimberly");
    expect(kimClosed?.delta).toBeGreaterThan(0);
    expect(kimOpen?.delta).toBeLessThan(0);
  });

  it("legacy sessions keep W/L and ignore the global baseline (no invented delta)", async () => {
    const session = await startSession(db, provider, await player());
    // Legacy (pre-migration) matches carry no ratingBefore.
    await mock.simulateMatch(cfn, { result: "win", omitRatingBefore: true });
    await poll();
    await db
      .update(gameSession)
      .set({ ratingModel: "legacy" })
      .where(eq(gameSession.id, session.id));
    const s = await live();
    expect(s).toMatchObject({ ratingModel: "legacy", wins: 1 });
    expect(s.characters.filter((c) => c.games > 0).every((c) => c.delta === null)).toBe(true);
    expect(s.characters.filter((c) => c.games > 0).every((c) => !c.baselineKnown)).toBe(true);
  });

  it("an older profile snapshot never overwrites a newer per-character rating", async () => {
    const profile = await provider.getPlayerProfile(cfn);
    const newer = {
      ...profile,
      characters: profile.characters.map((c) =>
        c.characterKey === "aki" ? { ...c, leaguePoints: 22222 } : c,
      ),
    };
    await updatePlayerProfile(db, playerId, newer, new Date(Date.now() + 60_000));
    await updatePlayerProfile(db, playerId, profile, new Date(Date.now() - 60_000));
    const aki = (await listPlayerCharacters(db, playerId)).find((c) => c.characterKey === "aki");
    expect(aki?.leaguePoints).toBe(22222);
  });

  it("duplicate characterKey in a profile does not break the upsert", async () => {
    const profile = await provider.getPlayerProfile(cfn);
    const first = profile.characters[0];
    if (!first) throw new Error("no character");
    await expect(
      updatePlayerProfile(db, playerId, { ...profile, characters: [...profile.characters, first] }),
    ).resolves.toBeTypeOf("boolean");
  });

  it("Phase 5.1: per-character stats through real ingestion; overlay payload projects either scope", async () => {
    await startSession(db, provider, await player());
    await mock.simulateMatch(cfn, { result: "win" }); // A.K.I.
    await mock.simulateMatch(cfn, { result: "win" }); // A.K.I.
    await mock.setCharacter(cfn, "kimberly");
    await mock.simulateMatch(cfn, { result: "loss" }); // Kimberly
    await mock.setCharacter(cfn, "aki");
    await mock.simulateMatch(cfn, { result: "win" }); // A.K.I.
    await poll();
    await poll(); // re-polling the same matches never counts them twice

    const s = await live();
    expect(s).toMatchObject({ wins: 3, losses: 1, totalGames: 4, currentWinStreak: 1 });
    // Kimberly's loss doesn't interrupt A.K.I.'s own streak.
    expect(char(s, "aki")).toMatchObject({
      wins: 3,
      losses: 0,
      games: 3,
      winRate: 100,
      currentWinStreak: 3,
      bestWinStreak: 3,
      recentResults: ["win", "win", "win"],
    });
    expect(char(s, "kimberly")).toMatchObject({
      wins: 0,
      losses: 1,
      currentLossStreak: 1,
      recentResults: ["loss"],
    });
    expect(char(s, "cammy")).toMatchObject({ games: 0, wins: 0, recentResults: [] });
    const played = s.characters.filter((c) => c.games > 0);
    expect(played.reduce((n, c) => n + c.games, 0)).toBe(s.totalGames);

    const [overlay] = await listOverlays(db, playerId);
    if (!overlay) throw new Error("no overlay");
    let payload = (await loadOverlayPayload(overlay.publicToken))?.payload;
    expect(resolveOverlayStats(payload!.live.session, payload!.config)).toMatchObject({
      scope: "session",
      wins: 3,
      losses: 1,
    });
    await updateOverlay(db, overlay, {
      config: { ...overlay.config, statsScope: "character", ratingCharacterKey: "kimberly" },
    });
    payload = (await loadOverlayPayload(overlay.publicToken))?.payload;
    expect(payload?.config.statsScope).toBe("character");
    expect(resolveOverlayStats(payload!.live.session, payload!.config)).toMatchObject({
      scope: "character",
      characterKey: "kimberly",
      wins: 0,
      losses: 1,
    });
    // The global numbers in the payload are unchanged (projection is presentation only).
    expect(payload?.live.session).toMatchObject({ wins: 3, losses: 1 });
  });
});
