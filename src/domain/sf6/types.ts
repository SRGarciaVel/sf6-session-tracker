/**
 * Normalized Street Fighter 6 data model.
 *
 * This is the contract between the data provider (your CFN extractor) and the rest of the app.
 * Providers translate whatever Capcom returns into these shapes; nothing else in the codebase
 * knows about raw CFN payloads.
 */

export const MATCH_MODES = ["ranked", "casual", "battle_hub", "custom_room", "unknown"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_RESULTS = ["win", "loss", "draw"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export type ControlType = "classic" | "modern" | "dynamic";

export interface NormalizedPlayerProfile {
  /** CFN User ID (the numeric "short id" shown on Buckler's Boot Camp). */
  cfnUserId: string;
  displayName: string;
  /** Display name of the main / most recently used character, e.g. "Ryu". */
  mainCharacter: string | null;
  /** Rank label as reported by the source, e.g. "Diamond 3", "Master". */
  rank: string | null;
  /** League Points. Usually meaningful below Master. */
  leaguePoints: number | null;
  /** Master Rate. Only for Master rank players. */
  masterRate: number | null;
}

export interface RatingAfterMatch {
  leaguePoints: number | null;
  masterRate: number | null;
}

export interface NormalizedSF6Match {
  /** Stable unique id from the source (replay id / battle id). Never a timestamp. */
  externalMatchId: string;
  playedAt: Date;
  mode: MatchMode;
  /** Result from the tracked player's perspective (P1/P2 already resolved by the provider). */
  result: MatchResult;
  playerCharacter: string | null;
  playerControlType?: ControlType | null;
  opponent: {
    name: string | null;
    character: string | null;
    rank?: string | null;
  };
  /** Tracked player's LP/MR right after this match, if the source exposes it. */
  ratingAfter?: RatingAfterMatch | null;
}
