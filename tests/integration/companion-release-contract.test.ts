/**
 * Companion release contract, end to end (real Postgres, TEST_DATABASE_URL): the REAL Companion
 * sync cycle (apps/companion-extension runCycle, Buckler served from the sanitized fixtures with a
 * presence code injected) → the REAL tracker routes (/api/companion/state, /api/companion/sync)
 * → companion_snapshot (presence track + observation run). Only the browser and the network are
 * replaced. Covers the presence / battlelogObserved evidence shipped in Companion 0.2.0.
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
const { authUser, companionSnapshot } = await import("@/server/db/schema");
const { createPairingCode } = await import("@/server/companion/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { startSession } = await import("@/server/sessions/service");
const { CompanionSF6DataProvider } = await import("@/server/sf6/providers/companion");
const { resetRateLimits } = await import("@/server/security/rate-limit");
const pairRoute = await import("@/app/api/companion/pair/route");
const stateRoute = await import("@/app/api/companion/state/route");
const syncRoute = await import("@/app/api/companion/sync/route");
const { runCycle } = await import("../../apps/companion-extension/src/lib/sync");
const { CompanionStorage, memoryArea } =
  await import("../../apps/companion-extension/src/lib/storage");
const { TrackerClient } = await import("../../apps/companion-extension/src/lib/tracker-client");
const { CompanionBucklerClient } =
  await import("../../apps/companion-extension/src/lib/buckler-client");
const { CFN, fixtureJson, fixtureTransport } =
  await import("../../apps/companion-extension/test/helpers");

const CODE = { offline: 1, menu: 2, practice: 8, ranked: 11 } as const;
const TRACKER = "http://tracker.test";

/** A Buckler page served with `fighter_banner_info.online_status_info.online_status = code`. */
function withStatus(name: string, code: number) {
  const raw = structuredClone(fixtureJson(name)) as {
    pageProps: Record<string, Record<string, unknown>>;
  };
  raw.pageProps.fighter_banner_info = {
    ...raw.pageProps.fighter_banner_info,
    online_status_info: {
      online_status: code,
      online_status_data: { online_status_name: "<span>label</span>", online_status_type: code },
    },
  };
  return { status: 200, contentType: "application/json", text: JSON.stringify(raw) };
}

describe.skipIf(!TEST_DB)("Companion 0.2.0 ↔ tracker contract (real cycle → real routes)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  let userId: string;
  let token: string;
  /** Raw JSON bodies the Companion POSTed to /api/companion/sync. */
  let sent: Array<Record<string, unknown>>;
  let statuses: number[];

  /** The Companion's fetch, wired to the real route handlers (no network). */
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const request = new Request(url, init as RequestInit);
    resetRateLimits(); // the per-device 1/5 s limiter is covered elsewhere
    let res: Response;
    if (url.pathname === "/api/companion/state") res = await stateRoute.GET(request);
    else if (url.pathname === "/api/companion/sync") {
      sent.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      res = await syncRoute.POST(request);
    } else res = new Response("not found", { status: 404 });
    statuses.push(res.status);
    return res;
  };

  /** One real Companion cycle with the given Buckler presence and due work. */
  async function cycle(opts: {
    play?: number;
    battlelog?: number;
    lastBattlelogAgoMs: number | null;
    lastProfileAgoMs: number | null;
  }) {
    const now = new Date();
    const at = (ago: number | null) =>
      ago === null ? null : new Date(now.getTime() - ago).toISOString();
    const overrides: Record<string, ReturnType<typeof withStatus>> = {};
    if (opts.play !== undefined) overrides["play.json"] = withStatus(`play-${CFN}.json`, opts.play);
    if (opts.battlelog !== undefined) {
      overrides["battlelog.json?sid="] = withStatus(`battlelog-${CFN}-page-1.json`, opts.battlelog);
    }
    const transport = fixtureTransport("service_worker", overrides);
    const storage = new CompanionStorage(
      memoryArea({
        deviceToken: token,
        deviceId: "d1",
        manualCfnUserId: CFN, // onboarding: the CFN typed in the popup before the player exists
        trackerStatus: "connected",
        lastBattlelogAt: at(opts.lastBattlelogAgoMs),
        lastProfileAt: at(opts.lastProfileAgoMs),
      }),
    );
    const outcome = await runCycle({
      storage,
      tracker: new TrackerClient(TRACKER, token, fetchImpl),
      buckler: new CompanionBucklerClient(transport),
      now: () => now,
    });
    return { outcome, paths: transport.paths, payload: sent[sent.length - 1] };
  }

  async function snapshot() {
    const [row] = await db
      .select({ profile: companionSnapshot.profile })
      .from(companionSnapshot)
      .where(and(eq(companionSnapshot.userId, userId), eq(companionSnapshot.cfnUserId, CFN)));
    return {
      presence: row?.profile?.presence as
        { state: string; code: number | null; observations: number; since: string } | undefined,
      observation: row?.profile?.observation as { observations: number } | undefined,
    };
  }

  beforeAll(async () => {
    await db.execute(sql`truncate auth_user, mock_cfn_player restart identity cascade`);
  });
  afterAll(async () => {
    await closeDb();
  });

  beforeEach(async () => {
    sent = [];
    statuses = [];
    userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "QA", email: `${userId}@test.local` });
    const { code } = await createPairingCode(db, userId);
    resetRateLimits();
    const res = await pairRoute.POST(
      new Request(`${TRACKER}/api/companion/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName: "QA browser" }),
      }),
    );
    expect(res.status).toBe(200);
    token = ((await res.json()) as { deviceToken: string }).deviceToken;
    // First real cycle (both due) → snapshot exists → the user starts a session.
    const first = await cycle({
      play: CODE.menu,
      battlelog: CODE.menu,
      lastBattlelogAgoMs: null,
      lastProfileAgoMs: null,
    });
    expect(first.outcome).toBe("synced");
    const profile = core.toWireProfile(
      core.normalizeCapcomProfile(core.parseCapcomPlayPayload(fixtureJson(`play-${CFN}.json`)), {
        cfnUserId: CFN,
      }).profile,
    );
    const player = await upsertPlayerForUser(db, userId, profile);
    await startSession(db, new CompanionSF6DataProvider(db, 300_000), player);
  });

  it("A. connectivity: state reflects the active session; syncs are accepted (no 400/422)", async () => {
    const { outcome } = await cycle({
      battlelog: CODE.menu,
      lastBattlelogAgoMs: 40_000,
      lastProfileAgoMs: 10_000,
    });
    expect(outcome).toBe("synced");
    expect(statuses.every((s) => s === 200)).toBe(true);
    const state = await stateRoute.GET(
      new Request(`${TRACKER}/api/companion/state`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(((await state.json()) as { activeSession: boolean }).activeSession).toBe(true);
  });

  it.each([
    ["B. Menu", CODE.menu, "menu"],
    ["C. Practice", CODE.practice, "practice"],
    ["D. Ranked Match", CODE.ranked, "ranked-match"],
    ["E. Offline", CODE.offline, "offline"],
  ] as const)("%s: the raw code reaches the server and is normalized", async (_l, code, state) => {
    const { payload } = await cycle({
      play: code,
      battlelog: code,
      lastBattlelogAgoMs: null,
      lastProfileAgoMs: null,
    });
    expect(payload?.presence).toEqual({ onlineStatus: code });
    expect(payload?.battlelogObserved).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("<span>"); // never the localized label
    expect((await snapshot()).presence).toMatchObject({ state, code });
  });

  it("E2. Offline starts a NEW presence run (continuity begins at the transition)", async () => {
    await cycle({ battlelog: CODE.menu, lastBattlelogAgoMs: 40_000, lastProfileAgoMs: 10_000 });
    const { presence } = await snapshot();
    await cycle({ battlelog: CODE.offline, lastBattlelogAgoMs: 40_000, lastProfileAgoMs: 10_000 });
    const after = (await snapshot()).presence;
    expect(after).toMatchObject({ state: "offline", observations: 1 });
    expect(Date.parse(after!.since)).toBeGreaterThanOrEqual(Date.parse(presence!.since));
  });

  it("F. profile-only cycle → battlelogObserved=false; presence advances, ObservationRun does NOT", async () => {
    const before = await snapshot();
    const { payload, paths } = await cycle({
      play: CODE.practice,
      lastBattlelogAgoMs: 10_000, // battlelog fetched 10 s ago → not due
      lastProfileAgoMs: 95_000, // profile 95 s old → due
    });
    expect(paths.some((p) => p.includes("battlelog"))).toBe(false);
    expect(payload).toMatchObject({
      battlelogObserved: false,
      matches: [],
      presence: { onlineStatus: 8 },
    });
    const after = await snapshot();
    expect(after.observation).toEqual(before.observation);
    expect(after.presence).toMatchObject({ state: "practice", code: 8 });
  });

  it("G. battlelog-only cycle → battlelogObserved=true (even with matches=[]); ObservationRun +1", async () => {
    const before = await snapshot();
    const { payload, paths } = await cycle({
      battlelog: CODE.ranked,
      lastBattlelogAgoMs: 40_000,
      lastProfileAgoMs: 10_000,
    });
    expect(paths.some((p) => p.includes("play.json"))).toBe(false);
    expect(payload).toMatchObject({
      battlelogObserved: true,
      matches: [],
      presence: { onlineStatus: 11 },
    });
    const after = await snapshot();
    expect(after.observation?.observations).toBe((before.observation?.observations ?? 0) + 1);
    expect(after.presence).toMatchObject({ state: "ranked-match" });
  });

  it("H. battlelog + profile → one observation; battlelog page 1 (fetched last) gives presence", async () => {
    const before = await snapshot();
    const { payload } = await cycle({
      play: CODE.menu,
      battlelog: CODE.practice,
      lastBattlelogAgoMs: 40_000,
      lastProfileAgoMs: 95_000,
    });
    expect(payload).toMatchObject({ battlelogObserved: true, presence: { onlineStatus: 8 } });
    expect((await snapshot()).observation?.observations).toBe(
      (before.observation?.observations ?? 0) + 1,
    );
  });

  it("no extra Buckler request: the same Buckler paths as a cycle without presence", async () => {
    const withPresence = await cycle({
      play: 2,
      battlelog: 2,
      lastBattlelogAgoMs: null,
      lastProfileAgoMs: null,
    });
    const without = await cycle({ lastBattlelogAgoMs: null, lastProfileAgoMs: null });
    expect(withPresence.paths).toEqual(without.paths);
    expect(without.payload?.presence).toEqual({ onlineStatus: null });
  });

  it("old Companion payload (no presence / battlelogObserved) is still accepted by the server", async () => {
    resetRateLimits();
    const res = await syncRoute.POST(
      new Request(`${TRACKER}/api/companion/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          cfnUserId: CFN,
          observedAt: new Date().toISOString(),
          profile: null,
          matches: [],
          gapSuspected: false,
          client: { version: "0.1.1", transport: "service_worker" },
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
