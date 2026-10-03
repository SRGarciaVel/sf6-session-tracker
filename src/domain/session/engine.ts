/**
 * Session Engine — pure domain logic for SF6 play sessions.
 *
 * No IO, no React, no database. Everything here is deterministic and unit tested
 * (engine.test.ts). Persistence and transport layers call into these functions; they never
 * re-implement W/L, win-rate or streak logic themselves.
 */

import type { MatchMode, MatchResult } from "@/domain/sf6/types";
import { buildRatingView, type RatingSnapshot, type RatingView } from "@/domain/sf6/rating";

export type SessionStatus = "active" | "ended";

export interface SessionFilter {
  modes: MatchMode[];
}

export const DEFAULT_SESSION_FILTER: SessionFilter = { modes: ["ranked"] };

/** Everything recorded when a session starts. Immutable for the life of the session. */
export interface SessionBaseline {
  startedAt: Date;
  endedAt: Date | null;
  /** Most recent match known when the session started (never counted). */
  baselineMatchId: string | null;
  baselinePlayedAt: Date | null;
  initialRating: RatingSnapshot;
  filter: SessionFilter;
}

/** Minimal match data the engine needs. */
export interface SessionMatch {
  externalMatchId: string;
  playedAt: Date;
  mode: MatchMode;
  result: MatchResult;
  playerCharacter: string | null;
  opponentCharacter: string | null;
  opponentName: string | null;
}

export interface SessionStats {
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  /** wins / (wins + losses) * 100. 0 when there are no decided games. Never NaN. */
  winRate: number;
  currentWinStreak: number;
  currentLossStreak: number;
  bestWinStreak: number;
  /** Most recent results, oldest first (max RECENT_FORM_LENGTH). */
  recentResults: MatchResult[];
}

export interface SessionState {
  /** Unique by externalMatchId, sorted by playedAt ascending (ties broken by id). */
  matches: readonly SessionMatch[];
  stats: SessionStats;
}

export interface SessionSummary extends SessionStats {
  status: SessionStatus;
  startedAt: Date;
  endedAt: Date | null;
  rating: RatingView;
}

export const RECENT_FORM_LENGTH = 10;

export const EMPTY_STATS: SessionStats = Object.freeze({
  wins: 0,
  losses: 0,
  draws: 0,
  totalGames: 0,
  winRate: 0,
  currentWinStreak: 0,
  currentLossStreak: 0,
  bestWinStreak: 0,
  recentResults: [],
}) as SessionStats;

export function emptySessionState(): SessionState {
  return { matches: [], stats: EMPTY_STATS };
}

export function calculateWinRate(wins: number, losses: number): number {
  const decided = wins + losses;
  if (decided <= 0) return 0;
  return (wins / decided) * 100;
}

export function compareMatches(a: SessionMatch, b: SessionMatch): number {
  const byTime = a.playedAt.getTime() - b.playedAt.getTime();
  if (byTime !== 0) return byTime;
  return a.externalMatchId < b.externalMatchId ? -1 : a.externalMatchId > b.externalMatchId ? 1 : 0;
}

/** Stats for a list of matches. Input order doesn't matter; duplicates are ignored. */
export function computeSessionStats(matches: readonly SessionMatch[]): SessionStats {
  const sorted = normalizeMatchList(matches);
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let bestWinStreak = 0;

  for (const match of sorted) {
    switch (match.result) {
      case "win":
        wins++;
        currentWinStreak++;
        currentLossStreak = 0;
        bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
        break;
      case "loss":
        losses++;
        currentLossStreak++;
        currentWinStreak = 0;
        break;
      case "draw":
        // Draws don't count toward win rate and break both streaks.
        draws++;
        currentWinStreak = 0;
        currentLossStreak = 0;
        break;
    }
  }

  return {
    wins,
    losses,
    draws,
    totalGames: wins + losses + draws,
    winRate: calculateWinRate(wins, losses),
    currentWinStreak,
    currentLossStreak,
    bestWinStreak,
    recentResults: sorted.slice(-RECENT_FORM_LENGTH).map((m) => m.result),
  };
}

/** Dedupe by externalMatchId (first occurrence wins) and sort chronologically. */
export function normalizeMatchList(matches: readonly SessionMatch[]): SessionMatch[] {
  const seen = new Set<string>();
  const unique: SessionMatch[] = [];
  for (const match of matches) {
    if (seen.has(match.externalMatchId)) continue;
    seen.add(match.externalMatchId);
    unique.push(match);
  }
  return unique.sort(compareMatches);
}

export function buildSessionState(matches: readonly SessionMatch[]): SessionState {
  const normalized = normalizeMatchList(matches);
  return { matches: normalized, stats: computeSessionStats(normalized) };
}

/**
 * Apply one match to a session state.
 *
 * - Idempotent: applying an already-known match returns the same state object.
 * - Order-independent: a late (older) match is inserted chronologically and streaks recomputed.
 */
export function applyMatchToSession(state: SessionState, match: SessionMatch): SessionState {
  if (state.matches.some((m) => m.externalMatchId === match.externalMatchId)) return state;
  return buildSessionState([...state.matches, match]);
}

/**
 * Does a newly observed match belong to the session?
 *
 * Called once per match at ingestion time; the answer is persisted (match.session_id), so a
 * match can never be counted twice nor move between sessions.
 */
export function isMatchInSession(
  baseline: SessionBaseline,
  match: Pick<SessionMatch, "externalMatchId" | "playedAt" | "mode">,
  options: { startGraceMs?: number } = {},
): boolean {
  if (!baseline.filter.modes.includes(match.mode)) return false;
  if (baseline.baselineMatchId !== null && match.externalMatchId === baseline.baselineMatchId) {
    return false;
  }

  const playedAt = match.playedAt.getTime();
  if (Number.isNaN(playedAt)) return false;

  const windowStart = baseline.startedAt.getTime() - (options.startGraceMs ?? 0);
  if (playedAt < windowStart) return false;

  // Anything at or before the last match known at baseline time is pre-session history.
  if (baseline.baselinePlayedAt !== null && playedAt <= baseline.baselinePlayedAt.getTime()) {
    return false;
  }

  if (baseline.endedAt !== null && playedAt > baseline.endedAt.getTime()) return false;
  return true;
}

/** Choose the baseline (latest known match) from previously known matches. */
export function pickBaselineMatch<T extends Pick<SessionMatch, "externalMatchId" | "playedAt">>(
  knownMatches: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const match of knownMatches) {
    if (
      latest === null ||
      match.playedAt.getTime() > latest.playedAt.getTime() ||
      (match.playedAt.getTime() === latest.playedAt.getTime() &&
        match.externalMatchId > latest.externalMatchId)
    ) {
      latest = match;
    }
  }
  return latest;
}

export function summarizeSession(input: {
  status: SessionStatus;
  baseline: SessionBaseline;
  matches: readonly SessionMatch[];
  currentRating: RatingSnapshot;
}): SessionSummary {
  const stats = computeSessionStats(input.matches);
  return {
    ...stats,
    status: input.status,
    startedAt: input.baseline.startedAt,
    endedAt: input.baseline.endedAt,
    rating: buildRatingView(input.baseline.initialRating, input.currentRating),
  };
}
