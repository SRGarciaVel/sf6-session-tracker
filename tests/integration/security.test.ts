/**
 * Security regressions from the pre-production audit (docs/security-audit.md), against a real
 * Postgres (TEST_DATABASE_URL). Route handlers are called directly.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.RATE_LIMIT_STORE = "memory";
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionDevice, companionSnapshot, match } = await import("@/server/db/schema");
const service = await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { startSession } = await import("@/server/sessions/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { resetRateLimits } = await import("@/server/security/rate-limit");
const stateRoute = await import("@/app/api/companion/state/route");
const syncRoute = await import("@/app/api/companion/sync/route");
const pairRoute = await import("@/app/api/companion/pair/route");

const CFN = "1733837998";
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/capcom/${name}`, "utf8"));

function payload() {
  const play = core.normalizeCapcomProfile(
    core.parseCapcomPlayPayload(fixture(`play-${CFN}.json`)),
    {
      cfnUserId: CFN,
    },
  );
  const page = core.parseCapcomBattlelogPayload(fixture(`battlelog-${CFN}-page-1.json`));
  const matches = core.normalizeCapcomMatches(page.replays, {
    trackedCfnId: CFN,
    now: new Date("2026-10-03T03:00:00Z"),
  }).matches;
  return {
    cfnUserId: CFN,
    observedAt: new Date().toISOString(),
    profile: core.toWireProfile(play.profile),
    matches: matches.map(core.toWireMatch),
    gapSuspected: false,
    client: { version: "0.1.0", transport: "service_worker" as const },
  };
}

const req = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
  new Request(`http://tracker.test${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe.skipIf(!TEST_DB)("security regressions (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  async function newUser() {
    const id = randomUUID();
    await db.insert(authUser).values({ id, name: "Sec", email: `${id}@test.local` });
    return id;
  }
  async function pairDevice(userId: string) {
    const { code } = await service.createPairingCode(db, userId);
    const paired = await service.exchangePairingCode(db, code.replace("-", ""), "dev");
    if (!paired) throw new Error("pairing failed");
    return paired;
  }

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  beforeEach(() => resetRateLimits());
  afterAll(async () => {
    await closeDb();
  });

  it("SEC-017: a pairing code cannot be redeemed twice, even by 10 concurrent requests", async () => {
    const userId = await newUser();
    const { code } = await service.createPairingCode(db, userId);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.exchangePairingCode(db, code.replace("-", ""), `d${i}`),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const devices = await db
      .select()
      .from(companionDevice)
      .where(eq(companionDevice.userId, userId));
    expect(devices).toHaveLength(1);
  });

  it("SEC-017: pairing endpoint gives the same answer for unknown, used and expired codes", async () => {
    const userId = await newUser();
    const { code } = await service.createPairingCode(db, userId);
    await service.exchangePairingCode(db, code.replace("-", ""), "first");
    const answers = await Promise.all(
      [code, "ZZZZ-ZZZZ"].map(async (c) => {
        const res = await pairRoute.POST(
          req("/api/companion/pair", { method: "POST", body: { code: c, deviceName: "x" } }),
        );
        return [res.status, await res.json()];
      }),
    );
    expect(answers[0]).toEqual(answers[1]); // no oracle distinguishing used vs unknown codes
  });

  it("SEC-010: a device unused for 90+ days is revoked on its next use", async () => {
    const userId = await newUser();
    const { device, token } = await pairDevice(userId);
    await db
      .update(companionDevice)
      .set({ lastSeenAt: new Date(Date.now() - service.DEVICE_INACTIVITY_REVOKE_MS - 60_000) })
      .where(eq(companionDevice.id, device.id));
    expect((await stateRoute.GET(req("/api/companion/state", { token }))).status).toBe(401);
    const [row] = await db.select().from(companionDevice).where(eq(companionDevice.id, device.id));
    expect(row?.revokedAt).not.toBeNull();
  });

  it("IDOR: an account cannot revoke, list or read another account's devices or snapshots", async () => {
    const alice = await newUser();
    const mallory = await newUser();
    const { device, token } = await pairDevice(alice);
    expect(await service.revokeDevice(db, mallory, device.id)).toBe(false);
    expect(await service.listDevices(db, mallory)).toEqual([]);
    expect((await stateRoute.GET(req("/api/companion/state", { token }))).status).toBe(200);

    await syncRoute.POST(req("/api/companion/sync", { method: "POST", token, body: payload() }));
    const provider = new CompanionSF6DataProvider(db, 300_000);
    await expect(
      provider.getPlayerProfile(CFN, { scope: { userId: mallory } }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const rows = await db
      .select()
      .from(companionSnapshot)
      .where(eq(companionSnapshot.userId, alice));
    expect(rows).toHaveLength(1);
  });

  it("integrity: concurrent syncs from two devices of one account count each replay once", async () => {
    const userId = await newUser();
    const a = await pairDevice(userId);
    const b = await pairDevice(userId);
    await syncRoute.POST(
      req("/api/companion/sync", {
        method: "POST",
        token: a.token,
        body: { ...payload(), matches: [] },
      }),
    );
    resetRateLimits();
    const provider = new CompanionSF6DataProvider(db, 300_000);
    const profile = await provider.getPlayerProfile(CFN, { scope: { userId } });
    const player = await upsertPlayerForUser(db, userId, profile);
    await startSession(db, provider, player);

    const [r1, r2] = await Promise.all(
      [a.token, b.token].map((token) =>
        syncRoute.POST(req("/api/companion/sync", { method: "POST", token, body: payload() })),
      ),
    );
    const bodies = (await Promise.all([r1!.json(), r2!.json()])) as Array<{ inserted: number }>;
    expect(bodies[0]!.inserted + bodies[1]!.inserted).toBe(10);
    const rows = await db.select().from(match).where(eq(match.playerId, player.id));
    expect(rows).toHaveLength(10);
  });

  it("companion responses never carry credentials-mode CORS or internal error details", async () => {
    const res = await syncRoute.POST(
      req("/api/companion/sync", { method: "POST", token: "sf6c_" + "x".repeat(43), body: {} }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
