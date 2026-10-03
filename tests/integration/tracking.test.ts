/**
 * End-to-end tracking pipeline against a real Postgres (TEST_DATABASE_URL):
 * mock CFN → tracker → ingestion → session engine. Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, sf6Player } = await import("@/server/db/schema");
const { ingestMatches } = await import("@/server/ingestion/ingest");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { buildPlayerLiveState, endSession, listSessionHistory, startSession } =
  await import("@/server/sessions/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { claimDuePlayers, pollPlayer } = await import("@/server/tracking/tracker");
const { logger } = await import("@/server/logger");

const config = {
  polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
  leaseMs: 60_000,
  profileRefreshMs: 300_000,
  startGraceMs: 0,
};
const silent = logger.child({ test: true });
process.env.LOG_LEVEL = "error";

describe.skipIf(!TEST_DB)("tracking pipeline (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const mock = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  const provider = TEST_DB
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);
  let cfnUserId: string;
  let playerId: string;

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });

  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    cfnUserId = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "Test", email: `${userId}@test.local` });
    const profile = await provider.getPlayerProfile(cfnUserId);
    const player = await upsertPlayerForUser(db, userId, profile);
    playerId = player.id;
  });

  async function currentPlayer() {
    const [p] = await db
      .select()
      .from(sf6Player)
      .where(sql`${sf6Player.id} = ${playerId}`);
    if (!p) throw new Error("player missing");
    return p;
  }

  async function forceDue() {
    await db.execute(sql`update sf6_player set next_poll_at = now() where id = ${playerId}`);
  }

  async function pollOnce(workerId = "test-worker") {
    await forceDue();
    const claimed = await claimDuePlayers(db, workerId, 10, config.leaseMs);
    const mine = claimed.filter((c) => c.id === playerId);
    for (const c of mine) await pollPlayer(db, provider, c, config, workerId, silent);
    return mine.length;
  }

  async function liveSession() {
    const live = await buildPlayerLiveState(db, playerId);
    if (!live) throw new Error("no live state");
    return live.session;
  }

  it("ignores matches played before the session (baseline) and counts new ones", async () => {
    await mock.simulateMatch(cfnUserId, { result: "win", secondsAgo: 3600 });
    await mock.simulateMatch(cfnUserId, { result: "win", secondsAgo: 1800 });

    await startSession(db, provider, await currentPlayer());
    expect((await liveSession()).totalGames).toBe(0);

    await mock.simulateMatch(cfnUserId, { result: "win" });
    await mock.simulateMatch(cfnUserId, { result: "loss" });
    await mock.simulateMatch(cfnUserId, { result: "win" });
    expect(await pollOnce()).toBe(1);

    const s = await liveSession();
    expect(s).toMatchObject({ status: "active", wins: 2, losses: 1, totalGames: 3, winRate: 66.7 });
  });

  it("processing the same matches many times never double-counts", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win" });

    for (let i = 0; i < 5; i++) await pollOnce();
    const matches = await provider.getRecentMatches(cfnUserId);
    const session = await liveSession();
    for (let i = 0; i < 10; i++) {
      await ingestMatches(db, matches, { playerId, sessionId: session.sessionId, startGraceMs: 0 });
    }
    expect((await liveSession()).wins).toBe(1);
  });

  it("casual matches are excluded by the default ranked-only filter", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win", mode: "casual" });
    await mock.simulateMatch(cfnUserId, { result: "loss", mode: "ranked" });
    await pollOnce();
    expect(await liveSession()).toMatchObject({ wins: 0, losses: 1 });
  });

  it("tracks the rating delta from the baseline", async () => {
    await startSession(db, provider, await currentPlayer());
    const before = await liveSession();
    const initial = before.rating.primary.current;
    await mock.simulateMatch(cfnUserId, { result: "win" });
    await pollOnce();
    const after = await liveSession();
    expect(after.rating.primary.initial).toBe(initial);
    expect(after.rating.primary.delta).toBeGreaterThan(0);
  });

  it("a provider outage does not reset or change the score, and backs off", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win" });
    await pollOnce();

    await mock.setOutage(cfnUserId, 60);
    await pollOnce();
    const p = await currentPlayer();
    expect(p.consecutiveFailures).toBe(1);
    expect(p.lastError).toMatch(/unavailable/);
    expect(p.nextPollAt!.getTime() - Date.now()).toBeGreaterThan(20_000);
    expect((await liveSession()).wins).toBe(1);

    await mock.setOutage(cfnUserId, 0);
    await mock.simulateMatch(cfnUserId, { result: "win" });
    await pollOnce();
    expect((await liveSession()).wins).toBe(2);
    expect((await currentPlayer()).consecutiveFailures).toBe(0);
  });

  it("two workers never hold the same player's lease", async () => {
    await startSession(db, provider, await currentPlayer());
    await forceDue();
    const a = (await claimDuePlayers(db, "worker-a", 50, 60_000)).filter((c) => c.id === playerId);
    const b = (await claimDuePlayers(db, "worker-b", 50, 60_000)).filter((c) => c.id === playerId);
    expect(a.length + b.length).toBe(1);
    // An expired lease can be taken over.
    await db.execute(
      sql`update sf6_player set lease_expires_at = now() - interval '1 second' where id = ${playerId}`,
    );
    const c = (await claimDuePlayers(db, "worker-c", 50, 60_000)).filter((x) => x.id === playerId);
    expect(c).toHaveLength(1);
  });

  it("ended sessions stop tracking; a new session starts from zero", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win" });
    await pollOnce();
    await endSession(db, playerId);

    expect(await pollOnce()).toBe(0); // not claimable
    const ended = await liveSession();
    expect(ended).toMatchObject({ status: "ended", wins: 1 });

    await startSession(db, provider, await currentPlayer());
    expect(await liveSession()).toMatchObject({ status: "active", wins: 0, losses: 0 });
    await mock.simulateMatch(cfnUserId, { result: "loss" });
    await pollOnce();
    expect(await liveSession()).toMatchObject({ wins: 0, losses: 1 });

    const history = await listSessionHistory(db, await currentPlayer());
    expect(history.map((h) => [h.summary.wins, h.summary.losses])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("starting a new session while one is active ends it and keeps its late matches", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win" });
    // No poll in between: the restart itself must attribute this match to the old session.
    await startSession(db, provider, await currentPlayer());
    const history = await listSessionHistory(db, await currentPlayer());
    expect(history[0]?.summary).toMatchObject({ status: "active", totalGames: 0 });
    expect(history[1]?.summary).toMatchObject({ status: "ended", wins: 1 });
  });

  it("ending a session does a final fetch so a just-finished match still counts", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.simulateMatch(cfnUserId, { result: "win" });
    // No poll: the match finished right before the streamer clicked "End session".
    await endSession(db, playerId, provider);
    expect(await liveSession()).toMatchObject({ status: "ended", wins: 1 });
  });

  it("ending a session still works when CFN is down", async () => {
    await startSession(db, provider, await currentPlayer());
    await mock.setOutage(cfnUserId, 60);
    await endSession(db, playerId, provider);
    expect((await liveSession()).status).toBe("ended");
    await mock.setOutage(cfnUserId, 0);
  });

  it("only one active session can exist per player (DB constraint)", async () => {
    await startSession(db, provider, await currentPlayer());
    await expect(
      db.execute(
        sql`insert into game_session (player_id, status, filter) values (${playerId}, 'active', '{"modes":["ranked"]}')`,
      ),
    ).rejects.toThrow();
  });
});
