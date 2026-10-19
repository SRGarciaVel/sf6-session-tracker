/**
 * Analytics foundation (Phase 6.0b) — pure, deterministic aggregation over the matches SST has
 * RECORDED. No IO, no React, no clocks (the caller passes `now`). docs/architecture.md §Analytics.
 *
 * Trusted inputs only: result, played_at, own character, mode and session membership
 * (match.session_id). Ratings, opponent rank and opponent names are NOT used here: per-match MR
 * is not reliable and LP → MR session baselines are not segmented yet (Phase 6.3).
 *
 * Win rate = wins / (wins + losses); draws are counted and shown but never in the denominator.
 * No decided match ⇒ `winRate: null` (shown as "—"), never 0 % and never NaN.
 */
import { CHARACTER_KEY_PATTERN, type CharacterKey, type MatchResult } from "@/domain/sf6/types";
import { computeMatchupSection, type MatchupSection } from "./matchups";
import { computeReviewSection, type ReviewSection } from "./review";
import { computeReviewReplaySelections, type ReviewReplaySelection } from "./review-replays";
import {
  aggregateSegment,
  segmentSessionMatchRows,
  sessionAnalyticsOfSegments,
  type SessionAnalytics,
} from "./sessions";
import { computeRecord, newestFirst, type AnalyticsMatchRow, type MatchRecord } from "./record";

export { computeRecord, type AnalyticsMatchRow, type MatchRecord } from "./record";

/* ───────────────────────── Filters (URL state) ───────────────────────── */

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = "90d";

/**
 * "ranked" = matches Buckler marks as Ranked (the only mode SST identifies with certainty);
 * "all" = every recorded match, including non-ranked ones stored as mode "unknown".
 */
export const ANALYTICS_MODES = ["ranked", "all"] as const;
export type AnalyticsMode = (typeof ANALYTICS_MODES)[number];
export const DEFAULT_ANALYTICS_MODE: AnalyticsMode = "ranked";

const RANGE_DAYS: Record<Exclude<AnalyticsRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Lenient URL parsing: anything unexpected falls back to the default (never throws). */
export function parseAnalyticsRange(value: unknown): AnalyticsRange {
  const v = Array.isArray(value) ? value[0] : value;
  return (ANALYTICS_RANGES as readonly unknown[]).includes(v)
    ? (v as AnalyticsRange)
    : DEFAULT_ANALYTICS_RANGE;
}

export function parseAnalyticsMode(value: unknown): AnalyticsMode {
  const v = Array.isArray(value) ? value[0] : value;
  return (ANALYTICS_MODES as readonly unknown[]).includes(v)
    ? (v as AnalyticsMode)
    : DEFAULT_ANALYTICS_MODE;
}

/**
 * The ONLY values the analytics page reads from its URL: range and mode. Any other parameter
 * (e.g. a player or user id) is ignored — ownership comes from the session, never the request.
 */
/**
 * Own-character filter from the URL (`?character=aki`): SYNTAX only (a valid character key, or
 * null = all characters). Whether the key is one of the player's own recorded characters is
 * decided by the service; an unknown key falls back to all.
 */
export function parseAnalyticsCharacter(value: unknown): CharacterKey | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.length <= 40 && CHARACTER_KEY_PATTERN.test(v) ? v : null;
}

export interface AnalyticsSearch {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  /** Own-character filter (syntax-checked); null = all own characters. */
  character: CharacterKey | null;
}

export function parseAnalyticsSearchParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): AnalyticsSearch {
  return {
    range: parseAnalyticsRange(params.range),
    mode: parseAnalyticsMode(params.mode),
    character: parseAnalyticsCharacter(params.character),
  };
}

/**
 * Start of a range: a ROLLING window of N × 24 h ending at `now` (an absolute instant, so it is
 * the same in every timezone; no calendar days). "all" ⇒ null (no lower bound).
 */
export function rangeStart(range: AnalyticsRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
}

/* ───────────────────────── Input / output ───────────────────────── */

export const RECENT_WINDOWS = [5, 10, 20] as const;
export type RecentWindow = (typeof RECENT_WINDOWS)[number];

export interface RecentForm {
  window: RecentWindow;
  /** Matches actually available for this window (≤ window): never padded. */
  available: number;
  /** available === window. */
  complete: boolean;
  record: MatchRecord;
  /** Results, NEWEST first. */
  results: MatchResult[];
}

export interface CharacterPerformance {
  characterKey: CharacterKey;
  /** Display name of the character's most recent match in the range. */
  characterName: string;
  record: MatchRecord;
  /** Share of the range's recorded matches, 0–100. */
  usage: number;
  /** The character with the most matches (descriptive only; never "best"). */
  mostPlayed: boolean;
}

export interface SessionCoverage {
  /** Distinct sessions with at least one match of the range/filter (match.session_id). */
  sessions: number;
  /** Matches of the range/filter that belong to a session. */
  sessionMatches: number;
  /** sessionMatches / sessions; null without sessions. */
  averageMatchesPerSession: number | null;
  /** Matches recorded outside any session (session_id NULL). */
  outsideSessions: number;
}

export interface AnalyticsSummary {
  /** Own-character filter applied to the dataset; null = all own characters. */
  character: CharacterKey | null;
  overall: MatchRecord;
  recent: RecentForm[];
  /**
   * Cross-character OVERVIEW of the range/mode (NOT narrowed by the character filter, so it can
   * act as a navigator); everything else in the summary uses the filtered dataset.
   */
  characters: CharacterPerformance[];
  sessions: SessionCoverage;
  /** Matchups of the (filtered) dataset — Phase 6.1. */
  matchups: MatchupSection;
  /** Patterns inside recorded sessions of the (filtered) dataset — Phase 6.2. */
  sessionPerformance: SessionAnalytics;
  /** Review priorities of the (filtered) dataset — Phase 6.4A (descriptive signals, no causes). */
  review: ReviewSection;
  /** Matches whose mode SST could not identify (only possible with mode "all"). */
  unknownModeMatches: number;
  firstPlayedAt: Date | null;
  lastPlayedAt: Date | null;
}

/* ───────────────────────── Aggregation ───────────────────────── */

export function computeRecentForm(
  newest: readonly AnalyticsMatchRow[],
  window: RecentWindow,
): RecentForm {
  const results = newest.slice(0, window).map((m) => m.result);
  return {
    window,
    available: results.length,
    complete: results.length === window,
    record: computeRecord(results),
    results,
  };
}

export function computeCharacterPerformance(
  newest: readonly AnalyticsMatchRow[],
): CharacterPerformance[] {
  const byKey = new Map<CharacterKey, { name: string; results: MatchResult[] }>();
  for (const m of newest) {
    const entry = byKey.get(m.characterKey);
    if (entry) entry.results.push(m.result);
    else byKey.set(m.characterKey, { name: m.characterName, results: [m.result] });
  }
  const total = newest.length;
  const rows = [...byKey].map(([characterKey, { name, results }]) => ({
    characterKey,
    characterName: name,
    record: computeRecord(results),
    usage: total > 0 ? (results.length / total) * 100 : 0,
    mostPlayed: false,
  }));
  rows.sort(
    (a, b) =>
      b.record.matches - a.record.matches ||
      a.characterName.localeCompare(b.characterName) ||
      a.characterKey.localeCompare(b.characterKey),
  );
  const top = rows[0];
  // A tie for the most matches has no single "most played" character.
  if (top && rows[1]?.record.matches !== top.record.matches) top.mostPlayed = true;
  return rows;
}

export function computeSessionCoverage(rows: readonly AnalyticsMatchRow[]): SessionCoverage {
  const sessions = new Set<string>();
  let sessionMatches = 0;
  for (const m of rows) {
    if (m.sessionId === null) continue;
    sessions.add(m.sessionId);
    sessionMatches++;
  }
  return {
    sessions: sessions.size,
    sessionMatches,
    averageMatchesPerSession: sessions.size > 0 ? sessionMatches / sessions.size : null,
    outsideSessions: rows.length - sessionMatches,
  };
}

/**
 * Everything the page shows, from the range/mode's recorded matches (any order). With
 * `character`, the DATASET is that own character's matches: summary, recent form, sessions,
 * matchups, session performance and review all use it; only the character overview spans every own
 * character.
 */
export function computeAnalytics(
  rows: readonly AnalyticsMatchRow[],
  options: { character?: CharacterKey | null } = {},
): AnalyticsSummary {
  return computeAnalyticsDetailed(rows, options).summary;
}

export interface AnalyticsDetailed {
  summary: AnalyticsSummary;
  /**
   * Replay Selection (Phase 6.4C): one entry per `summary.review.signals` item, same order. Kept
   * OUT of the summary (and of ReviewReport / exports): it carries concrete replay ids.
   */
  reviewReplays: ReviewReplaySelection[];
}

/**
 * computeAnalytics + Replay Selection from the SAME dataset in one pass: the row-aware session
 * segments are built once and shared by session performance, review and replay selection.
 */
export function computeAnalyticsDetailed(
  rows: readonly AnalyticsMatchRow[],
  options: { character?: CharacterKey | null } = {},
): AnalyticsDetailed {
  const all = [...rows].sort(newestFirst);
  const character = options.character ?? null;
  const newest = character ? all.filter((m) => m.characterKey === character) : all;
  // Built once and shared by session performance, review and replay selection.
  const matchups = computeMatchupSection(newest);
  const rowSegments = segmentSessionMatchRows(newest);
  const segments = rowSegments.map(aggregateSegment);
  const sessionPerformance = sessionAnalyticsOfSegments(segments);
  const review = computeReviewSection({
    newest,
    matchups,
    segments,
    halves: sessionPerformance.halves,
  });
  const summary: AnalyticsSummary = {
    character,
    overall: computeRecord(newest.map((m) => m.result)),
    recent: RECENT_WINDOWS.map((w) => computeRecentForm(newest, w)),
    characters: computeCharacterPerformance(all),
    sessions: computeSessionCoverage(newest),
    matchups,
    sessionPerformance,
    review,
    unknownModeMatches: newest.filter((m) => m.mode === "unknown").length,
    firstPlayedAt: newest[newest.length - 1]?.playedAt ?? null,
    lastPlayedAt: newest[0]?.playedAt ?? null,
  };
  return {
    summary,
    reviewReplays: computeReviewReplaySelections({
      signals: review.signals,
      newest,
      segments: rowSegments,
    }),
  };
}
