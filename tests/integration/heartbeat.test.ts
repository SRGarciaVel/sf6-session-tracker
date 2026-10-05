/**
 * Session heartbeat (POST /api/session/heartbeat) and the shared tracking runtime against a real
 * Postgres (TEST_DATABASE_URL). The heartbeat must be read-only for sessions/stats and never call
 * the SF6 provider.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "memory";
process.env.LOG_LEVEL = "error";
process.env.SF6_PROVIDER = "mock";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, gameSession, match, sf6Player } = await import("@/server/db/schema");
const { getAuth } = await import("@/server/auth/auth");
const { getEnv } = await import("@/server/env");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { endSession, startSession } = await import("@/server/sessions/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { resetRateLimits } = await import("@/server/security/rate-limit");
const { TrackerRuntime } = await import("@/server/tracking/worker-runtime");
const { logger } = await import("@/server/logger");
const sf6 = await import("@/server/sf6");
const heartbeatRoute = await import("@/app/api/session/heartbeat/route");

describe.skipIf(!TEST_DB)("session heartbeat + tracking runtime (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const mock = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  const provider = TEST_DB
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);
  const origin = TEST_DB ? new URL(getEnv().APP_URL).origin : "";

  afterAll(async () => {
    await closeDb();
  });
  beforeEach(() => {
    resetRateLimits();
  });

  /** Real Better Auth account + session; returns only the cookie header to replay. */
  async function signedInUser() {
    const email = `${randomUUID()}@test.local`;
    const res = await getAuth().api.signUpEmail({
      body: { email, password: "heartbeat-test-pw-123", name: "HB" },
      asResponse: true,
    });
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const [user] = await db.select().from(authUser).where(eq(authUser.email, email));
    if (!user || !cookie) throw new Error("sign-up failed");
    return { userId: user.id, cookie };
  }

  async function withPlayer(userId: string) {
    const cfn = String(5_000_000_000 + Math.floor(Math.random() * 999_999_999));
    return upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn));
  }

  const beat = (headers: Record<string, string> = {}) =>
    heartbeatRoute.POST(
      new Request(`${origin}/api/session/heartbeat`, {
        method: "POST",
        headers: { origin, ...headers },
      }),
    );

  it("401 without authentication", async () => {
    const res = await beat();
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("403 for cross-origin or origin-less requests, even with a valid session", async () => {
    const { cookie } = await signedInUser();
    const cross = await heartbeatRoute.POST(
      new Request(`${origin}/api/session/heartbeat`, {
        method: "POST",
        headers: { origin: "https://evil.example", cookie },
      }),
    );
    expect(cross.status).toBe(403);
    const none = await heartbeatRoute.POST(
      new Request(`${origin}/api/session/heartbeat`, { method: "POST", headers: { cookie } }),
    );
    expect(none.status).toBe(403);
  });

  it("409 for a signed-in user without player or without an active session", async () => {
    const noPlayer = await signedInUser();
    const a = await beat({ cookie: noPlayer.cookie });
    expect(a.status).toBe(409);
    expect(await a.json()).toEqual({ error: "no_active_session" });

    const ended = await signedInUser();
    const player = await withPlayer(ended.userId);
    await startSession(db, provider, player);
    await endSession(db, player.id, provider);
    expect((await beat({ cookie: ended.cookie })).status).toBe(409);
  });

  it("204 with an active session; modifies no session, player or match row; no provider calls", async () => {
    const { userId, cookie } = await signedInUser();
    const player = await withPlayer(userId);
    const session = await startSession(db, provider, player);
    const providerSpy = vi.spyOn(sf6, "getSF6DataProvider");

    const before = {
      session: await db.select().from(gameSession).where(eq(gameSession.id, session.id)),
      player: await db.select().from(sf6Player).where(eq(sf6Player.id, player.id)),
      matches: await db.select().from(match).where(eq(match.playerId, player.id)),
    };
    for (let i = 0; i < 3; i++) {
      const res = await beat({ cookie });
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe("");
    }
    const after = {
      session: await db.select().from(gameSession).where(eq(gameSession.id, session.id)),
      player: await db.select().from(sf6Player).where(eq(sf6Player.id, player.id)),
      matches: await db.select().from(match).where(eq(match.playerId, player.id)),
    };
    expect(after).toEqual(before);
    expect(providerSpy).not.toHaveBeenCalled();
    providerSpy.mockRestore();
  });

  it("user A's heartbeat is not satisfied by user B's active session (account-scoped)", async () => {
    const a = await signedInUser();
    await withPlayer(a.userId);
    const b = await signedInUser();
    const bPlayer = await withPlayer(b.userId);
    await startSession(db, provider, bPlayer);
    expect((await beat({ cookie: a.cookie })).status).toBe(409);
    expect((await beat({ cookie: b.cookie })).status).toBe(204);
  });

  it("is rate limited per user", async () => {
    const { userId, cookie } = await signedInUser();
    await startSession(db, provider, await withPlayer(userId));
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await beat({ cookie })).status);
    expect(statuses.slice(0, 6).every((s) => s === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  it("runtime shutdown releases its leases so another instance can claim immediately", async () => {
    const { userId } = await signedInUser();
    const player = await withPlayer(userId);
    await startSession(db, provider, player);

    // Every poll of this runtime blocks on one gate, so a poll is in flight when stop() starts.
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    const slowProvider = new Proxy(provider, {
      get(target, prop, receiver) {
        const value: unknown = Reflect.get(target, prop, receiver);
        if (prop !== "getMatchesSince" && prop !== "getRecentMatches") return value;
        return async (...args: unknown[]) => {
          await gate;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const config = {
      polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
      leaseMs: 60_000,
      profileRefreshMs: 300_000,
      startGraceMs: 0,
    };
    const rt = new TrackerRuntime({
      db,
      provider: slowProvider,
      env: { WORKER_CONCURRENCY: 1000, WORKER_TICK_MS: 10, SF6_PROVIDER: "mock" },
      config,
      logger,
      mode: "embedded",
      workerId: `test-${randomUUID()}`,
    });
    rt.start();
    await vi.waitFor(async () => {
      const [row] = await db.select().from(sf6Player).where(eq(sf6Player.id, player.id));
      expect(row?.leaseOwner).toBe(rt.workerId);
    });

    const stopping = rt.stop("SIGTERM");
    const [held] = await db.select().from(sf6Player).where(eq(sf6Player.id, player.id));
    expect(held?.leaseOwner).toBe(rt.workerId); // in-flight poll still owns it
    finish();
    await stopping;

    const owned = await db.select().from(sf6Player).where(eq(sf6Player.leaseOwner, rt.workerId));
    expect(owned).toHaveLength(0);
  });
});
