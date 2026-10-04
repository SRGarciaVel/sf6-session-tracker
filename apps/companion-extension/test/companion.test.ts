import { describe, expect, it } from "vitest";
import {
  COMPANION_POLLING,
  findForbiddenKeys,
  normalizeCapcomMatches,
  parseCapcomBattlelogPayload,
  toWireMatch,
} from "@sf6/capcom-core";
import { BucklerError, CompanionBucklerClient } from "../src/lib/buckler-client";
import { runConnectionTest } from "../src/lib/connection-test";
import { toPublicStatus } from "../src/lib/messages";
import { CompanionStorage, DEFAULT_STORE, memoryArea } from "../src/lib/storage";
import { buildSyncPayload, computeDueWork, runCycle } from "../src/lib/sync";
import { TrackerError } from "../src/lib/tracker-client";
import { BUILD_ID, CFN, fakeTracker, fixtureJson, fixtureTransport, makeState } from "./helpers";

const NOW = new Date("2026-10-03T03:00:00Z");

async function pairedStorage(extra: Record<string, unknown> = {}) {
  const storage = new CompanionStorage(
    memoryArea({ deviceToken: "sf6c_test", deviceId: "d1", trackerStatus: "connected", ...extra }),
  );
  return storage;
}

describe("Buckler access from the companion (fixtures, offline)", () => {
  it("1. profile: buildId from the profile page, then play.json", async () => {
    const transport = fixtureTransport();
    const client = new CompanionBucklerClient(transport);
    expect(await client.getBuildId(CFN)).toBe(BUILD_ID);
    const play = (await client.getPlay(CFN)) as { pageProps: { sid: number } };
    expect(play.pageProps.sid).toBe(1733837998);
    expect(transport.paths).toEqual([
      `/6/buckler/profile/${CFN}`,
      `/6/buckler/_next/data/${BUILD_ID}/en/profile/${CFN}/play.json?sid=${CFN}`,
    ]);
  });

  it("2. battlelog: page 1 and page 2 with the observed query strings", async () => {
    const transport = fixtureTransport();
    const client = new CompanionBucklerClient(transport);
    const p1 = parseCapcomBattlelogPayload(await client.getBattlelogPage(CFN, 1));
    const p2 = parseCapcomBattlelogPayload(await client.getBattlelogPage(CFN, 2));
    expect([p1.currentPage, p2.currentPage, p1.replays.length]).toEqual([1, 2, 10]);
    expect(transport.paths.slice(-2)).toEqual([
      `/6/buckler/_next/data/${BUILD_ID}/en/profile/${CFN}/battlelog.json?sid=${CFN}`,
      `/6/buckler/_next/data/${BUILD_ID}/en/profile/${CFN}/battlelog.json?page=2&sid=${CFN}`,
    ]);
  });

  it("tab transports read the buildId from the open page without a request", async () => {
    const transport = {
      ...fixtureTransport("main_tab"),
      readBuildIdFromPage: async () => BUILD_ID,
    };
    const client = new CompanionBucklerClient(transport);
    await client.getPlay(CFN);
    expect(transport.paths.some((p) => p.endsWith(`/profile/${CFN}`))).toBe(false);
  });

  it("stale buildId: one invalidation + one retry, never a loop", async () => {
    let n = 0;
    const transport = {
      ...fixtureTransport(),
      readBuildIdFromPage: async () => (n++ === 0 ? "OLDBUILD01" : BUILD_ID),
    };
    const client = new CompanionBucklerClient(transport);
    await expect(client.getPlay(CFN)).resolves.toBeTruthy();
    expect(n).toBe(2);
  });

  it("login required / WAF block / 429 are classified and never retried", async () => {
    const loggedOut = fixtureTransport("service_worker", {
      "play.json": {
        status: 200,
        contentType: "application/json",
        text: JSON.stringify({
          pageProps: { __N_REDIRECT: "/6/buckler/auth/loginep", __N_REDIRECT_STATUS: 307 },
        }),
      },
    });
    await expect(new CompanionBucklerClient(loggedOut).getPlay(CFN)).rejects.toMatchObject({
      kind: "login_required",
    });

    const blocked = fixtureTransport("service_worker", {
      [`/profile/${CFN}`]: {
        status: 403,
        contentType: "text/html",
        text: "<h1>403 ERROR</h1>Request blocked. CloudFront",
      },
    });
    const err = await new CompanionBucklerClient(blocked).getBuildId(CFN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BucklerError);
    expect(err).toMatchObject({ kind: "blocked", status: 403 });
    expect(blocked.paths).toHaveLength(1);

    const limited = fixtureTransport("service_worker", {
      "battlelog.json": { status: 429, contentType: "text/html", text: "Too Many Requests" },
    });
    await expect(
      new CompanionBucklerClient(limited).getBattlelogPage(CFN, 1),
    ).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect(limited.paths.filter((p) => p.includes("battlelog"))).toHaveLength(1);
  });

  it("a logged-out profile page (403 app page) still yields the buildId", async () => {
    const html = `<html><body>To use this service, you must log in.<script id="__NEXT_DATA__" type="application/json">{"buildId":"${BUILD_ID}"}</script></body></html>`;
    const t = fixtureTransport("service_worker", {
      [`/profile/${CFN}`]: { status: 403, contentType: "text/html", text: html },
    });
    expect(await new CompanionBucklerClient(t).getBuildId(CFN)).toBe(BUILD_ID);
  });

  it("connection test: documents every context, prefers the least invasive that works", async () => {
    const blockedSw = fixtureTransport("service_worker", {
      [`/profile/${CFN}`]: { status: 403, contentType: "text/html", text: "Request blocked" },
    });
    const report = await runConnectionTest(CFN, (kind) =>
      kind === "service_worker" ? blockedSw : fixtureTransport(kind),
    );
    expect(report.results.map((r) => [r.transport, r.failure])).toEqual([
      ["service_worker", "blocked"],
      ["isolated_tab", null],
      ["main_tab", null],
    ]);
    expect(report.preferred).toBe("isolated_tab");
    expect(report.verdict).toBe("PASS");
    expect(report.results[1]).toMatchObject({
      characters: 32,
      replays: 10,
      viewerOwnsProfile: true,
    });

    const limited = await runConnectionTest(CFN, () =>
      fixtureTransport("service_worker", {
        [`/profile/${CFN}`]: { status: 429, contentType: "text/html", text: "slow down" },
      }),
    );
    expect(limited.verdict).toBe("FAIL");
    expect(limited.results.slice(1).every((r) => r.failure === "skipped_after_rate_limit")).toBe(
      true,
    );
  });
});

describe("companion sync cycle", () => {
  const deps = async (
    tracker: ReturnType<typeof fakeTracker>,
    extra: Record<string, unknown> = {},
  ) => ({
    storage: await pairedStorage(extra),
    tracker: tracker.client(),
    buckler: new CompanionBucklerClient(fixtureTransport()),
    now: () => NOW,
  });

  it("3. sends exactly the server-equivalent normalization (core) in wire form", async () => {
    const tracker = fakeTracker({ knownReplayIds: [] });
    const d = await deps(tracker, {
      lastBattlelogAt: new Date(NOW.getTime() - 40_000).toISOString(),
    });
    expect(await runCycle(d)).toBe("synced");
    const page = parseCapcomBattlelogPayload(fixtureJson(`battlelog-${CFN}-page-1.json`));
    const expected = normalizeCapcomMatches(page.replays, {
      trackedCfnId: CFN,
      now: NOW,
    }).matches.map(toWireMatch);
    expect(tracker.sent[0]?.matches).toEqual(expected);
    expect(tracker.sent[0]?.client).toEqual({ version: "0.1.0", transport: "service_worker" });
  });

  it("4+5. P1 and P2 replays are resolved from the tracked player's perspective", async () => {
    const tracker = fakeTracker({ knownReplayIds: ["5EL9NP63U"] });
    const d = await deps(tracker); // first run → recovery walks page 1 → 2
    await runCycle(d);
    const byId = new Map(tracker.sent.flatMap((s) => s.matches).map((m) => [m.externalMatchId, m]));
    expect(byId.get("VGPTB9UCN")).toMatchObject({ characterKey: "aki", result: "win" }); // P1
    expect(byId.get("Y5BPN463L")).toMatchObject({ characterKey: "aki", result: "loss" }); // P1
    expect(byId.get("NT4WT4JTE")).toBeUndefined(); // older than the known replay
  });

  it("4+5b. a P2 replay in a recovery sync keeps the tracked player's character and result", async () => {
    const tracker = fakeTracker({ knownReplayIds: ["N63SL67GM"] });
    await runCycle(await deps(tracker));
    const nt = tracker.sent
      .flatMap((s) => s.matches)
      .find((m) => m.externalMatchId === "NT4WT4JTE");
    expect(nt).toMatchObject({
      characterKey: "aki",
      result: "win",
      opponent: { name: "Kuroki", characterKey: "vega" },
    });
  });

  it("6. replay dedupe: a second cycle sends nothing already known", async () => {
    const tracker = fakeTracker();
    const d = await deps(tracker, {
      lastBattlelogAt: new Date(NOW.getTime() - 40_000).toISOString(),
    });
    await runCycle(d);
    expect(tracker.stored.size).toBe(10);
    await d.storage.patch({ lastBattlelogAt: new Date(NOW.getTime() - 40_000).toISOString() });
    await runCycle(d);
    expect(tracker.sent[1]?.matches).toEqual([]);
    expect((await d.storage.load()).seenReplayIds).toHaveLength(10);
  });

  it("14. active session: battlelog every 30 s, profile every 90 s", () => {
    const active = makeState({ activeSession: true });
    const at = (msAgo: number | null) =>
      msAgo === null ? null : new Date(NOW.getTime() - msAgo).toISOString();
    const due = (b: number | null, p: number | null) =>
      computeDueWork({ lastBattlelogAt: at(b), lastProfileAt: at(p) }, active, NOW.getTime());
    expect(due(30_000, 30_000)).toMatchObject({ battlelog: true, profile: false, recovery: false });
    expect(due(10_000, 95_000)).toMatchObject({ battlelog: false, profile: true });
    expect(COMPANION_POLLING.activeBattlelogMs).toBe(30_000);
  });

  it("15. no active session: Buckler only every 120 s (state still checked)", async () => {
    const idle = makeState({ activeSession: false });
    const recent = new Date(NOW.getTime() - 60_000).toISOString();
    expect(
      computeDueWork({ lastBattlelogAt: recent, lastProfileAt: recent }, idle, NOW.getTime()),
    ).toMatchObject({ battlelog: false, profile: false });
    const tracker = fakeTracker({ activeSession: false });
    const d = await deps(tracker, { lastBattlelogAt: recent, lastProfileAt: recent });
    expect(await runCycle(d)).toBe("idle");
    expect(tracker.sent).toHaveLength(0);
  });

  it("16. reconnect: tracker down → disconnected, then back → connected and synced", async () => {
    const tracker = fakeTracker();
    const d = await deps(tracker);
    tracker.setNetworkDown(true);
    expect(await runCycle(d)).toBe("tracker_unreachable");
    expect((await d.storage.load()).trackerStatus).toBe("disconnected");
    tracker.setNetworkDown(false);
    expect(await runCycle(d)).toBe("synced");
    expect((await d.storage.load()).trackerStatus).toBe("connected");
  });

  it("device revoked (401) clears the pairing", async () => {
    const tracker = fakeTracker();
    const d = await deps(tracker);
    tracker.failOnce(401, "unauthorized");
    expect(await runCycle(d)).toBe("revoked");
    const s = await d.storage.load();
    expect([s.deviceToken, s.trackerStatus]).toEqual([null, "revoked"]);
  });

  it("17. recovery after a restart walks back until a known replay id", async () => {
    const tracker = fakeTracker({ knownReplayIds: ["QW48GVG68"] });
    const d = await deps(tracker); // lastBattlelogAt null = restart
    await runCycle(d);
    expect(tracker.sent[0]?.matches.map((m) => m.externalMatchId)).toHaveLength(10);
    expect(tracker.sent[0]?.gapSuspected).toBe(false);
  });

  it("18. gap suspected when no known id appears within recoveryMaxPages", async () => {
    const tracker = fakeTracker({
      knownReplayIds: ["OLDER-THAN-CAPTURED"],
      polling: { ...COMPANION_POLLING, recoveryMaxPages: 2 },
    });
    await runCycle(await deps(tracker));
    expect(tracker.sent[0]?.gapSuspected).toBe(true);
    expect(tracker.sent[0]?.matches).toHaveLength(20);
  });

  it("Buckler refusal pauses Buckler access (no hammering)", async () => {
    const tracker = fakeTracker();
    const storage = await pairedStorage();
    const buckler = new CompanionBucklerClient(
      fixtureTransport("service_worker", {
        [`/profile/${CFN}`]: { status: 403, contentType: "text/html", text: "Request blocked" },
      }),
    );
    expect(await runCycle({ storage, tracker: tracker.client(), buckler, now: () => NOW })).toBe(
      "buckler_error",
    );
    const s = await storage.load();
    expect(s.bucklerStatus).toBe("blocked");
    expect(new Date(s.bucklerBackoffUntil!).getTime()).toBe(
      NOW.getTime() + COMPANION_POLLING.bucklerBackoffMs,
    );
    expect(await runCycle({ storage, tracker: tracker.client(), buckler, now: () => NOW })).toBe(
      "buckler_paused",
    );
  });

  it("19. extension storage: defaults, patch, reset; the popup never sees the token", async () => {
    const area = memoryArea();
    const storage = new CompanionStorage(area);
    expect(await storage.load()).toEqual(DEFAULT_STORE);
    await storage.patch({ deviceToken: "sf6c_secret", deviceId: "d1", manualCfnUserId: CFN });
    const pub = toPublicStatus(await storage.load());
    expect(pub.paired).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sf6c_secret");
    await storage.resetPairing();
    const after = await storage.load();
    expect([after.deviceToken, after.trackerStatus, after.manualCfnUserId]).toEqual([
      null,
      "unpaired",
      CFN,
    ]);
  });

  it("20. nothing credential-like ever leaves the extension", async () => {
    const tracker = fakeTracker();
    await runCycle(await deps(tracker));
    for (const raw of tracker.rawBodies) {
      expect(raw).not.toMatch(
        /cookie|authorization|set-cookie|sessiontoken|session_token|buckler_id|csrf/i,
      );
      expect(findForbiddenKeys(JSON.parse(raw))).toEqual([]);
    }
    // the guard itself
    expect(
      findForbiddenKeys({ a: [{ Cookie: "x" }], sessionToken: 1, nested: { "set-cookie": "y" } }),
    ).toEqual(["$.a[0].Cookie", "$.sessionToken", "$.nested.set-cookie"]);
    const leaky = {
      cfnUserId: CFN,
      observedAt: NOW,
      profile: null,
      matches: [],
      gapSuspected: false,
      transport: "service_worker" as const,
    };
    expect(() => buildSyncPayload(leaky)).not.toThrow();
    await expect(
      tracker
        .client()
        .sync({ ...buildSyncPayload(leaky), ...({ cookies: "x" } as object) } as never),
    ).rejects.toBeInstanceOf(TrackerError);
  });
});
