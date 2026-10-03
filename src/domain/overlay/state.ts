/**
 * Live state pushed to overlays and the dashboard. JSON-serializable (dates as ISO strings).
 *
 * Every realtime message carries the *full* authoritative state — clients replace, never
 * increment.
 */
import type { SessionSummary, SessionStatus } from "@/domain/session/engine";
import { EMPTY_STATS } from "@/domain/session/engine";
import { buildRatingView, EMPTY_RATING, type RatingSnapshot, type RatingView } from "@/domain/sf6/rating";
import type { MatchResult } from "@/domain/sf6/types";
import type { OverlayConfig } from "./config";

export interface LiveSessionState {
  /** "none" = the player has never started a session. */
  status: SessionStatus | "none";
  sessionId: string | null;
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
  rating: RatingView;
}

export interface PlayerLiveState {
  player: {
    displayName: string;
    mainCharacter: string | null;
  };
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

export function toLiveSessionState(
  sessionId: string | null,
  summary: SessionSummary | null,
  currentRating: RatingSnapshot,
): LiveSessionState {
  if (summary === null) {
    return {
      status: "none",
      sessionId: null,
      startedAt: null,
      endedAt: null,
      ...EMPTY_STATS,
      recentResults: [],
      rating: buildRatingView(currentRating, currentRating),
    };
  }
  return {
    status: summary.status,
    sessionId,
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
    rating: summary.rating,
  };
}

/** Placeholder state for previews before any data exists. */
export function sampleLiveState(): PlayerLiveState {
  return {
    player: { displayName: "Player", mainCharacter: "Ryu" },
    session: {
      status: "active",
      sessionId: null,
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
      rating: buildRatingView(
        { ...EMPTY_RATING, rank: "Master", masterRate: 1588 },
        { ...EMPTY_RATING, rank: "Master", masterRate: 1684 },
      ),
    },
    generatedAt: new Date(0).toISOString(),
  };
}
