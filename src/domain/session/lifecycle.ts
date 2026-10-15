/**
 * Session lifecycle (pure): when does an ACTIVE session end by itself? No IO, no DB, no clocks —
 * every input (including `now`) is passed in, so each rule is deterministic and unit tested
 * (lifecycle.test.ts). docs/architecture.md §Session lifecycle documents the policy.
 *
 * Two independent concepts:
 *   SESSION ACTIVITY  matches assigned to the session (they passed its filter at ingestion).
 *                     `lastActivityAt` = max(started_at, latest played_at). Nothing else moves it.
 *   PLAYER PRESENCE   Buckler's online status (Offline / Menu / Practice / Ranked Match), as last
 *                     observed by the Companion. It can hold or accelerate the lifecycle timer but
 *                     never creates matches, changes stats or moves `lastActivityAt`.
 *
 * Rules (first match wins):
 *   1. absolute ceiling  now − lastActivityAt ≥ 12 h ⇒ end, whatever the presence says.
 *   2. playing presence  fresh Practice, or a fresh match-mode presence the session counts
 *                        (Ranked Match for a ranked session) ⇒ keep: the normal timer is held.
 *   3. offline           fresh Offline observed CONTINUOUSLY for ≥ 15 min (≥ 3 observations,
 *                        consecutive observations ≤ the freshness window apart), the whole run
 *                        after the last session match ⇒ end.
 *   4. normal idle       SST OBSERVED ≥ 45 min without activity, CONTINUOUSLY:
 *                        observedAt − anchor ≥ 45 min, where
 *                        anchor = max(lastActivityAt, last playing presence, observation.since)
 *                        and observation is the current continuous run of successful match
 *                        observations (consecutive ≤ 5 min apart). Menu, unknown and stale
 *                        presence neither hold nor accelerate this timer.
 *   otherwise keep.
 *
 * Why the anchor includes the last playing presence: "hold while playing" alone would close a
 * session the moment a player leaves a 2 h Practice block for the Menu on their way to Ranked
 * (lastActivityAt is 2 h old). Instead the 45 min start counting when the playing presence was
 * last seen. A stale Practice/Ranked never holds the session: once it is older than the freshness
 * window it only anchors the timer, and the 12 h ceiling (from lastActivityAt) is never moved.
 *
 * "Observed" matters: if the Companion is closed SST cannot know that nobody played. The latest
 * observation alone is not enough either: after a gap (browser closed, Buckler pause, server
 * asleep) a new run starts and the 45 min are counted again inside it. Without a run only the
 * 12 h ceiling can end a session.
 */
import type { BucklerPresence } from "@/domain/sf6/presence";
import { presenceFromOnlineStatus } from "@/domain/sf6/presence";
import type { MatchMode } from "@/domain/sf6/types";

export const SESSION_IDLE_TIMEOUT_MS = 45 * 60_000;
export const SESSION_OFFLINE_CLOSE_MS = 15 * 60_000;
export const SESSION_OFFLINE_MIN_OBSERVATIONS = 3;
export const SESSION_ABSOLUTE_CEILING_MS = 12 * 60 * 60_000;
/**
 * A presence observation is current for this long. Equal to the server's Companion snapshot
 * freshness (COMPANION_SNAPSHOT_MAX_AGE_MS default): ≥ 2 idle Buckler cycles (120 s) and 10 active
 * battlelog cycles (30 s), short of the 10 min Buckler backoff.
 */
export const PRESENCE_MAX_AGE_MS = 5 * 60_000;
/**
 * Two successful match observations at most this far apart count as CONTINUOUS observation; a
 * larger gap restarts the observation run. Same 5 min: Companion syncs every 30 s with a session
 * (120 s without), the tracker polls every 20 s and backs off to at most 5 min; a Buckler pause
 * (10 min) or a closed browser therefore breaks continuity, as it should.
 */
export const OBSERVATION_MAX_GAP_MS = PRESENCE_MAX_AGE_MS;

export interface LifecyclePolicy {
  idleTimeoutMs: number;
  offlineCloseMs: number;
  offlineMinObservations: number;
  absoluteCeilingMs: number;
  presenceMaxAgeMs: number;
  observationMaxGapMs: number;
}

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicy = Object.freeze({
  idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
  offlineCloseMs: SESSION_OFFLINE_CLOSE_MS,
  offlineMinObservations: SESSION_OFFLINE_MIN_OBSERVATIONS,
  absoluteCeilingMs: SESSION_ABSOLUTE_CEILING_MS,
  presenceMaxAgeMs: PRESENCE_MAX_AGE_MS,
  observationMaxGapMs: OBSERVATION_MAX_GAP_MS,
});

/* ───────────────────────── Observation run ───────────────────────── */

/**
 * The current CONTINUOUS run of successful match observations (Companion syncs / provider
 * polls), independent of any presence state. "SST observed 45 min without activity" needs the
 * whole 45 min inside one run: the latest observation alone says nothing about the gap before it
 * (a Companion that was closed for 2 h and comes back in Menu must not close the session at once).
 */
export interface ObservationRun {
  /** First observation of the current run. */
  since: string;
  /** Latest observation. */
  observedAt: string;
  observations: number;
}

/** Fold one successful observation into the run; a gap > `maxGapMs` starts a new run. */
export function advanceObservationRun(
  prev: ObservationRun | null,
  observedAt: Date,
  maxGapMs: number,
): ObservationRun {
  if (prev) {
    const prevAt = Date.parse(prev.observedAt);
    if (observedAt.getTime() < prevAt) return prev;
    if (observedAt.getTime() - prevAt <= maxGapMs) {
      return {
        since: prev.since,
        observedAt: observedAt.toISOString(),
        observations: prev.observations + 1,
      };
    }
  }
  const at = observedAt.toISOString();
  return { since: at, observedAt: at, observations: 1 };
}

/** Lenient reader for a stored run: anything malformed ⇒ null (no proven observation). */
export function parseObservationRun(raw: unknown): ObservationRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const iso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
  if (!iso(r.since) || !iso(r.observedAt) || Date.parse(r.since) > Date.parse(r.observedAt)) {
    return null;
  }
  if (typeof r.observations !== "number" || !Number.isInteger(r.observations)) return null;
  if (r.observations < 1) return null;
  return { since: r.since, observedAt: r.observedAt, observations: r.observations };
}

/* ───────────────────────── Presence track ───────────────────────── */

/**
 * The current continuous run of one presence state, as observed by SST. Stored (JSON) next to the
 * Companion snapshot; ISO strings so it round-trips through JSONB unchanged.
 */
export interface PresenceTrack {
  state: BucklerPresence;
  /** Raw Buckler code of the latest observation (diagnostics / future evidence); null = absent. */
  code: number | null;
  /** First observation of the current continuous run. */
  since: string;
  /** Latest observation (server acceptance time — presence has no timestamp of its own). */
  observedAt: string;
  /** Observations in the current run. */
  observations: number;
  /** Latest observation of a playing state (practice / ranked-match). Survives state changes. */
  lastPlayingAt: string | null;
}

const PLAYING: ReadonlySet<BucklerPresence> = new Set(["practice", "ranked-match"]);

/**
 * Fold one observation into the track. The run continues only when the state is the same AND the
 * previous observation is no older than `maxGapMs` (otherwise SST was not watching in between and
 * continuity cannot be claimed). Out-of-order observations are ignored.
 */
export function advancePresenceTrack(
  prev: PresenceTrack | null,
  observation: { code: number | null; observedAt: Date },
  maxGapMs: number,
): PresenceTrack {
  const at = observation.observedAt;
  const state = presenceFromOnlineStatus(observation.code);
  const lastPlayingAt = PLAYING.has(state) ? at.toISOString() : (prev?.lastPlayingAt ?? null);
  if (prev) {
    const prevAt = Date.parse(prev.observedAt);
    if (at.getTime() < prevAt) return prev;
    if (prev.state === state && at.getTime() - prevAt <= maxGapMs) {
      return {
        ...prev,
        code: observation.code,
        observedAt: at.toISOString(),
        observations: prev.observations + 1,
        lastPlayingAt,
      };
    }
  }
  return {
    state,
    code: observation.code,
    since: at.toISOString(),
    observedAt: at.toISOString(),
    observations: 1,
    lastPlayingAt,
  };
}

/** Lenient reader for a stored track: anything malformed ⇒ null (no presence). */
export function parsePresenceTrack(raw: unknown): PresenceTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const iso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
  if (
    !iso(r.since) ||
    !iso(r.observedAt) ||
    typeof r.observations !== "number" ||
    !Number.isInteger(r.observations) ||
    r.observations < 1 ||
    !(r.lastPlayingAt === null || iso(r.lastPlayingAt)) ||
    !(r.code === null || (typeof r.code === "number" && Number.isInteger(r.code)))
  ) {
    return null;
  }
  const code = r.code as number | null;
  return {
    // Re-derived from the code: the mapping table is the single source of truth.
    state: presenceFromOnlineStatus(code),
    code,
    since: r.since as string,
    observedAt: r.observedAt as string,
    observations: r.observations,
    lastPlayingAt: r.lastPlayingAt as string | null,
  };
}

/* ───────────────────────── Evaluation ───────────────────────── */

export interface SessionLifecycleInput {
  now: Date;
  startedAt: Date;
  /** Latest played_at among the matches assigned to the session; null = none yet. */
  lastSessionMatchAt: Date | null;
  /** Modes the session counts (its filter): a match-mode presence holds it only if counted. */
  filterModes: readonly MatchMode[];
  /**
   * Current continuous run of successful match observations; null = none proven (never observed,
   * or the source cannot prove continuity).
   */
  observation: ObservationRun | null;
  /** Companion presence track; null = no presence (old Companion, direct Capcom mode…). */
  presence: PresenceTrack | null;
}

export type AutoEndPolicy = "normal-idle" | "offline" | "absolute-ceiling";

export interface LifecycleDiagnostics {
  lastActivityAt: Date;
  idleMs: number;
  /** Presence state if FRESH, else "unknown". */
  presenceState: BucklerPresence;
  /** Age of the latest presence observation; null = no presence. */
  presenceAgeMs: number | null;
}

export type LifecycleDecision =
  | ({ action: "end"; policy: AutoEndPolicy } & LifecycleDiagnostics)
  | ({
      action: "keep";
      reason: "presence-playing" | "awaiting-timeout" | "not-observed";
    } & LifecycleDiagnostics);

const PRESENCE_MATCH_MODE: Partial<Record<BucklerPresence, MatchMode>> = {
  "ranked-match": "ranked",
};

/** Does a (fresh) presence state hold the normal idle timer for this session? */
export function presenceHoldsSession(
  state: BucklerPresence,
  filterModes: readonly MatchMode[],
): boolean {
  if (state === "practice") return true;
  const mode = PRESENCE_MATCH_MODE[state];
  return mode !== undefined && filterModes.includes(mode);
}

const ms = (d: Date) => d.getTime();
const clampToNow = (d: Date, now: Date) => (ms(d) > ms(now) ? now : d);

/** max(started_at, latest assigned match) — played_at clamped to now. */
export function lastActivityAt(
  input: Pick<SessionLifecycleInput, "now" | "startedAt" | "lastSessionMatchAt">,
): Date {
  const last = input.lastSessionMatchAt ? clampToNow(input.lastSessionMatchAt, input.now) : null;
  return last && ms(last) > ms(input.startedAt) ? last : input.startedAt;
}

export function evaluateSessionLifecycle(
  input: SessionLifecycleInput,
  policy: LifecyclePolicy = DEFAULT_LIFECYCLE_POLICY,
): LifecycleDecision {
  const { now, presence } = input;
  const activity = lastActivityAt(input);
  const idleMs = Math.max(0, ms(now) - ms(activity));

  const presenceAt = presence ? clampToNow(new Date(presence.observedAt), now) : null;
  const presenceAgeMs = presenceAt ? ms(now) - ms(presenceAt) : null;
  const fresh = presenceAgeMs !== null && presenceAgeMs <= policy.presenceMaxAgeMs;
  const presenceState: BucklerPresence = presence && fresh ? presence.state : "unknown";
  const diag: LifecycleDiagnostics = {
    lastActivityAt: activity,
    idleMs,
    presenceState,
    presenceAgeMs,
  };

  // 1. Absolute ceiling: independent of presence and observation.
  if (idleMs >= policy.absoluteCeilingMs) {
    return { action: "end", policy: "absolute-ceiling", ...diag };
  }

  // 2. Fresh playing presence holds the session.
  if (presenceHoldsSession(presenceState, input.filterModes)) {
    return { action: "keep", reason: "presence-playing", ...diag };
  }

  // 3. Confirmed Offline, entirely after the last session activity.
  if (presence && presenceAt && presenceState === "offline") {
    const since = new Date(presence.since);
    const observedRun = ms(presenceAt) - ms(since);
    if (
      ms(since) >= ms(activity) &&
      observedRun >= policy.offlineCloseMs &&
      presence.observations >= policy.offlineMinObservations
    ) {
      return { action: "end", policy: "offline", ...diag };
    }
  }

  // 4. Normal observed inactivity: the 45 min must lie inside ONE continuous observation run,
  //    after the last session activity and after the last playing presence.
  const observation = input.observation;
  if (!observation) return { action: "keep", reason: "not-observed", ...diag };
  let anchor = activity;
  for (const iso of [presence?.lastPlayingAt ?? null, observation.since]) {
    if (!iso) continue;
    const t = clampToNow(new Date(iso), now);
    if (ms(t) > ms(anchor)) anchor = t;
  }
  const observed = clampToNow(new Date(observation.observedAt), now);
  if (ms(observed) - ms(anchor) >= policy.idleTimeoutMs) {
    return { action: "end", policy: "normal-idle", ...diag };
  }
  return {
    action: "keep",
    reason: ms(now) - ms(anchor) >= policy.idleTimeoutMs ? "not-observed" : "awaiting-timeout",
    ...diag,
  };
}
