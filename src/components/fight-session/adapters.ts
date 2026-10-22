/**
 * Phase 5.6B1 — map existing SST state to the Fight Session presentational props. Pure and
 * read-only: every number comes from the session engine / live state as-is; the only decisions
 * here are presentation ones (which status word to show, «—» for an undecided win rate).
 */
import type { CompanionReadiness } from "@/domain/companion/readiness";
import type { LiveCharacterProgress, LiveSessionState } from "@/domain/overlay/state";
import type { TrackerState } from "@/server/dashboard/state";
import type {
  ActivityItem,
  CompanionStatusData,
  RatingData,
  ScoreboardData,
  SessionIndicatorStatus,
  TrackingStatusData,
} from "./types";

export function scoreboardFromSession(
  session: Pick<LiveSessionState, "wins" | "losses" | "draws" | "totalGames" | "winRate">,
): ScoreboardData {
  return {
    wins: session.wins,
    losses: session.losses,
    draws: session.draws,
    games: session.totalGames,
    // The engine reports 0 when nothing is decided; that is "unknown", not "0 %".
    winRate: session.wins + session.losses === 0 ? null : session.winRate,
  };
}

/**
 * Rating of ONE character (ratings belong to characters, never to the player). In an ACTIVE
 * session a pending post-match rating shows the last confirmed observation and its delta
 * (Phase 5.5 hold), marked `pending`; callers that need the 3-minute hold expiry apply
 * `withHeldRatings` first. An ended session never waits: an unknown final rating is shown as
 * unavailable, even if the live state still carries a `heldRating` for it.
 */
export function ratingFromCharacter(
  c: LiveCharacterProgress | null,
  sessionStatus: LiveSessionState["status"],
): RatingData | null {
  if (!c || !c.ratingSystem) return null;
  const held = c.current === null && sessionStatus === "active" ? (c.heldRating ?? null) : null;
  return {
    characterName: c.characterName,
    system: c.ratingSystem,
    initial: c.baselineKnown ? (c.initial?.value ?? null) : null,
    current: c.current?.value ?? held?.current.value ?? null,
    delta: c.current ? c.delta : (held?.delta ?? null),
    pending: held !== null,
  };
}

export function sessionIndicatorStatus(input: {
  session: Pick<LiveSessionState, "status">;
  /** Companion readiness (null outside companion mode). */
  readiness: Pick<CompanionReadiness, "required" | "companion" | "canStart"> | null;
  tracker: { state: TrackerState } | null;
}): SessionIndicatorStatus {
  const { session, readiness, tracker } = input;
  if (session.status === "active") {
    const companionSilent = readiness?.required === true && readiness.companion !== "connected";
    return tracker?.state === "degraded" || companionSilent ? "degraded" : "live";
  }
  if (session.status === "ended") return "ended";
  return readiness && !readiness.canStart ? "blocked" : "ready";
}

export function companionStatus(
  readiness: Pick<CompanionReadiness, "required" | "companion" | "buckler"> | null,
  lastSyncAt: string | null,
): CompanionStatusData {
  if (!readiness?.required) return { link: null, buckler: null, lastSyncAt };
  return { link: readiness.companion, buckler: readiness.buckler, lastSyncAt };
}

/**
 * Phase 5.6D — collapses Companion link + Buckler/profile freshness (+ the tracker during an
 * active session) into one tracking state. Same inputs and thresholds as `assessCompanion` and
 * the server's start rule; null when this deployment does not use the Companion.
 */
export function trackingStatus(input: {
  readiness: CompanionReadiness | null;
  sessionStatus: LiveSessionState["status"];
  tracker: { state: TrackerState } | null;
}): TrackingStatusData | null {
  const { readiness, sessionStatus, tracker } = input;
  if (!readiness) return { state: "unknown", step: null };
  if (!readiness.required) return null;
  const step = readiness.nextStep;
  if (readiness.companion === "notPaired") return { state: "attention", step };
  if (readiness.companion === "quiet") return { state: "disconnected", step };
  if (readiness.buckler === "never" || readiness.profile === "never")
    return { state: "attention", step };
  if (!readiness.canStart) return { state: "waiting", step };
  if (sessionStatus === "active")
    return tracker?.state === "degraded"
      ? { state: "attention", step: null }
      : { state: "tracking", step: null };
  return { state: "ready", step: null };
}

/** Structural subset of a stored `match` row (recap/details pages already select these). */
export interface MatchRowLike {
  id: string;
  result: ActivityItem["result"];
  characterName: string;
  opponentCharacter: string | null;
  opponentName: string | null;
  playedAt: Date | string;
}

export function activityFromMatches(rows: readonly MatchRowLike[]): ActivityItem[] {
  return rows.map((m) => ({
    id: m.id,
    result: m.result,
    characterName: m.characterName,
    opponentCharacter: m.opponentCharacter,
    opponentName: m.opponentName,
    playedAt: typeof m.playedAt === "string" ? m.playedAt : m.playedAt.toISOString(),
  }));
}
