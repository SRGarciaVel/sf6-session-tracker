/**
 * Idle auto-end against a real Postgres (TEST_DATABASE_URL), provider mode (mock CFN): the
 * observation clock is the runtime's in-memory run of successful polls and there is no presence. Companion mode and
 * presence are covered in session-idle-companion.test.ts. Skipped when TEST_DATABASE_URL is unset.
 *
 * Time: the policy runs on an injected clock (`at(minutes)` after the session start), so 45 min
 * of inactivity take no real time. Rows written by the code under test keep real timestamps.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ObservationRun } from "@/domain/session/lifecycle";
import type { NormalizedSF6Match } from "@/domain/sf6/types";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "mock";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, match, sessionCharacterBaseline, sf6Player } =
  await import("@/server/db/schema");
const { ingestMatches } = await import("@/server/ingestion/ingest");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { endSession, getActiveSession, startSession, summarizeSessionRow } =
  await import("@/server/sessions/service");
const { autoEndIdleSessions, findIdleSessionCandidates } =
  await import("@/server/sessions/lifecycle");
type LifecycleCursor = NonNullable<Awaited<ReturnType<typeof autoEndIdleSessions>>["cursor"]>;
const { DEFAULT_LIFECYCLE_POLICY, OBSERVATION_MAX_GAP_MS, advanceObservationRun } =
  await import("@/domain/session/lifecycle");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { TrackerRuntime } = await import("@/server/tracking/worker-runtime");
const { logger } = await import("@/server/logger");

const log = logger.child({ test: "idle" });

describe.skipIf(!TEST_DB)("idle auto-end (provider mode, integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const provider = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  let playerId: string;
  let cfnUserId: string;
  let sessionId: string;
  let startedAt: Date;
  let seq = 0;

  const at = (minutes: number) => new Date(startedAt.getTime() + minutes * 60_000);
  const clock = (minutes: number) => () => at(minutes);
  /** Provider mode observation runs (the runtime keeps them in memory; injected here). */
  const runs = new Map<string, ObservationRun>();
  const run = (minutes: number) =>
    autoEndIdleSessions(db, provider, {
      source: "provider",
      now: clock(minutes),
      observationFor: (id) => runs.get(id) ?? null,
      log,
    });

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    // Earlier tests' sessions must not crowd the bounded candidate batch.
    await db.update(gameSession).set({ status: "ended", endedAt: sql`now()` });
    cfnUserId = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "Test", email: `${userId}@test.local` });
    const player = await upsertPlayerForUser(
      db,
      userId,
      await provider.getPlayerProfile(cfnUserId),
    );
    playerId = player.id;
    const session = await startSession(db, provider, player);
    sessionId = session.id;
    startedAt = session.startedAt;
  });

  /** SST has been observing CONTINUOUSLY from the session start until minute `minutes`. */
  async function observedAt(minutes: number) {
    let r: ObservationRun | null = null;
    for (let m = 0; m <= minutes + 1e-9; m += 0.5) {
      r = advanceObservationRun(r, at(Math.min(m, minutes)), OBSERVATION_MAX_GAP_MS);
    }
    r = advanceObservationRun(r, at(minutes), OBSERVATION_MAX_GAP_MS);
    runs.set(playerId, r);
  }

  function runtime(workerId: string) {
    return new TrackerRuntime({
      db,
      provider,
      env: { WORKER_CONCURRENCY: 1, WORKER_TICK_MS: 1000, SF6_PROVIDER: "mock" },
      config: {
        polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
        leaseMs: 60_000,
        profileRefreshMs: 300_000,
        startGraceMs: 0,
        lifecycle: DEFAULT_LIFECYCLE_POLICY,
      },
      logger: log,
      mode: "standalone",
      workerId,
    });
  }

  function rankedMatch(minutes: number, mode: NormalizedSF6Match["mode"] = "ranked") {
    seq++;
    return {
      externalMatchId: `idle-${playerId}-${seq}`,
      playedAt: at(minutes),
      mode,
      result: "win" as const,
      characterKey: "ryu",
      characterName: "Ryu",
      opponent: { name: null, characterKey: "ken", characterName: "Ken", rank: null },
    };
  }

  async function ingestAt(minutes: number, mode: NormalizedSF6Match["mode"] = "ranked") {
    const m = rankedMatch(minutes, mode);
    await ingestMatches(db, [m], { playerId, sessionId, startGraceMs: 0 });
    return m;
  }

  async function session() {
    const [row] = await db.select().from(gameSession).where(eq(gameSession.id, sessionId));
    if (!row) throw new Error("session missing");
    return row;
  }

  async function sessionOf(externalMatchId: string) {
    const [row] = await db
      .select({ sessionId: match.sessionId })
      .from(match)
      .where(and(eq(match.playerId, playerId), eq(match.externalMatchId, externalMatchId)));
    return row?.sessionId;
  }

  async function finals() {
    return db
      .select()
      .from(sessionCharacterBaseline)
      .where(eq(sessionCharacterBaseline.sessionId, sessionId));
  }

  it("1. regular matches keep the session active (maintenance every few minutes)", async () => {
    for (let m = 4; m <= 120; m += 4) {
      await ingestAt(m - 1);
      await observedAt(m);
      expect((await run(m)).ended).toEqual([]);
    }
    expect((await session()).status).toBe("active");
  });

  it("2/3. 44:59 observed idle → active; 45:00 → ended with the normal-idle policy", async () => {
    await ingestAt(5);
    await observedAt(49.99);
    expect((await run(49.99)).ended).toEqual([]);
    expect((await session()).status).toBe("active");
    await observedAt(50);
    const res = await run(50);
    expect(res.ended).toHaveLength(1);
    expect(res.ended[0]?.decision).toMatchObject({ action: "end", policy: "normal-idle" });
    const s = await session();
    expect(s.status).toBe("ended");
    expect(s.endedAt).not.toBeNull();
    expect(await getActiveSession(db, playerId)).toBeNull();
  });

  it("observation is required: 2 h idle but no successful observation since → only the ceiling", async () => {
    await observedAt(10);
    expect((await run(120)).ended).toEqual([]);
    expect((await run(11 * 60)).ended).toEqual([]);
    const res = await run(12 * 60);
    expect(res.ended[0]?.decision).toMatchObject({ policy: "absolute-ceiling" });
  });

  it("13. 12 h ceiling closes regardless of observation", async () => {
    await ingestAt(30);
    expect((await run(30 + 12 * 60)).ended[0]?.decision).toMatchObject({
      policy: "absolute-ceiling",
    });
    expect((await session()).status).toBe("ended");
  });

  it("14. zero-match session: kept as an ended session, baselines preserved, 0 games", async () => {
    const before = await finals();
    expect(before.length).toBeGreaterThan(0);
    await observedAt(45);
    expect((await run(45)).ended).toHaveLength(1);
    const s = await session();
    expect(s.status).toBe("ended");
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    expect((await summarizeSessionRow(db, s, p!)).totalGames).toBe(0);
    const after = await finals();
    expect(after.map((r) => r.characterKey).sort()).toEqual(
      before.map((r) => r.characterKey).sort(),
    );
    expect(after.every((r) => r.finalizedAt !== null)).toBe(true);
  });

  it("13b. per-character final ratings are frozen exactly like a manual end", async () => {
    const m = await ingestAt(3);
    expect(await sessionOf(m.externalMatchId)).toBe(sessionId);
    await observedAt(50);
    await run(50);
    const rows = await finals();
    const ryu = rows.find((r) => r.characterKey === "ryu");
    expect(ryu).toMatchObject({ source: "none" });
    expect(ryu?.finalizedAt).not.toBeNull();
    expect(rows.every((r) => r.finalizedAt !== null)).toBe(true);
  });

  it("25. a non-qualifying (casual) match is history and does not reset the timer", async () => {
    await ingestAt(5);
    const casual = await ingestAt(40, "casual");
    expect(await sessionOf(casual.externalMatchId)).toBeNull();
    await observedAt(50);
    expect((await run(50)).ended[0]?.decision).toMatchObject({
      policy: "normal-idle",
      lastActivityAt: at(5),
    });
  });

  it("15. a match exactly at the timeout boundary keeps the session active", async () => {
    await ingestAt(5);
    await ingestAt(50); // played at the 45-min mark of the previous match
    await observedAt(50);
    expect((await run(50)).ended).toEqual([]);
    expect((await session()).status).toBe("active");
  });

  it("17. a match that only appears in the FINAL fetch aborts the close (re-check)", async () => {
    await ingestAt(5);
    await observedAt(55);
    // Played at minute 52 but not ingested yet: only the final fetch sees it.
    const secondsAgo = -Math.round((at(52).getTime() - Date.now()) / 1000);
    await provider.simulateMatch(cfnUserId, { result: "win", secondsAgo });
    const res = await run(55);
    expect(res).toMatchObject({ ended: [], aborted: 1 });
    expect((await session()).status).toBe("active");
    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(match)
      .where(eq(match.sessionId, sessionId));
    expect(counted?.n).toBe(2);
  });

  it("20. the final provider fetch fails → the session still ends with the known data", async () => {
    await ingestAt(5);
    await observedAt(55);
    await provider.setOutage(cfnUserId, 600);
    const res = await run(55);
    expect(res.ended).toHaveLength(1);
    expect(res.failed).toBe(0);
    expect((await session()).status).toBe("ended");
    expect((await finals()).every((r) => r.finalizedAt !== null)).toBe(true);
    await provider.setOutage(cfnUserId, 0);
  });

  it("22. a late replay after auto-end stays historical (#39); the ended session is frozen", async () => {
    const counted = await ingestAt(5);
    const late = rankedMatch(6); // played BEFORE the end, ingested after it
    await observedAt(55);
    await run(55);
    const frozen = await finals();
    await ingestMatches(db, [late], { playerId, sessionId, startGraceMs: 0 });
    expect(await sessionOf(late.externalMatchId)).toBeNull();
    expect(await sessionOf(counted.externalMatchId)).toBe(sessionId);
    expect(await finals()).toEqual(frozen);
  });

  it("no auto-reopen: a new explicit Start creates a NEW session that tracks normally", async () => {
    await observedAt(45);
    await run(45);
    const [p] = await db.select().from(sf6Player).where(eq(sf6Player.id, playerId));
    const next = await startSession(db, provider, p!);
    expect(next.id).not.toBe(sessionId);
    expect((await session()).status).toBe("ended");
    expect((await getActiveSession(db, playerId))?.id).toBe(next.id);
  });

  it("26. repeated maintenance is idempotent", async () => {
    await observedAt(45);
    expect((await run(45)).ended).toHaveLength(1);
    const ended = await session();
    for (let i = 0; i < 3; i++) expect((await run(46 + i)).ended).toEqual([]);
    expect(await session()).toEqual(ended);
  });

  it("19. two maintenance workers racing end the session exactly once", async () => {
    await observedAt(45);
    const [a, b] = await Promise.all([run(45), run(45)]);
    expect(a.ended.length + b.ended.length).toBe(1);
    expect(a.failed + b.failed).toBe(0);
    expect((await session()).status).toBe("ended");
  });

  it("18. manual end racing auto-end: one end, no error, finals frozen once", async () => {
    await ingestAt(3);
    await observedAt(50);
    const [auto, manual] = await Promise.all([run(50), endSession(db, playerId, provider)]);
    expect(auto.failed).toBe(0);
    expect(auto.ended.length + (manual ? 1 : 0)).toBeGreaterThanOrEqual(1);
    expect((await session()).status).toBe("ended");
    const rows = await finals();
    expect(rows.every((r) => r.finalizedAt !== null)).toBe(true);
  });

  it("16. a match ingested while auto-end waits on the lock aborts it; the reverse order ends it", async () => {
    await observedAt(55);
    // Queue behind a lock holder: [holder] → ingestion → auto-end.
    const lock = await holdSessionLock();
    const late = rankedMatch(54);
    const ingest = ingestMatches(db, [late], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock.pid, 1);
    const auto = run(55);
    await waitForWaiters(lock.pid, 2);
    lock.release();
    await lock.done;
    expect(await ingest).toMatchObject({ countedInSession: 1 });
    expect(await auto).toMatchObject({ ended: [], aborted: 1 });
    expect((await session()).status).toBe("active");

    // [holder] → auto-end → ingestion: the end wins, the match becomes history.
    await observedAt(100);
    const lock2 = await holdSessionLock();
    const auto2 = run(100);
    await waitForWaiters(lock2.pid, 1);
    const later = rankedMatch(60);
    const ingest2 = ingestMatches(db, [later], { playerId, sessionId, startGraceMs: 0 });
    await waitForWaiters(lock2.pid, 2);
    lock2.release();
    await lock2.done;
    expect((await auto2).ended).toHaveLength(1);
    expect(await ingest2).toMatchObject({ countedInSession: 0 });
    expect(await sessionOf(later.externalMatchId)).toBeNull();
  });

  it("21. a fresh runtime (restart) ends an already-expired session on its first maintenance", async () => {
    // Expired long ago in real time: move the session back 13 h (ceiling, no clock injection).
    await db
      .update(gameSession)
      .set({ startedAt: sql`now() - interval '13 hours'` })
      .where(eq(gameSession.id, sessionId));
    const rt = runtime("restart-test"); // no observation history: only the ceiling can fire
    await rt.maintenance();
    expect((await session()).status).toBe("ended");
  });

  it("10. provider mode: the runtime's own polls prove continuity; a gap restarts it", async () => {
    // Real clock here (maintenance uses Date.now()): the session started 3 h ago.
    await db
      .update(gameSession)
      .set({ startedAt: sql`now() - interval '170 minutes'` })
      .where(eq(gameSession.id, sessionId));
    const ago = (m: number) => new Date(Date.now() - m * 60_000);
    // Polled 170 → 165 min ago, then NOTHING for 2 h (server asleep), back 44 min ago.
    const gapped = runtime("gap-test");
    for (let m = 170; m >= 165; m -= 0.5) gapped.recordObservation(playerId, ago(m));
    for (let m = 44; m >= 0; m -= 0.5) gapped.recordObservation(playerId, ago(m));
    await gapped.maintenance();
    expect((await session()).status).toBe("active"); // only 44 min observed since the gap
    // Continuous polling for the last 46 min (≤ 5 min apart) → normal idle.
    const steady = runtime("steady-test");
    for (let m = 46; m >= 0; m -= 4) steady.recordObservation(playerId, ago(m));
    steady.recordObservation(playerId, ago(0));
    await steady.maintenance();
    expect((await session()).status).toBe("ended");
  });

  it("10b. last_success_at alone never counts as observation (a fresh success after a gap)", async () => {
    await db
      .update(sf6Player)
      .set({ lastSuccessAt: at(125) })
      .where(eq(sf6Player.id, playerId));
    expect((await run(125)).ended).toEqual([]);
    expect((await session()).status).toBe("active");
  });

  it("candidate discovery is bounded and skips recently active sessions", async () => {
    await ingestAt(40);
    const policy = DEFAULT_LIFECYCLE_POLICY;
    expect(
      (await findIdleSessionCandidates(db, { source: "provider", policy, now: at(50), limit: 5 }))
        .length,
    ).toBe(0); // 10 min since the last match < the shortest rule (15 min)
    const found = await findIdleSessionCandidates(db, {
      source: "provider",
      policy,
      now: at(56),
      limit: 5,
    });
    expect(found.map((c) => c.sessionId)).toEqual([sessionId]);
    expect(found[0]?.input).toMatchObject({ filterModes: ["ranked"], presence: null });
  });

  it("no starvation: kept sessions filling a whole page never block a later closable one", async () => {
    // 4 OLDER active sessions the policy keeps (2 h idle but never observed → "not-observed").
    for (let i = 0; i < 4; i++) {
      const cfn = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
      const uid = randomUUID();
      await db.insert(authUser).values({ id: uid, name: "Kept", email: `${uid}@test.local` });
      const p = await upsertPlayerForUser(db, uid, await provider.getPlayerProfile(cfn));
      const s = await startSession(db, provider, p);
      await db
        .update(gameSession)
        .set({ startedAt: at(-120 + i) })
        .where(eq(gameSession.id, s.id));
    }
    // The newest one is genuinely closable (45 min observed in Menu-equivalent: no presence).
    await observedAt(50);
    const sweep = (cursor: LifecycleCursor | null) =>
      autoEndIdleSessions(db, provider, {
        source: "provider",
        now: clock(50),
        observationFor: (id) => runs.get(id) ?? null,
        limit: 3,
        pages: 1,
        cursor,
        log,
      });
    // Run 1: the 3 oldest (all kept) fill the page.
    const first = await sweep(null);
    expect(first).toMatchObject({ evaluated: 3, ended: [] });
    expect(first.cursor).not.toBeNull();
    expect((await session()).status).toBe("active");
    // Run 2 resumes after them and reaches the closable session.
    const second = await sweep(first.cursor);
    expect(second.ended.map((e) => e.sessionId)).toEqual([sessionId]);
    expect(second.cursor).toBeNull(); // short page: wrap around next time
    expect((await session()).status).toBe("ended");
  });

  it("one maintenance run pages through the candidates (bounded by pages × limit)", async () => {
    for (let i = 0; i < 4; i++) {
      const cfn = String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
      const uid = randomUUID();
      await db.insert(authUser).values({ id: uid, name: "Kept", email: `${uid}@test.local` });
      const p = await upsertPlayerForUser(db, uid, await provider.getPlayerProfile(cfn));
      const s = await startSession(db, provider, p);
      await db
        .update(gameSession)
        .set({ startedAt: at(-120 + i) })
        .where(eq(gameSession.id, s.id));
    }
    await observedAt(50);
    const res = await autoEndIdleSessions(db, provider, {
      source: "provider",
      now: clock(50),
      observationFor: (id) => runs.get(id) ?? null,
      limit: 2,
      pages: 3,
      log,
    });
    expect(res.evaluated).toBe(5);
    expect(res.ended.map((e) => e.sessionId)).toEqual([sessionId]);
  });

  /* ───────── lock helpers (same technique as ingest-active-session.test.ts) ───────── */

  async function holdSessionLock() {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let pid!: number;
    let ready!: () => void;
    const locked = new Promise<void>((r) => (ready = r));
    const done = db.transaction(async (tx) => {
      await tx.select().from(gameSession).where(eq(gameSession.id, sessionId)).for("update");
      const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      pid = Number(row?.pid);
      ready();
      await released;
    });
    await locked;
    return { pid, release, done };
  }

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
});
