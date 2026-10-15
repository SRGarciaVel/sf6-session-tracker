/**
 * Session analytics (Phase 6.2) — pure, descriptive patterns INSIDE recorded sessions.
 *
 * Membership: a sequence is the QUALIFYING matches (the page's range + mode + character dataset)
 * that share the same `match.session_id`. Membership is never reconstructed from timestamps;
 * matches with `session_id = NULL` (history outside any session) take no part here, although
 * they still count in the overall record and in matchups.
 *
 * REAL SESSION vs ANALYTICS SEGMENT. The real session is `match.session_id` (its boundaries are
 * the lifecycle's). An analytics segment is a contiguous block of qualifying matches INSIDE one
 * real session: two consecutive QUALIFYING matches ≥ SESSION_ANALYTICS_GAP_MS apart start a new
 * segment, in EVERY session. A segment boundary does not mean the real session ended: a session
 * held open by fresh Practice / Ranked presence (lifecycle.ts) can legitimately contain such a
 * gap, and filtering by character or mode can create one. Segments exist so streaks, recovery,
 * halves, duration and match position never bridge long stretches without qualifying matches;
 * they also keep old pre-auto-end sessions with very long gaps from distorting the aggregates.
 * The threshold is the session idle timeout with the same `>=` comparison (45:00 splits).
 * Nothing is written: game_session / match.session_id are untouched.
 *
 * Order inside a segment: played_at ASC, ties by external id ASC (the session engine's order).
 */
import { SESSION_IDLE_TIMEOUT_MS } from "@/domain/session/lifecycle";
import type { MatchResult } from "@/domain/sf6/types";
import { computeRecord, type AnalyticsMatchRow, type MatchRecord } from "./record";

/**
 * Gap between consecutive qualifying matches that starts a new analytics SEGMENT (≥ 45 min) — not
 * a real session boundary.
 */
export const SESSION_ANALYTICS_GAP_MS = SESSION_IDLE_TIMEOUT_MS;
/** Match positions shown by "performance by match position" (1…10). */
export const MATCH_POSITION_CAP = 10;
/** Segments need at least this many matches to be split into halves. */
export const HALVES_MIN_MATCHES = 4;

export interface AnalyticsSessionSegment {
  sessionId: string;
  /** 0-based index of the segment inside its real session (> 0 only after a virtual split). */
  segmentIndex: number;
  /** Results in play order (oldest first). */
  results: MatchResult[];
  record: MatchRecord;
  matchCount: number;
  firstPlayedAt: Date;
  lastPlayedAt: Date;
  /** last − first qualifying match; 0 for a one-match segment (never estimated). */
  gameplayDurationMs: number;
}

/** Oldest first; ties by external id ascending. */
function playOrder(a: AnalyticsMatchRow, b: AnalyticsMatchRow): number {
  const t = a.playedAt.getTime() - b.playedAt.getTime();
  if (t !== 0) return t;
  return a.externalMatchId < b.externalMatchId ? -1 : a.externalMatchId > b.externalMatchId ? 1 : 0;
}

function toSegment(sessionId: string, segmentIndex: number, rows: AnalyticsMatchRow[]) {
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const results = rows.map((m) => m.result);
  return {
    sessionId,
    segmentIndex,
    results,
    record: computeRecord(results),
    matchCount: rows.length,
    firstPlayedAt: first.playedAt,
    lastPlayedAt: last.playedAt,
    gameplayDurationMs: last.playedAt.getTime() - first.playedAt.getTime(),
  } satisfies AnalyticsSessionSegment;
}

/**
 * Analytics segments of the dataset: grouped by real session_id (NULL excluded), in play order,
 * split where consecutive qualifying matches are ≥ `gapMs` apart. Segments are returned ordered
 * by first match (then session id), deterministic for any input order.
 */
export function segmentSessionMatches(
  rows: readonly AnalyticsMatchRow[],
  gapMs: number = SESSION_ANALYTICS_GAP_MS,
): AnalyticsSessionSegment[] {
  const bySession = new Map<string, AnalyticsMatchRow[]>();
  for (const m of rows) {
    if (m.sessionId === null) continue;
    const list = bySession.get(m.sessionId);
    if (list) list.push(m);
    else bySession.set(m.sessionId, [m]);
  }
  const segments: AnalyticsSessionSegment[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort(playOrder);
    let current: AnalyticsMatchRow[] = [];
    let index = 0;
    for (const m of list) {
      const prev = current[current.length - 1];
      if (prev && m.playedAt.getTime() - prev.playedAt.getTime() >= gapMs) {
        segments.push(toSegment(sessionId, index++, current));
        current = [];
      }
      current.push(m);
    }
    if (current.length > 0) segments.push(toSegment(sessionId, index, current));
  }
  return segments.sort(
    (a, b) =>
      a.firstPlayedAt.getTime() - b.firstPlayedAt.getTime() ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
      a.segmentIndex - b.segmentIndex,
  );
}

/** Median of finite values (mean of the two middle ones for even counts); null when empty. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface SessionStreaks {
  /** Longest run of consecutive wins inside one segment (0 when none). */
  longestWin: number;
  longestLoss: number;
}

/** Streaks never cross a segment (session or virtual split); a draw breaks both kinds. */
export function computeSessionStreaks(
  segments: readonly AnalyticsSessionSegment[],
): SessionStreaks {
  let longestWin = 0;
  let longestLoss = 0;
  for (const s of segments) {
    let win = 0;
    let loss = 0;
    for (const r of s.results) {
      win = r === "win" ? win + 1 : 0;
      loss = r === "loss" ? loss + 1 : 0;
      if (win > longestWin) longestWin = win;
      if (loss > longestLoss) longestLoss = loss;
    }
  }
  return { longestWin, longestLoss };
}

export interface RecoveryAfterLoss {
  /** Losses followed by another match in the same segment (the denominator). */
  lossesWithNextMatch: number;
  /** …whose very next match was a win. */
  recoveredWithWin: number;
  /** 0–100; null without a loss followed by a match. */
  rate: number | null;
}

/**
 * "Win in the next match after a loss": for every loss that is NOT the last match of its segment,
 * only the IMMEDIATELY next match counts (win = yes; loss or draw = no). Never looks further, never
 * across a segment boundary; a segment-final loss has no observed next match and is not counted.
 */
export function computeRecoveryAfterLoss(
  segments: readonly AnalyticsSessionSegment[],
): RecoveryAfterLoss {
  let lossesWithNextMatch = 0;
  let recoveredWithWin = 0;
  for (const s of segments) {
    for (let i = 0; i < s.results.length - 1; i++) {
      if (s.results[i] !== "loss") continue;
      lossesWithNextMatch++;
      if (s.results[i + 1] === "win") recoveredWithWin++;
    }
  }
  return {
    lossesWithNextMatch,
    recoveredWithWin,
    rate: lossesWithNextMatch > 0 ? (recoveredWithWin / lossesWithNextMatch) * 100 : null,
  };
}

export interface SessionHalves {
  /** Segments with ≥ HALVES_MIN_MATCHES matches (the only ones split). */
  eligibleSegments: number;
  first: MatchRecord;
  second: MatchRecord;
}

/**
 * First vs second half BY MATCH COUNT: first = ceil(N / 2) matches, second = floor(N / 2) (the
 * first half takes the middle match of odd counts). Aggregated over eligible segments.
 */
export function computeSessionHalves(segments: readonly AnalyticsSessionSegment[]): SessionHalves {
  const first: MatchResult[] = [];
  const second: MatchResult[] = [];
  let eligibleSegments = 0;
  for (const s of segments) {
    if (s.matchCount < HALVES_MIN_MATCHES) continue;
    eligibleSegments++;
    const cut = Math.ceil(s.matchCount / 2);
    first.push(...s.results.slice(0, cut));
    second.push(...s.results.slice(cut));
  }
  return { eligibleSegments, first: computeRecord(first), second: computeRecord(second) };
}

export interface MatchPositionPerformance {
  /** 1-based position inside a segment. */
  position: number;
  /** record.matches = segments that reached this position (the sample). */
  record: MatchRecord;
}

/** Performance by 1-based match position, positions 1…cap that at least one segment reached. */
export function computeMatchPositionPerformance(
  segments: readonly AnalyticsSessionSegment[],
  cap: number = MATCH_POSITION_CAP,
): MatchPositionPerformance[] {
  const out: MatchPositionPerformance[] = [];
  for (let position = 1; position <= cap; position++) {
    const results = segments.flatMap((s) => {
      const r = s.results[position - 1];
      return r ? [r] : [];
    });
    if (results.length === 0) break; // every later position is empty too
    out.push({ position, record: computeRecord(results) });
  }
  return out;
}

export interface SessionDurationStats {
  /** Median gameplay duration over all segments (one-match segments count as 0). */
  medianMs: number | null;
  averageMs: number | null;
  /** Segments with ≥ 2 matches and duration > 0: the only ones a pace can be measured on. */
  measurableSegments: number;
  /** Matches / hour = Σ matches ÷ Σ duration over measurable segments; null when none. */
  matchesPerHour: number | null;
}

export function computeSessionDurationStats(
  segments: readonly AnalyticsSessionSegment[],
): SessionDurationStats {
  const durations = segments.map((s) => s.gameplayDurationMs);
  const measurable = segments.filter((s) => s.matchCount >= 2 && s.gameplayDurationMs > 0);
  const matches = measurable.reduce((n, s) => n + s.matchCount, 0);
  const duration = measurable.reduce((n, s) => n + s.gameplayDurationMs, 0);
  return {
    medianMs: median(durations),
    averageMs:
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    measurableSegments: measurable.length,
    matchesPerHour: duration > 0 ? matches / (duration / 3_600_000) : null,
  };
}

export interface SessionAnalytics {
  /** Analytics segments (after the virtual split) with at least one qualifying match. */
  segments: number;
  /** Distinct real session ids behind those segments. */
  sessions: number;
  /** Real sessions that contain more than one analytics segment (gaps ≥ 45 min). */
  splitSessions: number;
  /** Qualifying matches inside segments (session_id NULL excluded). */
  matches: number;
  medianMatchesPerSegment: number | null;
  duration: SessionDurationStats;
  streaks: SessionStreaks;
  recovery: RecoveryAfterLoss;
  halves: SessionHalves;
  positions: MatchPositionPerformance[];
}

export function computeSessionAnalytics(rows: readonly AnalyticsMatchRow[]): SessionAnalytics {
  const segments = segmentSessionMatches(rows);
  const perSession = new Map<string, number>();
  for (const s of segments) perSession.set(s.sessionId, (perSession.get(s.sessionId) ?? 0) + 1);
  return {
    segments: segments.length,
    sessions: perSession.size,
    splitSessions: [...perSession.values()].filter((n) => n > 1).length,
    matches: segments.reduce((n, s) => n + s.matchCount, 0),
    medianMatchesPerSegment: median(segments.map((s) => s.matchCount)),
    duration: computeSessionDurationStats(segments),
    streaks: computeSessionStreaks(segments),
    recovery: computeRecoveryAfterLoss(segments),
    halves: computeSessionHalves(segments),
    positions: computeMatchPositionPerformance(segments),
  };
}
