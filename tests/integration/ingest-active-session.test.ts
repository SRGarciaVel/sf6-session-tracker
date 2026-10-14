/**
 * Ingestion only assigns matches to an ACTIVE session (real Postgres, TEST_DATABASE_URL).
 *
 * The race: a caller resolves the active session, then waits for the session row lock while
 * another transaction ends it. Under the lock the session must be re-checked: a match that
 * arrives after the end is stored as history (session_id NULL) and the ended session — stats and
 * frozen final ratings — is never mutated. Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedSF6Match } from "@/domain/sf6/types";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, match, sessionCharacterBaseline, sf6Player } =
  await import("@/server/db/schema");
const { ingestMatches } = await import("@/server/ingestion/ingest");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { endSession, getActiveSession, startSession, summarizeSessionRow } =
  await import("@/server/sessions/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");

describe.skipIf(!TEST_DB)("ingestion only assigns matches to active sessions", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const provider = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  let playerId: string;
  let seq = 0;

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    const cfnUserId = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(
      0,
      10,
    );
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "Test", email: `${userId}@test.local` });
    const player = await upsertPlayerForUser(
      db,
      userId,
      await provider.getPlayerProfile(cfnUserId),
    );
    playerId = player.id;
  });

  /** A ranked match played now (inside the session window). */
  function rankedMatch(result: "win" | "loss" = "win"): NormalizedSF6Match {
    seq++;
    return {
      externalMatchId: `race-${playerId}-${seq}`,
      playedAt: new Date(),
      mode: "ranked",
      result,
      characterKey: "ryu",
      characterName: "Ryu",
      opponent: { name: null, characterKey: "ken", characterName: "Ken", rank: null },
    };
  }

  async function player() {
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    if (!p) throw new Error("player missing");
    return p;
  }

  async function startedSessionId(): Promise<string> {
    const s = await startSession(db, provider, await player());
    return s.id;
  }

  async function sessionOf(externalMatchId: string): Promise<string | null | undefined> {
    const rows = await db
      .select({ sessionId: match.sessionId })
      .from(match)
      .where(and(eq(match.playerId, playerId), eq(match.externalMatchId, externalMatchId)));
    expect(rows.length).toBeLessThanOrEqual(1);
    return rows[0]?.sessionId;
  }

  async function matchCount(): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(match)
      .where(eq(match.playerId, playerId));
    return row?.n ?? 0;
  }

  async function sessionRow(id: string) {
    const [row] = await db.select().from(gameSession).where(eq(gameSession.id, id));
    if (!row) throw new Error("session missing");
    return row;
  }

  /**
   * The race only matters for a match played BEFORE the end (a later one is already excluded by
   * the session's time window): assert that, so only the status re-check can keep it out.
   */
  async function expectPlayedBeforeEnd(m: NormalizedSF6Match, sessionId: string) {
    const { endedAt } = await sessionRow(sessionId);
    expect(endedAt).not.toBeNull();
    expect(m.playedAt.getTime()).toBeLessThanOrEqual(endedAt?.getTime() ?? 0);
  }

  async function frozenFinals(sessionId: string) {
    return db
      .select()
      .from(sessionCharacterBaseline)
      .where(eq(sessionCharacterBaseline.sessionId, sessionId))
      .orderBy(sessionCharacterBaseline.characterKey);
  }

  async function totalGames(sessionId: string): Promise<number> {
    return (await summarizeSessionRow(db, await sessionRow(sessionId), await player())).totalGames;
  }

  /**
   * Holds the session row lock in its own transaction until `release()`. `pid` is the backend
   * holding it, used to detect when other transactions are queued behind it.
   */
  async function holdSessionLock(sessionId: string) {
    let release!: (endIt: boolean) => void;
    const released = new Promise<boolean>((r) => (release = r));
    let pid!: number;
    let ready!: () => void;
    const locked = new Promise<void>((r) => (ready = r));
    const done = db.transaction(async (tx) => {
      await tx.select().from(gameSession).where(eq(gameSession.id, sessionId)).for("update");
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      pid = Number(row?.pid);
      ready();
      if (await released) {
        // "Another transaction ends the session" while ingestion waits for the lock.
        await tx
          .update(gameSession)
          .set({ status: "ended", endedAt: sql`now()` })
          .where(eq(gameSession.id, sessionId));
      }
    });
    await locked;
    return { pid, release, done };
  }

  /** Waits until `count` backends are queued (directly or transitively) behind `holderPid`. */
  async function waitForWaiters(holderPid: number, count: number) {
    for (let i = 0; i < 200; i++) {
      const [row] = await db.execute<{ n: number }>(sql`
        with recursive blocked(pid) as (
          select a.pid from pg_stat_activity a where ${holderPid} = any(pg_blocking_pids(a.pid))
          union
          select a.pid from pg_stat_activity a join blocked b on b.pid = any(pg_blocking_pids(a.pid))
        )
        select count(*)::int as n from blocked
      `);
      if (Number(row?.n) >= count) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${count} lock waiter(s)`);
  }

  it("1. normal active-session ingestion assigns the match to the session", async () => {
    const sessionId = await startedSessionId();
    const m = rankedMatch();
    const res = await ingestMatches(db, [m], { playerId, sessionId, startGraceMs: 0 });
    expect(res).toMatchObject({ inserted: 1, countedInSession: 1, duplicates: 0 });
    expect(await sessionOf(m.externalMatchId)).toBe(sessionId);
    expect(await totalGames(sessionId)).toBe(1);
  });

  it("2. a session resolved as active, then ended, receives no late match (stale id)", async () => {
    const sessionId = await startedSessionId();
    const counted = rankedMatch();
    await ingestMatches(db, [counted], { playerId, sessionId, startGraceMs: 0 });

    // The poller resolved the active session and fetched a match before the end …
    const resolved = await getActiveSession(db, playerId);
    expect(resolved?.id).toBe(sessionId);
    const late = rankedMatch("loss");
    await endSession(db, playerId);
    await expectPlayedBeforeEnd(late, sessionId);
    const finalsBefore = await frozenFinals(sessionId);
    const endedBefore = await sessionRow(sessionId);

    // … and ingests afterwards with that stale id.
    const res = await ingestMatches(db, [late], {
      playerId,
      sessionId: resolved?.id ?? null,
      startGraceMs: 0,
    });
    expect(res).toMatchObject({ inserted: 1, countedInSession: 0 });
    expect(await sessionOf(late.externalMatchId)).toBeNull();
    expect(await sessionOf(counted.externalMatchId)).toBe(sessionId);
    expect(await totalGames(sessionId)).toBe(1);
    expect(await frozenFinals(sessionId)).toEqual(finalsBefore);
    expect(await sessionRow(sessionId)).toEqual(endedBefore);
  });

  it("3–4. the session ends while ingestion waits for the lock → the match becomes history", async () => {
    const sessionId = await startedSessionId();
    const finalsBefore = await frozenFinals(sessionId);
    const late = rankedMatch();
    const lock = await holdSessionLock(sessionId);

    const ingest = ingestMatches(db, [late], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock.pid, 1); // ingestion is blocked on the session row
    lock.release(true); // the holder ends the session and commits
    await lock.done;

    const res = await ingest;
    expect(res).toMatchObject({ inserted: 1, duplicates: 0, countedInSession: 0 });
    expect(await sessionOf(late.externalMatchId)).toBeNull();
    const ended = await sessionRow(sessionId);
    expect(ended.status).toBe("ended");
    await expectPlayedBeforeEnd(late, sessionId);
    expect(await totalGames(sessionId)).toBe(0);
    expect(await frozenFinals(sessionId)).toEqual(finalsBefore);
  });

  it("the lock holder keeping the session active still lets the match count", async () => {
    const sessionId = await startedSessionId();
    const lock = await holdSessionLock(sessionId);
    const m = rankedMatch();
    const ingest = ingestMatches(db, [m], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock.pid, 1);
    lock.release(false);
    await lock.done;
    expect(await ingest).toMatchObject({ inserted: 1, countedInSession: 1 });
    expect(await sessionOf(m.externalMatchId)).toBe(sessionId);
  });

  it("5. no duplicate match: the late match exists once, and re-ingesting it never attaches it", async () => {
    const sessionId = await startedSessionId();
    const late = rankedMatch();
    await endSession(db, playerId);
    await expectPlayedBeforeEnd(late, sessionId);
    for (let i = 0; i < 3; i++) {
      await ingestMatches(db, [late, late], { playerId, sessionId, startGraceMs: 0 });
    }
    expect(await matchCount()).toBe(1);
    expect(await sessionOf(late.externalMatchId)).toBeNull();

    // A NEW session never adopts it either: it predates that session's baseline.
    const next = await startedSessionId();
    await ingestMatches(db, [late], { playerId, sessionId: next, startGraceMs: 0 });
    expect(await sessionOf(late.externalMatchId)).toBeNull();
    expect(await matchCount()).toBe(1);
  });

  it("6. manual endSession racing ingestion: the end wins the lock first → match is history", async () => {
    const sessionId = await startedSessionId();
    const counted = rankedMatch();
    await ingestMatches(db, [counted], { playerId, sessionId, startGraceMs: 0 });

    // Queue: [lock holder] → endSession → ingestion (row-lock waiters are served in order).
    const late = rankedMatch("loss");
    const lock = await holdSessionLock(sessionId);
    const ending = endSession(db, playerId);
    await waitForWaiters(lock.pid, 1);
    const ingest = ingestMatches(db, [late], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock.pid, 2);
    lock.release(false);
    await lock.done;

    const ended = await ending;
    expect(ended?.id).toBe(sessionId);
    const finalsAfterEnd = await frozenFinals(sessionId);
    expect(await ingest).toMatchObject({ inserted: 1, countedInSession: 0 });

    expect(await sessionOf(late.externalMatchId)).toBeNull();
    expect((await sessionRow(sessionId)).status).toBe("ended");
    await expectPlayedBeforeEnd(late, sessionId);
    expect(await totalGames(sessionId)).toBe(1);
    // Finalization happened before the late match and nothing re-froze it afterwards.
    expect(await frozenFinals(sessionId)).toEqual(finalsAfterEnd);
    expect(finalsAfterEnd.every((r) => r.finalizedAt !== null)).toBe(true);
  });

  it("manual end racing ingestion: ingestion wins the lock first → the match counts and is frozen in", async () => {
    const sessionId = await startedSessionId();
    const lock = await holdSessionLock(sessionId);
    const m = rankedMatch();
    const ingest = ingestMatches(db, [m], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock.pid, 1);
    const ending = endSession(db, playerId);
    await waitForWaiters(lock.pid, 2);
    lock.release(false);
    await lock.done;

    expect(await ingest).toMatchObject({ inserted: 1, countedInSession: 1 });
    expect((await ending)?.id).toBe(sessionId);
    expect(await sessionOf(m.externalMatchId)).toBe(sessionId);
    expect(await totalGames(sessionId)).toBe(1);
    const ryu = (await frozenFinals(sessionId)).find((r) => r.characterKey === "ryu");
    expect(ryu?.finalizedAt).not.toBeNull();
  });

  it("7. repeated ingestion is idempotent before and after the end", async () => {
    const sessionId = await startedSessionId();
    const a = rankedMatch();
    for (let i = 0; i < 3; i++) {
      await ingestMatches(db, [a], { playerId, sessionId, startGraceMs: 0 });
    }
    const b = rankedMatch();
    await endSession(db, playerId);
    await expectPlayedBeforeEnd(b, sessionId);
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await ingestMatches(db, [a, b], { playerId, sessionId, startGraceMs: 0 }));
    }
    expect(results[0]).toMatchObject({ inserted: 1, duplicates: 1, countedInSession: 0 });
    for (const r of results.slice(1)) {
      expect(r).toMatchObject({ inserted: 0, duplicates: 2, countedInSession: 0 });
    }
    expect(await matchCount()).toBe(2);
    expect(await sessionOf(a.externalMatchId)).toBe(sessionId);
    expect(await sessionOf(b.externalMatchId)).toBeNull();
    expect(await totalGames(sessionId)).toBe(1);
  });
});
