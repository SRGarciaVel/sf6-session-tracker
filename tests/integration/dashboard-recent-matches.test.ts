/**
 * Phase 5.6B3 — the dashboard's read-only recent-match projection against Postgres (local
 * TEST_DATABASE_URL only): real ingestion (mock provider → tracker), session boundaries, ranked
 * filter, other players never mixed, capped to the counted total, minimal fields, and only for
 * Fight Session viewers (classic payload unchanged). Fictitious players.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
const isLocal = (u: string | undefined) => {
  try {
    return !!u && ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
};
const RUN = isLocal(TEST_DB);
if (RUN) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, match, sf6Player } = await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { buildPlayerLiveState, endSession, startSession } =
  await import("@/server/sessions/service");
const { buildDashboardLiveState, loadRecentMatches } = await import("@/server/dashboard/state");
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

describe.skipIf(!RUN)("dashboard recent-match projection (integration)", () => {
  const db = RUN ? getDb() : (null as never);
  const mock = RUN ? new MockSF6DataProvider(db) : (null as never);
  const provider = RUN
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);
  const users: string[] = [];

  afterAll(async () => {
    if (users.length) await db.delete(authUser).where(sql`${authUser.id} in ${users}`);
    await closeDb();
  });

  async function newPlayer() {
    const cfn = String(7_100_000_000 + Math.floor(Math.random() * 899_999_999));
    const userId = randomUUID();
    users.push(userId);
    await db.insert(authUser).values({ id: userId, name: "rm", email: `${userId}@test.local` });
    const p = await upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn));
    return { cfn, playerId: p.id };
  }
  const row = async (playerId: string) => {
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    if (!p) throw new Error("player missing");
    return p;
  };
  async function poll(playerId: string) {
    await db.execute(sql`update sf6_player set next_poll_at = now() where id = ${playerId}`);
    const claimed = (await claimDuePlayers(db, "rm", 50, 60_000)).filter((c) => c.id === playerId);
    for (const c of claimed) await pollPlayer(db, provider, c, config, "rm", logger);
  }

  let A: { cfn: string; playerId: string };
  beforeEach(async () => {
    A = await newPlayer();
  });

  it("latest counted matches of the active session: order, numbering, filter, no other players", async () => {
    const B = await newPlayer();
    await startSession(db, provider, await row(A.playerId));
    await startSession(db, provider, await row(B.playerId));
    await mock.simulateMatch(A.cfn, { result: "win", secondsAgo: 30 });
    await mock.simulateMatch(A.cfn, { result: "loss", mode: "casual", secondsAgo: 20 }); // not counted
    await mock.simulateMatch(A.cfn, { result: "loss", secondsAgo: 10 });
    await mock.simulateMatch(B.cfn, { result: "win", secondsAgo: 5 });
    await poll(A.playerId);
    await poll(B.playerId);

    const live = (await buildPlayerLiveState(db, A.playerId))!;
    expect(live.session).toMatchObject({ wins: 1, losses: 1, totalGames: 2 });
    const recent = await loadRecentMatches(db, A.playerId, live.session);
    expect(recent.map((m) => [m.n, m.result])).toEqual([
      [1, "win"],
      [2, "loss"],
    ]);
    // Same results, same order as the engine's recent form.
    expect(recent.map((m) => m.result)).toEqual(live.session.recentResults);
    // Minimal display fields only (no external ids, no rating, no player/session ids).
    expect(Object.keys(recent[0]!).sort()).toEqual(
      [
        "characterName",
        "id",
        "n",
        "opponentCharacter",
        "opponentName",
        "playedAt",
        "result",
      ].sort(),
    );
    // Another player's session id never leaks A's matches (scoped by player too).
    const bLive = (await buildPlayerLiveState(db, B.playerId))!;
    expect(await loadRecentMatches(db, A.playerId, bLive.session)).toEqual([]);
  });

  it("capped to the summary's totalGames when a match lands after the summary was built", async () => {
    await startSession(db, provider, await row(A.playerId));
    await mock.simulateMatch(A.cfn, { result: "win", secondsAgo: 20 });
    await poll(A.playerId);
    const before = (await buildPlayerLiveState(db, A.playerId))!;
    await mock.simulateMatch(A.cfn, { result: "loss", secondsAgo: 5 });
    await poll(A.playerId);
    // A stale summary (1 game) never shows the uncounted second match.
    expect(await loadRecentMatches(db, A.playerId, before.session)).toHaveLength(1);
    const after = (await buildPlayerLiveState(db, A.playerId))!;
    expect(await loadRecentMatches(db, A.playerId, after.session)).toHaveLength(2);
  });

  it("session boundaries: an ended session's matches stay with it; a new session starts empty", async () => {
    await startSession(db, provider, await row(A.playerId));
    await mock.simulateMatch(A.cfn, { result: "win", secondsAgo: 10 });
    await poll(A.playerId);
    await endSession(db, A.playerId, provider);
    const ended = (await buildPlayerLiveState(db, A.playerId))!;
    expect(ended.session.status).toBe("ended");
    expect(await loadRecentMatches(db, A.playerId, ended.session)).toHaveLength(1);
    await startSession(db, provider, await row(A.playerId));
    const fresh = (await buildPlayerLiveState(db, A.playerId))!;
    expect(fresh.session).toMatchObject({ status: "active", totalGames: 0 });
    expect(await loadRecentMatches(db, A.playerId, fresh.session)).toEqual([]);
  });

  it("bounded to the latest 10, numbered by session position; duplicates impossible (unique)", async () => {
    await startSession(db, provider, await row(A.playerId));
    for (let i = 0; i < 12; i++)
      await mock.simulateMatch(A.cfn, { result: i % 3 ? "win" : "loss", secondsAgo: 60 - i * 4 });
    await poll(A.playerId);
    const live = (await buildPlayerLiveState(db, A.playerId))!;
    expect(live.session.totalGames).toBe(12);
    const recent = await loadRecentMatches(db, A.playerId, live.session);
    expect(recent).toHaveLength(10);
    expect(recent[0]!.n).toBe(3);
    expect(recent.at(-1)!.n).toBe(12);
    expect(new Set(recent.map((m) => m.id)).size).toBe(10);
    const counted = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(match)
      .where(eq(match.playerId, A.playerId));
    expect(counted[0]?.count).toBe(12);
  });

  it("only Fight Session viewers get the field; the classic payload is unchanged", async () => {
    await startSession(db, provider, await row(A.playerId));
    await mock.simulateMatch(A.cfn, { result: "win", secondsAgo: 10 });
    await poll(A.playerId);
    const classic = (await buildDashboardLiveState(db, A.playerId))!;
    expect("recentMatches" in classic).toBe(false);
    const fight = (await buildDashboardLiveState(db, A.playerId, undefined, {
      recentMatches: true,
    }))!;
    expect(fight.recentMatches).toHaveLength(1);
    // Same snapshot otherwise.
    expect(fight.live.session.totalGames).toBe(classic.live.session.totalGames);
  });
});
