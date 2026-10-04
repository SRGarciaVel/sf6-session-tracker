/**
 * Normalized Street Fighter 6 data model.
 *
 * This is the contract between the data provider (your CFN extractor) and the rest of the app.
 * Providers translate whatever Capcom returns into these shapes; nothing else in the codebase
 * knows about raw CFN payloads.
 *
 * KEY RULE: in SF6 rank / LP / MR belong to a CHARACTER, not to the player. Every rating value
 * travels together with its `characterKey` and its `ratingSystem`.
 */

export const MATCH_MODES = ["ranked", "casual", "battle_hub", "custom_room", "unknown"] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export const MATCH_RESULTS = ["win", "loss", "draw"] as const;
export type MatchResult = (typeof MATCH_RESULTS)[number];

export const RATING_SYSTEMS = ["lp", "mr"] as const;
/** "lp" = League Points (Rookie → Diamond), "mr" = Master Rate (Master). */
export type RatingSystem = (typeof RATING_SYSTEMS)[number];

export type ControlType = "classic" | "modern" | "dynamic";

/**
 * Stable technical character id, e.g. "aki", "kimberly", "m-bison", "chun-li".
 * Never a display name (those are localized).
 */
export type CharacterKey = string;

/** Valid characterKey: lowercase slug ("aki", "m-bison"). */
export const CHARACTER_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Current competitive state of ONE character of the player. */
export interface CharacterRatingProfile {
  characterKey: CharacterKey;
  /** Display name, presentation only. */
  characterName: string;
  /** Rank label as reported by the source, e.g. "Diamond 3", "Master". */
  rank: string | null;
  /** Normalized tier id if the source allows it, e.g. "diamond-3", "master". */
  rankTier: string | null;
  /** Which number is the competitive rating for this character. Provided, never inferred. */
  ratingSystem: RatingSystem | null;
  leaguePoints: number | null;
  masterRate: number | null;
  /** MR phase / season, if the source exposes it. Ratings of different phases are not comparable. */
  phase?: number | null;
}

export interface NormalizedPlayerProfile {
  /** CFN User ID (the numeric "user code" shown on Buckler's Boot Camp). */
  cfnUserId: string;
  displayName: string;
  /** Character shown on the CFN profile card, if any. */
  favoriteCharacterKey?: CharacterKey | null;
  /** One entry per character that has league data. */
  characters: CharacterRatingProfile[];
}

/** A rating value with the system it belongs to. Only comparable to the same system + phase. */
export interface RatingPoint {
  system: RatingSystem;
  value: number;
  rank?: string | null;
  rankTier?: string | null;
  phase?: number | null;
}

export interface NormalizedSF6Match {
  /** Stable unique id from the source (replay id / battle id). Never a timestamp. */
  externalMatchId: string;
  /** Absolute instant (UTC). */
  playedAt: Date;
  mode: MatchMode;
  /** Result from the tracked player's perspective (P1/P2 already resolved by the provider). */
  result: MatchResult;
  /** Character the tracked player used. Required. */
  characterKey: CharacterKey;
  characterName: string;
  playerControlType?: ControlType | null;
  opponent: {
    name: string | null;
    characterKey?: CharacterKey | null;
    characterName?: string | null;
    rank?: string | null;
  };
  /** Tracked player's rating for `characterKey` right before / after this match, if exposed. */
  ratingBefore?: RatingPoint | null;
  ratingAfter?: RatingPoint | null;
}
