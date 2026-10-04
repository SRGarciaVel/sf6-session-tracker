/**
 * SF6 Session Companion — MV3 service worker.
 *
 * Lifecycle: no keep-alive tricks. A chrome.alarms alarm (30 s, the platform minimum) wakes the
 * worker; each wake runs ONE cycle and the worker may sleep again. State lives in
 * chrome.storage.local, so a killed/restarted worker (or browser) just resumes, and the first
 * cycle after a long pause walks back battlelog pages (recovery).
 */
import { z } from "zod";
import { cfnUserIdSchema, COMPANION_POLLING } from "@sf6/capcom-core";
import { CompanionBucklerClient } from "./lib/buckler-client";
import { transportFor } from "./lib/buckler-transport";
import { runConnectionTest } from "./lib/connection-test";
import { toPublicStatus, type CompanionRequest, type CompanionResponse } from "./lib/messages";
import { CompanionStorage, type KeyValueArea } from "./lib/storage";
import { runCycle, type CycleOutcome } from "./lib/sync";
import { TrackerClient, TrackerError } from "./lib/tracker-client";

// MV3 CSP forbids eval/new Function: run zod without its JIT.
z.config({ jitless: true });

const ALARM = "sf6-companion-sync";
const area: KeyValueArea = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};
const storage = new CompanionStorage(area);

const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.info(JSON.stringify({ event, ...fields })); // never tokens, never payloads

let buckler: CompanionBucklerClient | null = null;
let bucklerKind: string | null = null;
function bucklerFor(kind: Parameters<typeof transportFor>[0] | null) {
  if (!kind) return null;
  if (!buckler || bucklerKind !== kind) {
    buckler = new CompanionBucklerClient(transportFor(kind));
    bucklerKind = kind;
  }
  return buckler;
}

let inflight: Promise<CycleOutcome> | null = null;
async function cycle(manual: boolean): Promise<CycleOutcome> {
  if (inflight) return inflight; // one cycle at a time
  inflight = (async () => {
    const store = await storage.load();
    return runCycle(
      {
        storage,
        tracker: new TrackerClient(store.trackerUrl, store.deviceToken),
        buckler: bucklerFor(store.transport),
        log,
      },
      manual,
    );
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function ensureAlarm() {
  void chrome.alarms.create(ALARM, { periodInMinutes: COMPANION_POLLING.alarmPeriodMs / 60_000 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  void cycle(false);
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void cycle(false);
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void cycle(false);
});

async function handle(msg: CompanionRequest): Promise<CompanionResponse> {
  switch (msg.type) {
    case "status":
      return { ok: true, status: toPublicStatus(await storage.load()) };

    case "pair": {
      let url: URL;
      try {
        url = new URL(msg.trackerUrl);
      } catch {
        return { ok: false, error: "invalid_tracker_url" };
      }
      const trackerUrl = url.origin;
      try {
        const res = await new TrackerClient(trackerUrl, null).pair(msg.code, msg.deviceName);
        await storage.patch({
          trackerUrl,
          deviceId: res.deviceId,
          deviceToken: res.deviceToken,
          lastState: res.state,
          trackerStatus: "connected",
          lastError: null,
        });
        log("companion_paired", { deviceId: res.deviceId });
        ensureAlarm();
        const outcome = await cycle(true);
        return { ok: true, status: toPublicStatus(await storage.load()), outcome };
      } catch (err) {
        return { ok: false, error: err instanceof TrackerError ? err.code : "pair_failed" };
      }
    }

    case "syncNow": {
      const outcome = await cycle(true);
      return { ok: true, status: toPublicStatus(await storage.load()), outcome };
    }

    case "testBuckler": {
      const store = await storage.load();
      const cfn = store.lastState?.cfnUserId ?? store.manualCfnUserId;
      if (!cfn) return { ok: false, error: "cfn_required", status: toPublicStatus(store) };
      const test = await runConnectionTest(cfn, transportFor);
      log("companion_buckler_test", {
        verdict: test.verdict,
        preferred: test.preferred,
        results: test.results.map((r) => `${r.transport}:${r.failure ?? "ok"}`),
      });
      const next = await storage.patch({
        lastTest: test,
        transport: test.preferred ?? store.transport,
        bucklerStatus: test.preferred ? "ok" : store.bucklerStatus,
        bucklerBackoffUntil: test.preferred ? null : store.bucklerBackoffUntil,
      });
      return { ok: true, status: toPublicStatus(next), test };
    }

    case "setCfn": {
      const parsed = cfnUserIdSchema.safeParse(msg.cfnUserId);
      if (!parsed.success) return { ok: false, error: "invalid_cfn" };
      return {
        ok: true,
        status: toPublicStatus(await storage.patch({ manualCfnUserId: parsed.data })),
      };
    }

    case "disconnect": {
      const store = await storage.load();
      if (store.deviceToken) {
        await new TrackerClient(store.trackerUrl, store.deviceToken)
          .disconnect()
          .catch(() => undefined);
      }
      await storage.resetPairing();
      log("companion_disconnected");
      return { ok: true, status: toPublicStatus(await storage.load()) };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: CompanionRequest, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false; // only our own popup
  handle(msg).then(sendResponse, (err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : "error" }),
  );
  return true; // async response
});
