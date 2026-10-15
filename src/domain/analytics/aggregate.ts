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
import { calculateWinRate } from "@/domain/session/engine";
import type { CharacterKey, MatchMode, MatchResult } from "@/domain/sf6/types";
import { sampleBand, type SampleBand } from "./samples";

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
 * Start of a range: a ROLLING window of N × 24 h ending at `now` (an absolute instant, so it is
 * the same in every timezone; no calendar days). "all" ⇒ null (no lower bound).
 */
export function rangeStart(range: AnalyticsRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * 86_400_000);
}

/* ───────────────────────── Input / output ───────────────────────── */

/** Narrow projection of one recorded match (server/analytics/service.ts selects exactly this). */
export interface AnalyticsMatchRow {
  externalMatchId: string;
  playedAt: Date;
  result: MatchResult;
  mode: MatchMode;
  characterKey: CharacterKey;
  characterName: string;
  /** Session the match was counted in; null = recorded history outside any session. */
  sessionId: string | null;
}

export interface MatchRecord {
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  /** wins + losses: the win-rate denominator and the sample-band count. */
  decided: number;
  /** 0–100, or null when there is no decided match. */
  winRate: number | null;
  sample: SampleBand;
}

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
  overall: MatchRecord;
  recent: RecentForm[];
  characters: CharacterPerformance[];
  sessions: SessionCoverage;
  /** Matches whose mode SST could not identify (only possible with mode "all"). */
  unknownModeMatches: number;
  firstPlayedAt: Date | null;
  lastPlayedAt: Date | null;
}

/* ───────────────────────── Aggregation ───────────────────────── */

/** Newest first; ties broken by external id (same total order as the session engine). */
function newestFirst(a: AnalyticsMatchRow, b: AnalyticsMatchRow): number {
  const t = b.playedAt.getTime() - a.playedAt.getTime();
  if (t !== 0) return t;
  return a.externalMatchId < b.externalMatchId ? 1 : a.externalMatchId > b.externalMatchId ? -1 : 0;
}

export function computeRecord(results: readonly MatchResult[]): MatchRecord {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const r of results) {
    if (r === "win") wins++;
    else if (r === "loss") losses++;
    else draws++;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    draws,
    matches: wins + losses + draws,
    decided,
    winRate: decided > 0 ? calculateWinRate(wins, losses) : null,
    sample: sampleBand(decided),
  };
}

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

/** Everything the 6.0b page shows, from the range/filter's recorded matches (any order). */
export function computeAnalytics(rows: readonly AnalyticsMatchRow[]): AnalyticsSummary {
  const newest = [...rows].sort(newestFirst);
  return {
    overall: computeRecord(newest.map((m) => m.result)),
    recent: RECENT_WINDOWS.map((w) => computeRecentForm(newest, w)),
    characters: computeCharacterPerformance(newest),
    sessions: computeSessionCoverage(newest),
    unknownModeMatches: newest.filter((m) => m.mode === "unknown").length,
    firstPlayedAt: newest[newest.length - 1]?.playedAt ?? null,
    lastPlayedAt: newest[0]?.playedAt ?? null,
  };
}
