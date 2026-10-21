/**
 * Phase 5.6B1 — presentational contracts of the Fight Session components. Plain data in,
 * markup out: no fetching, no stores, no domain math (adapters.ts maps SST state to these).
 */
import type { CompanionLink, DataFreshness } from "@/domain/companion/readiness";
import type { MatchResult, RatingSystem } from "@/domain/sf6/types";

/**
 * What the session indicator says.
 * - `ready` / `blocked`: no active session; whether a new one can start (Companion readiness).
 * - `live`: active session with data arriving.
 * - `degraded`: active session, but tracking has no recent data (tracker failures or a quiet
 *   Companion). The session itself is still active.
 * - `ended`: the session shown has ended (recap).
 */
export type SessionIndicatorStatus = "ready" | "blocked" | "live" | "degraded" | "ended";

export interface ScoreboardData {
  wins: number;
  losses: number;
  draws: number;
  /** All counted matches (wins + losses + draws). */
  games: number;
  /** Engine win rate in percent (0–100); null when no game is decided yet (shown as «—»). */
  winRate: number | null;
}

export interface RatingData {
  characterName: string;
  system: RatingSystem;
  /** Rating at session start; null = unknown baseline. */
  initial: number | null;
  /** Latest rating to show (confirmed, or the held one while `pending`); null = unknown. */
  current: number | null;
  /** Engine session delta (same character/system/phase only); null = unknown. */
  delta: number | null;
  /** The post-match rating has not been observed yet; `current` is the last confirmed value. */
  pending: boolean;
}

export interface ActivityItem {
  id: string;
  result: MatchResult;
  characterName: string;
  opponentCharacter: string | null;
  opponentName: string | null;
  /** ISO time the match was played; null when unknown. */
  playedAt: string | null;
}

export interface CompanionStatusData {
  /** null when this deployment does not use the Companion (nothing to report). */
  link: CompanionLink | null;
  buckler: DataFreshness | null;
  /** Latest data received from the Companion (ISO); null = never. */
  lastSyncAt: string | null;
}

export interface OverlayStatusData {
  total: number;
  /** OBS browser sources currently connected (all overlays); null = unknown. */
  inObs: number | null;
}

export type OverlayKindLabel = "session" | "rankProgress";
