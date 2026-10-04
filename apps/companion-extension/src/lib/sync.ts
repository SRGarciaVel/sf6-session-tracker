/**
 * One companion cycle (run on every chrome.alarms tick, on startup and on "Sync now"):
 *
 *   tracker state ──► is a Buckler read due? ──► Buckler (battlelog / play) ──► normalize (core)
 *        ▲                                                                         │
 *        └──────────────── POST /api/companion/sync (normalized data only) ◄───────┘
 *
 * The tracker stays authoritative: this only REPORTS observations. No session math here.
 */
import {
  collectMatchesSince,
  findForbiddenKeys,
  normalizeCapcomMatches,
  normalizeCapcomProfile,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  type CompanionState,
  type CompanionSyncRequest,
  type CompanionTransportKind,
  toWireMatch,
  toWireProfile,
  type NormalizedPlayerProfile,
  type NormalizedSF6Match,
} from "@sf6/capcom-core";
import { BucklerError, type CompanionBucklerClient } from "./buckler-client";
import type { CompanionStorage, CompanionStore } from "./storage";
import { TrackerError, type TrackerClient } from "./tracker-client";

export const COMPANION_VERSION = "0.1.0";
const SEEN_CACHE = 200;

export interface DueWork {
  battlelog: boolean;
  profile: boolean;
  /** Walk back several pages (first run, restart, or a long pause). */
  recovery: boolean;
}

const since = (iso: string | null, now: number) =>
  iso === null ? Number.POSITIVE_INFINITY : now - new Date(iso).getTime();

/** Pure scheduling decision (intervals come from the tracker's state → central config). */
export function computeDueWork(
  store: Pick<CompanionStore, "lastBattlelogAt" | "lastProfileAt">,
  state: CompanionState,
  nowMs: number,
  manual = false,
): DueWork {
  const p = state.polling;
  // 1 s of slack: alarms fire at roughly, not exactly, the configured period.
  const slack = 1_000;
  const battlelogEvery = state.activeSession ? p.activeBattlelogMs : p.idleBucklerMs;
  const profileEvery = state.activeSession ? p.activeProfileMs : p.idleBucklerMs;
  const sinceBattlelog = since(store.lastBattlelogAt, nowMs);
  return {
    battlelog: manual || sinceBattlelog + slack >= battlelogEvery,
    profile: manual || since(store.lastProfileAt, nowMs) + slack >= profileEvery,
    recovery: sinceBattlelog > 3 * Math.max(battlelogEvery, p.alarmPeriodMs),
  };
}

export function buildSyncPayload(input: {
  cfnUserId: string;
  observedAt: Date;
  profile: NormalizedPlayerProfile | null;
  matches: readonly NormalizedSF6Match[];
  gapSuspected: boolean;
  transport: CompanionTransportKind;
}): CompanionSyncRequest {
  const payload: CompanionSyncRequest = {
    cfnUserId: input.cfnUserId,
    observedAt: input.observedAt.toISOString(),
    profile: input.profile ? toWireProfile(input.profile) : null,
    matches: input.matches.map(toWireMatch),
    gapSuspected: input.gapSuspected,
    client: { version: COMPANION_VERSION, transport: input.transport },
  };
  const leaks = findForbiddenKeys(payload);
  if (leaks.length > 0) throw new Error(`payload contains forbidden keys: ${leaks.join(", ")}`);
  return payload;
}

export interface CycleDeps {
  storage: CompanionStorage;
  tracker: TrackerClient;
  /** null until a connection test picked a transport. */
  buckler: CompanionBucklerClient | null;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export type CycleOutcome =
  | "unpaired"
  | "revoked"
  | "tracker_unreachable"
  | "cfn_required"
  | "transport_required"
  | "buckler_paused"
  | "buckler_error"
  | "idle"
  | "synced";

export async function runCycle(deps: CycleDeps, manual = false): Promise<CycleOutcome> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  let store = await deps.storage.load();
  if (!store.deviceToken) return "unpaired";

  /* 1. Tracker state (cheap; tells us if a session is active). */
  let state: CompanionState;
  try {
    state = await deps.tracker.state();
  } catch (err) {
    return handleTrackerError(deps, err);
  }
  store = await deps.storage.patch({
    lastState: state,
    trackerStatus: "connected",
    lastError: null,
  });

  const cfnUserId = state.cfnUserId ?? store.manualCfnUserId;
  if (!cfnUserId) return "cfn_required";
  if (!deps.buckler) return "transport_required";

  const nowMs = now().getTime();
  if (
    !manual &&
    store.bucklerBackoffUntil &&
    new Date(store.bucklerBackoffUntil).getTime() > nowMs
  ) {
    return "buckler_paused";
  }

  /* 2. Buckler reads that are due. */
  const due = computeDueWork(store, state, nowMs, manual);
  if (!due.battlelog && !due.profile) return "idle";

  const known = new Set([...state.knownReplayIds, ...store.seenReplayIds]);
  let profile: NormalizedPlayerProfile | null = null;
  let replays: unknown[] = [];
  let gapSuspected = false;
  try {
    if (due.profile) {
      const raw = await deps.buckler.getPlay(cfnUserId);
      profile = normalizeCapcomProfile(parseCapcomPlayPayload(raw), { cfnUserId }).profile;
    }
    if (due.battlelog) {
      const buckler = deps.buckler;
      const pages = await collectMatchesSince(
        async (page) =>
          parseCapcomBattlelogPayload(await buckler.getBattlelogPage(cfnUserId, page)),
        known,
        // Nothing to recover without known ids (first run): page 1 is enough.
        due.recovery && known.size > 0 ? state.polling.recoveryMaxPages : 1,
      );
      replays = pages.replays;
      // A gap only matters when we expected continuity (known ids exist) and walked back.
      gapSuspected = pages.gapSuspected && due.recovery;
      if (pages.gapSuspected && due.recovery)
        log("companion_gap_suspected", { pages: pages.pagesFetched });
    }
  } catch (err) {
    return handleBucklerError(deps, err, nowMs, state, log);
  }

  const normalized = normalizeCapcomMatches(replays, { trackedCfnId: cfnUserId, now: now() });
  const fresh = normalized.matches.filter((m) => !known.has(m.externalMatchId));

  /* 3. Report normalized observations. */
  const payload = buildSyncPayload({
    cfnUserId,
    observedAt: now(),
    profile,
    matches: fresh,
    gapSuspected,
    transport: deps.buckler.transport.kind,
  });
  let response;
  try {
    response = await deps.tracker.sync(payload);
  } catch (err) {
    return handleTrackerError(deps, err);
  }

  const at = now().toISOString();
  const newest = normalized.matches
    .map((m) => m.playedAt.getTime())
    .reduce(
      (a, b) => Math.max(a, b),
      store.lastMatchAt ? new Date(store.lastMatchAt).getTime() : 0,
    );
  await deps.storage.patch({
    lastState: response.state,
    trackerStatus: "connected",
    bucklerStatus: "ok",
    bucklerBackoffUntil: null,
    lastSyncAt: at,
    lastBattlelogAt: due.battlelog ? at : store.lastBattlelogAt,
    lastProfileAt: due.profile ? at : store.lastProfileAt,
    lastMatchAt: newest > 0 ? new Date(newest).toISOString() : null,
    lastError: null,
    seenReplayIds: [...fresh.map((m) => m.externalMatchId), ...store.seenReplayIds].slice(
      0,
      SEEN_CACHE,
    ),
  });
  log("companion_sync", { sent: fresh.length, inserted: response.inserted, profile: !!profile });
  return "synced";
}

async function handleTrackerError(deps: CycleDeps, err: unknown): Promise<CycleOutcome> {
  if (err instanceof TrackerError && err.unauthorized) {
    await deps.storage.resetPairing();
    await deps.storage.patch({ trackerStatus: "revoked", lastError: "device_revoked" });
    return "revoked";
  }
  const code = err instanceof TrackerError ? err.code : "error";
  // 429 = our own per-device limiter (e.g. "Sync now" right after an alarm): still connected.
  const throttled = err instanceof TrackerError && err.status === 429;
  await deps.storage.patch({
    ...(throttled ? {} : { trackerStatus: "disconnected" as const }),
    lastError: `tracker:${code}`,
  });
  return "tracker_unreachable";
}

async function handleBucklerError(
  deps: CycleDeps,
  err: unknown,
  nowMs: number,
  state: CompanionState,
  log: NonNullable<CycleDeps["log"]>,
): Promise<CycleOutcome> {
  const kind = err instanceof BucklerError ? err.kind : "unavailable";
  // Never hammer Buckler after a refusal: pause (403 / 429 / login), retry only much later.
  const pause = kind === "login_required" || kind === "blocked" || kind === "rate_limited";
  await deps.storage.patch({
    bucklerStatus: kind,
    bucklerBackoffUntil: pause
      ? new Date(nowMs + state.polling.bucklerBackoffMs).toISOString()
      : null,
    lastError: `buckler:${kind}`,
  });
  log("companion_buckler_error", { kind, status: err instanceof BucklerError ? err.status : null });
  return "buckler_error";
}
