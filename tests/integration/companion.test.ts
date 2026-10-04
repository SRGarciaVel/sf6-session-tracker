/**
 * SF6 Session Companion backend against a real Postgres (TEST_DATABASE_URL): pairing, device
 * auth, validation, snapshot ownership, ingestion through the normal pipeline and the
 * "companion" provider. Route handlers are called directly (Request → Response).
 */
import { randomUUID } from "node:crypto";
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
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionDevice, companionSnapshot, match } = await import("@/server/db/schema");
const { createPairingCode, exchangePairingCode, revokeDevice } =
  await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { startSession, buildPlayerLiveState } = await import("@/server/sessions/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { resetRateLimits } = await import("@/server/security/rate-limit");
const pairRoute = await import("@/app/api/companion/pair/route");
const stateRoute = await import("@/app/api/companion/state/route");
const syncRoute = await import("@/app/api/companion/sync/route");
const disconnectRoute = await import("@/app/api/companion/disconnect/route");
const { readFileSync } = await import("node:fs");

const CFN = "1733837998";
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/capcom/${name}`, "utf8"));
const NOW = new Date("2026-10-03T03:00:00Z");

/** Real normalization of the HAR fixtures, exactly as the companion would send it. */
function companionPayload(over: Record<string, unknown> = {}) {
  const play = core.normalizeCapcomProfile(
    core.parseCapcomPlayPayload(fixture(`play-${CFN}.json`)),
    {
      cfnUserId: CFN,
    },
  );
  const page = core.parseCapcomBattlelogPayload(fixture(`battlelog-${CFN}-page-1.json`));
  const matches = core.normalizeCapcomMatches(page.replays, {
    trackedCfnId: CFN,
    now: NOW,
  }).matches;
  return {
    cfnUserId: CFN,
    observedAt: new Date().toISOString(),
    profile: core.toWireProfile(play.profile),
    matches: matches.map(core.toWireMatch),
    gapSuspected: false,
    client: { version: "0.1.0", transport: "service_worker" },
    ...over,
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

describe.skipIf(!TEST_DB)("companion backend (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  let userId: string;

  async function newUser() {
    const id = randomUUID();
    await db.insert(authUser).values({ id, name: "Test", email: `${id}@test.local` });
    return id;
  }
  async function pair(uid = userId) {
    const { code } = await createPairingCode(db, uid);
    const res = await pairRoute.POST(
      req("/api/companion/pair", { method: "POST", body: { code, deviceName: "Test browser" } }),
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { deviceId: string; deviceToken: string };
  }
  const sync = (token: string, body: unknown) => {
    resetRateLimits(); // the 1/5 s limiter is tested separately
    return syncRoute.POST(req("/api/companion/sync", { method: "POST", token, body }));
  };

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });
  beforeEach(async () => {
    resetRateLimits();
    await db.delete(companionSnapshot);
    userId = await newUser();
  });

  it("7. pairing: one-time code → device token (hash only in DB); reuse and expiry fail", async () => {
    const { code } = await createPairingCode(db, userId);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const res = await pairRoute.POST(
      req("/api/companion/pair", {
        method: "POST",
        body: { code: code.toLowerCase(), deviceName: "Chrome" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as {
      deviceToken: string;
      deviceId: string;
      state: { cfnUserId: null };
    };
    expect(body.deviceToken).toMatch(/^sf6c_[A-Za-z0-9_-]{43}$/);
    expect(body.state.cfnUserId).toBeNull();
    const [row] = await db
      .select()
      .from(companionDevice)
      .where(eq(companionDevice.id, body.deviceId));
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(body.deviceToken);

    const again = await pairRoute.POST(
      req("/api/companion/pair", { method: "POST", body: { code, deviceName: "x" } }),
    );
    expect(again.status).toBe(400);
    const { code: old } = await createPairingCode(db, userId, new Date(Date.now() - 11 * 60_000));
    expect(await exchangePairingCode(db, old.replace("-", ""), "late")).toBeNull();
  });

  it("8+9. invalid or revoked device token → 401 (state, sync, disconnect)", async () => {
    expect((await stateRoute.GET(req("/api/companion/state"))).status).toBe(401);
    expect(
      (await stateRoute.GET(req("/api/companion/state", { token: "sf6c_" + "a".repeat(43) })))
        .status,
    ).toBe(401);
    const { deviceId, deviceToken } = await pair();
    expect((await stateRoute.GET(req("/api/companion/state", { token: deviceToken }))).status).toBe(
      200,
    );
    expect(await revokeDevice(db, await newUser(), deviceId)).toBe(false); // IDOR-safe
    expect(await revokeDevice(db, userId, deviceId)).toBe(true);
    expect((await stateRoute.GET(req("/api/companion/state", { token: deviceToken }))).status).toBe(
      401,
    );
    expect((await sync(deviceToken, companionPayload())).status).toBe(401);

    const second = await pair();
    expect(
      (
        await disconnectRoute.POST(
          req("/api/companion/disconnect", { method: "POST", token: second.deviceToken, body: {} }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await stateRoute.GET(req("/api/companion/state", { token: second.deviceToken }))).status,
    ).toBe(401);
  });

  it("10+11+12. invalid payload, unexpected keys, >100 matches and bad timestamps are rejected", async () => {
    const { deviceToken } = await pair();
    expect((await sync(deviceToken, { hello: "world" })).status).toBe(422);
    expect(
      (await sync(deviceToken, { ...companionPayload(), cookies: "buckler_id=x" })).status,
    ).toBe(422);
    const base = companionPayload();
    const many = Array.from({ length: 101 }, (_, i) => ({
      ...base.matches[0]!,
      externalMatchId: `ID${i}`,
    }));
    expect((await sync(deviceToken, { ...base, matches: many })).status).toBe(422);
    const future = { ...base.matches[0]!, playedAt: new Date(Date.now() + 3600_000).toISOString() };
    const res = await sync(deviceToken, { ...base, matches: [future] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "invalid_timestamp" });
    const badKey = { ...base.matches[0]!, characterKey: "A.K.I." };
    expect((await sync(deviceToken, { ...base, matches: [badKey] })).status).toBe(422);
    expect((await sync(deviceToken, "x".repeat(300 * 1024))).status).toBe(413);
  });

  it("13. a CFN different from the user's registered one is refused", async () => {
    const { deviceToken } = await pair();
    await upsertPlayerForUser(db, userId, {
      cfnUserId: "1234567890",
      displayName: "Other",
      characters: [],
    });
    const res = await sync(deviceToken, companionPayload());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cfn_mismatch" });
  });

  it("snapshot has one owner: another account cannot overwrite a tracked CFN", async () => {
    const owner = await pair();
    expect((await sync(owner.deviceToken, companionPayload())).status).toBe(200);
    const intruder = await pair(await newUser());
    const res = await sync(intruder.deviceToken, companionPayload());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "cfn_owned_by_other" });
  });

  it("rate limit: at most 1 sync per 5 s per device", async () => {
    const { deviceToken } = await pair();
    resetRateLimits();
    const body = companionPayload();
    const first = await syncRoute.POST(
      req("/api/companion/sync", { method: "POST", token: deviceToken, body }),
    );
    const second = await syncRoute.POST(
      req("/api/companion/sync", { method: "POST", token: deviceToken, body }),
    );
    expect([first.status, second.status]).toEqual([200, 429]);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("onboarding via companion → session → sync ingests, dedupes and feeds the Session Engine", async () => {
    const { deviceToken } = await pair();
    const provider = new CompanionSF6DataProvider(db, 300_000);

    // 1. Before registration the snapshot is stored; the provider can then serve the CFN lookup.
    expect((await sync(deviceToken, companionPayload({ matches: [] }))).status).toBe(200);
    const profile = await provider.getPlayerProfile(CFN);
    expect(profile.characters).toHaveLength(32);
    const player = await upsertPlayerForUser(db, userId, profile);

    // 2. Start a session (baseline from the companion snapshot), then report page 1.
    await startSession(db, provider, player);
    const stateRes = await stateRoute.GET(req("/api/companion/state", { token: deviceToken }));
    expect(await stateRes.json()).toMatchObject({
      cfnUserId: CFN,
      activeSession: true,
      ingestEnabled: true,
    });

    const first = await sync(deviceToken, companionPayload());
    expect(first.status).toBe(200);
    const body = (await first.json()) as { inserted: number; state: { knownReplayIds: string[] } };
    expect(body.inserted).toBe(10);
    expect(body.state.knownReplayIds[0]).toBe("VGPTB9UCN");

    // 3. Same payload again: dedupe by externalMatchId.
    const again = (await (await sync(deviceToken, companionPayload())).json()) as {
      inserted: number;
      duplicates: number;
    };
    expect([again.inserted, again.duplicates]).toEqual([0, 10]);
    expect((await db.select().from(match).where(eq(match.playerId, player.id))).length).toBe(10);

    // 4. The backend (not the companion) is the authority on session state.
    const live = await buildPlayerLiveState(db, player.id);
    expect(live?.session).toBeTruthy();
  });

  it("companion provider refuses stale or missing snapshots", async () => {
    const provider = new CompanionSF6DataProvider(db, 60_000);
    await expect(provider.getPlayerProfile("999999999")).rejects.toMatchObject({
      code: "unavailable",
    });
    const { deviceToken } = await pair();
    await sync(deviceToken, companionPayload());
    await db
      .update(companionSnapshot)
      .set({
        profileObservedAt: new Date(Date.now() - 120_000),
        matchesObservedAt: new Date(Date.now() - 120_000),
      })
      .where(eq(companionSnapshot.cfnUserId, CFN));
    await expect(provider.getPlayerProfile(CFN)).rejects.toMatchObject({ code: "unavailable" });
    await expect(provider.getRecentMatches(CFN)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("CORS preflight is answered without credentials", async () => {
    const res = syncRoute.OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
