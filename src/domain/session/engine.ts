/**
 * Session Engine — pure domain logic for SF6 play sessions.
 *
 * No IO, no React, no database. Everything here is deterministic and unit tested
 * (engine.test.ts). Persistence and transport layers call into these functions; they never
 * re-implement W/L, win-rate or streak logic themselves.
 */

import { ratingDelta } from "@/domain/sf6/rating";
import type {
  CharacterKey,
  MatchMode,
  MatchResult,
  RatingPoint,
  RatingSystem,
} from "@/domain/sf6/types";

export type SessionStatus = "active" | "ended";

export interface SessionFilter {
  modes: MatchMode[];
}

export const DEFAULT_SESSION_FILTER: SessionFilter = { modes: ["ranked"] };

/**
 * Session membership baseline, recorded when a session starts. Immutable for the life of the
 * session. (Ratings are NOT here: they are per character, see CharacterBaseline.)
 */
export interface SessionBaseline {
  startedAt: Date;
  endedAt: Date | null;
  /** Most recent match known when the session started (never counted). */
  baselineMatchId: string | null;
  baselinePlayedAt: Date | null;
  filter: SessionFilter;
}

/** "per_character" for current sessions; "legacy" for sessions created before per-character ratings. */
export type RatingModel = "per_character" | "legacy";

/** Minimal match data the engine needs. */
export interface SessionMatch {
  externalMatchId: string;
  playedAt: Date;
  mode: MatchMode;
  result: MatchResult;
  characterKey: CharacterKey;
  characterName: string;
  opponentCharacter: string | null;
  opponentName: string | null;
  ratingBefore?: RatingPoint | null;
  ratingAfter?: RatingPoint | null;
}

/** Per-character rating captured for a session (at start, or from an earlier snapshot). */
export interface CharacterBaseline {
  characterKey: CharacterKey;
  characterName: string;
  source: "session_start" | "prior_snapshot";
  rating: RatingPoint | null;
  capturedAt: Date;
}

/** A known rating of a character at a moment (current profile, or frozen final of an ended session). */
export interface CharacterSnapshot {
  characterKey: CharacterKey;
  characterName: string;
  rating: RatingPoint | null;
  observedAt: Date;
}

export type InitialSource = "session_start" | "prior_snapshot" | "match_before" | "unknown";
export type CurrentSource = "match_after" | "snapshot" | "baseline" | "unknown";

export interface CharacterProgress {
  characterKey: CharacterKey;
  characterName: string;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  lastPlayedAt: Date | null;
  /** System of the shown rating (current if known, else initial). */
  ratingSystem: RatingSystem | null;
  initial: RatingPoint | null;
  current: RatingPoint | null;
  /** current − initial for the SAME character, system and phase; otherwise null. */
  delta: number | null;
  initialSource: InitialSource;
  currentSource: CurrentSource;
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
  ratingModel: RatingModel;
  /** Played characters first (most recent first), then the rest of the baseline. */
  characters: CharacterProgress[];
  activeCharacterKey: CharacterKey | null;
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
 * Primary criterion: IDENTITY. Matches known when the session started (the baseline snapshot)
 * never count — at runtime this is enforced by ingestion (ON CONFLICT: only newly inserted rows
 * are evaluated) and here by `knownMatchIds` / `baselineMatchId`.
 *
 * Secondary protection: TIME, so an old match that merely shows up late is not counted:
 *   - played at or after the newest baseline match (strictly older ⇒ pre-session), and
 *   - not older than `startedAt − grace` (grace absorbs coarse/offset CFN timestamps), and
 *   - not after the session ended.
 *
 * Called once per match at ingestion time; the answer is persisted (match.session_id), so a
 * match can never be counted twice nor move between sessions.
 */
export function isMatchInSession(
  baseline: SessionBaseline,
  match: Pick<SessionMatch, "externalMatchId" | "playedAt" | "mode">,
  options: { startGraceMs?: number; knownMatchIds?: ReadonlySet<string> } = {},
): boolean {
  if (!baseline.filter.modes.includes(match.mode)) return false;
  if (options.knownMatchIds?.has(match.externalMatchId)) return false;
  if (baseline.baselineMatchId !== null && match.externalMatchId === baseline.baselineMatchId) {
    return false;
  }

  const playedAt = match.playedAt.getTime();
  if (Number.isNaN(playedAt)) return false;

  const windowStart = baseline.startedAt.getTime() - (options.startGraceMs ?? 0);
  if (playedAt < windowStart) return false;

  // Strictly older than the newest match known at baseline time ⇒ pre-session history.
  if (baseline.baselinePlayedAt !== null && playedAt < baseline.baselinePlayedAt.getTime()) {
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

/**
 * Per-character progress. Pure.
 *
 * Initial rating, by priority:
 *   1. baseline captured at session start (or an earlier profile snapshot);
 *   2. `ratingBefore` of the character's first match in the session;
 *   3. unknown (null) — never a fabricated value.
 * Current rating, by priority:
 *   1. `ratingAfter` of the character's latest match;
 *   2. snapshot (profile / frozen final) — only if not older than that latest match;
 *   3. the baseline itself if the character has not played yet.
 * delta = current − initial only for the same character, system and phase; otherwise null.
 */
export function computeCharacterProgress(input: {
  baselines: readonly CharacterBaseline[];
  matches: readonly SessionMatch[];
  current: readonly CharacterSnapshot[];
}): CharacterProgress[] {
  const sorted = normalizeMatchList(input.matches);
  const byKey = new Map<CharacterKey, SessionMatch[]>();
  for (const m of sorted) {
    const list = byKey.get(m.characterKey);
    if (list) list.push(m);
    else byKey.set(m.characterKey, [m]);
  }
  const baselineByKey = new Map(input.baselines.map((b) => [b.characterKey, b]));
  const currentByKey = new Map(input.current.map((c) => [c.characterKey, c]));
  const keys = new Set<CharacterKey>([...byKey.keys(), ...baselineByKey.keys()]);

  const out: CharacterProgress[] = [];
  for (const key of keys) {
    const ms = byKey.get(key) ?? [];
    const baseline = baselineByKey.get(key);
    const snapshot = currentByKey.get(key);
    const first = ms[0];
    const last = ms[ms.length - 1];

    let initial: RatingPoint | null = null;
    let initialSource: InitialSource = "unknown";
    if (baseline?.rating) {
      initial = baseline.rating;
      initialSource = baseline.source;
    } else if (first?.ratingBefore) {
      initial = first.ratingBefore;
      initialSource = "match_before";
    }

    let current: RatingPoint | null = null;
    let currentSource: CurrentSource = "unknown";
    if (last?.ratingAfter) {
      current = last.ratingAfter;
      currentSource = "match_after";
    } else if (
      snapshot?.rating &&
      (!last || snapshot.observedAt.getTime() >= last.playedAt.getTime())
    ) {
      current = snapshot.rating;
      currentSource = "snapshot";
    } else if (!last && initial) {
      current = initial;
      currentSource = "baseline";
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (const m of ms) {
      if (m.result === "win") wins++;
      else if (m.result === "loss") losses++;
      else draws++;
    }

    out.push({
      characterKey: key,
      characterName:
        last?.characterName ?? snapshot?.characterName ?? baseline?.characterName ?? key,
      wins,
      losses,
      draws,
      games: ms.length,
      lastPlayedAt: last?.playedAt ?? null,
      ratingSystem: current?.system ?? initial?.system ?? null,
      initial,
      current,
      delta: ratingDelta(initial, current),
      initialSource,
      currentSource,
    });
  }

  return out.sort((a, b) => {
    if (a.lastPlayedAt && b.lastPlayedAt)
      return b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime();
    if (a.lastPlayedAt) return -1;
    if (b.lastPlayedAt) return 1;
    return a.characterName.localeCompare(b.characterName);
  });
}

/**
 * Character to feature in UI/overlay (presentation only, never mutates history):
 * the character of the latest counted session match; else the favorite; else the first
 * character with a rating; else null.
 */
export function resolveActiveCharacter(input: {
  matches: readonly SessionMatch[];
  favoriteCharacterKey: CharacterKey | null;
  characters: readonly Pick<CharacterSnapshot, "characterKey" | "rating">[];
}): CharacterKey | null {
  const sorted = normalizeMatchList(input.matches);
  const last = sorted[sorted.length - 1];
  if (last) return last.characterKey;
  if (input.favoriteCharacterKey) return input.favoriteCharacterKey;
  return input.characters.find((c) => c.rating !== null)?.characterKey ?? null;
}

export function summarizeSession(input: {
  status: SessionStatus;
  ratingModel: RatingModel;
  baseline: SessionBaseline;
  matches: readonly SessionMatch[];
  characterBaselines: readonly CharacterBaseline[];
  current: readonly CharacterSnapshot[];
  favoriteCharacterKey: CharacterKey | null;
}): SessionSummary {
  const stats = computeSessionStats(input.matches);
  return {
    ...stats,
    status: input.status,
    startedAt: input.baseline.startedAt,
    endedAt: input.baseline.endedAt,
    ratingModel: input.ratingModel,
    characters: computeCharacterProgress({
      baselines: input.characterBaselines,
      matches: input.matches,
      current: input.current,
    }),
    activeCharacterKey: resolveActiveCharacter({
      matches: input.matches,
      favoriteCharacterKey: input.favoriteCharacterKey,
      characters: input.current,
    }),
  };
}
