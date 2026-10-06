/**
 * Live state pushed to overlays and the dashboard. JSON-serializable (dates as ISO strings).
 *
 * Every realtime message carries the *full* authoritative state — clients replace, never
 * increment. Ratings are per character; W/L stays global.
 */
import type {
  CharacterProgress,
  RatingModel,
  SessionStatus,
  SessionSummary,
} from "@/domain/session/engine";
import { EMPTY_STATS } from "@/domain/session/engine";
import type { CharacterKey, MatchResult, RatingSystem } from "@/domain/sf6/types";
import type { OverlayConfig } from "./config";

export interface LiveRating {
  system: RatingSystem;
  value: number;
  rank: string | null;
}

export interface LiveCharacterProgress {
  characterKey: CharacterKey;
  characterName: string;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  ratingSystem: RatingSystem | null;
  initial: LiveRating | null;
  current: LiveRating | null;
  /** Same character, system and phase only; otherwise null (never invented). */
  delta: number | null;
  /** false when the starting rating of this character is unknown. */
  baselineKnown: boolean;
}

export interface LiveSessionState {
  /** "none" = the player has never started a session. */
  status: SessionStatus | "none";
  sessionId: string | null;
  ratingModel: RatingModel;
  startedAt: string | null;
  endedAt: string | null;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  /** Rounded to one decimal. */
  winRate: number;
  currentWinStreak: number;
  currentLossStreak: number;
  bestWinStreak: number;
  recentResults: MatchResult[];
  /** Character of the latest counted match (else favorite / first rated). Presentation only. */
  activeCharacterKey: CharacterKey | null;
  /** Played characters first (most recent first), then the rest of the roster. */
  characters: LiveCharacterProgress[];
}

export interface PlayerLiveState {
  player: { displayName: string };
  session: LiveSessionState;
  /** Server time when this snapshot was built; clients drop snapshots older than the current. */
  generatedAt: string;
}

export interface OverlayPayload {
  config: OverlayConfig;
  live: PlayerLiveState;
}

export function roundOneDecimal(n: number): number {
  return Math.round(n * 10) / 10;
}

function toLiveCharacter(p: CharacterProgress): LiveCharacterProgress {
  const live = (r: CharacterProgress["current"]): LiveRating | null =>
    r ? { system: r.system, value: r.value, rank: r.rank ?? null } : null;
  return {
    characterKey: p.characterKey,
    characterName: p.characterName,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    games: p.games,
    ratingSystem: p.ratingSystem,
    initial: live(p.initial),
    current: live(p.current),
    delta: p.delta,
    baselineKnown: p.initial !== null,
  };
}

export function toLiveSessionState(
  sessionId: string | null,
  summary: SessionSummary | null,
  idle: { characters: CharacterProgress[]; activeCharacterKey: CharacterKey | null },
): LiveSessionState {
  if (summary === null) {
    return {
      status: "none",
      sessionId: null,
      ratingModel: "per_character",
      startedAt: null,
      endedAt: null,
      ...EMPTY_STATS,
      recentResults: [],
      activeCharacterKey: idle.activeCharacterKey,
      characters: idle.characters.map(toLiveCharacter),
    };
  }
  return {
    status: summary.status,
    sessionId,
    ratingModel: summary.ratingModel,
    startedAt: summary.startedAt.toISOString(),
    endedAt: summary.endedAt?.toISOString() ?? null,
    wins: summary.wins,
    losses: summary.losses,
    draws: summary.draws,
    totalGames: summary.totalGames,
    winRate: roundOneDecimal(summary.winRate),
    currentWinStreak: summary.currentWinStreak,
    currentLossStreak: summary.currentLossStreak,
    bestWinStreak: summary.bestWinStreak,
    recentResults: summary.recentResults,
    activeCharacterKey: summary.activeCharacterKey,
    characters: summary.characters.map(toLiveCharacter),
  };
}

/**
 * Character whose rating should be shown: a pinned key (overlay `ratingCharacterKey`) if that
 * character is known, otherwise the active character. Null when nothing is known.
 */
export function pickRatingCharacter(
  session: LiveSessionState,
  pinnedKey: CharacterKey | null = null,
): LiveCharacterProgress | null {
  const byKey = (key: CharacterKey | null) =>
    key ? (session.characters.find((c) => c.characterKey === key) ?? null) : null;
  return byKey(pinnedKey) ?? byKey(session.activeCharacterKey);
}

/** Public (unauthenticated) view: strips internal identifiers. */
export function toPublicLiveState(live: PlayerLiveState): PlayerLiveState {
  return { ...live, session: { ...live.session, sessionId: null } };
}

/** Placeholder state for previews before any data exists. */
/** Sample rank for previews (rank-aware themes); defaults to the Master MR sample. */
export interface SampleRank {
  rank: string;
  system: "lp" | "mr";
  value: number;
}

export function sampleLiveState(sample?: SampleRank): PlayerLiveState {
  const rank = sample?.rank ?? "Master";
  const system = sample?.system ?? "mr";
  const value = sample?.value ?? 1684;
  return {
    player: { displayName: "Player" },
    session: {
      status: "active",
      sessionId: null,
      ratingModel: "per_character",
      startedAt: new Date(0).toISOString(),
      endedAt: null,
      wins: 12,
      losses: 5,
      draws: 0,
      totalGames: 17,
      winRate: 70.6,
      currentWinStreak: 4,
      currentLossStreak: 0,
      bestWinStreak: 6,
      recentResults: ["win", "loss", "win", "win", "win", "win"],
      activeCharacterKey: "ryu",
      characters: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          wins: 12,
          losses: 5,
          draws: 0,
          games: 17,
          ratingSystem: system,
          initial: { system, value: value - 96, rank },
          current: { system, value, rank },
          delta: 96,
          baselineKnown: true,
        },
      ],
    },
    generatedAt: new Date(0).toISOString(),
  };
}
