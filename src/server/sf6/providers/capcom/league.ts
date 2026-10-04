/**
 * Capcom `league_info` → tracker rating fields. Pure.
 *
 * Evidence (HAR 2026-10-03, CFN 1733837998 — see docs/capcom-provider.md §Mappings):
 *   - `league_rank` 31 is labelled "Diamond 1" by Capcom itself (`league_rank_info.league_rank_name`).
 *   - Master: Capcom's play page renders MR when `master_league >= 36`; all 9 Master characters in
 *     the fixture have master_league=36 and master_rating>0, all others 0/0.
 *   - `league_point: -1` (always with `league_rank: 39`) = no rating yet (placement pending):
 *     the A.K.I. replay right before placement has -1/39, the next one 19000/31.
 * No other rank number has a label in any captured payload or JS bundle, so they stay null
 * (the raw number is kept as `leagueRankRaw`). Do not complete this table from memory.
 */
import type { RatingSystem } from "@/domain/sf6/types";
import type { CapcomLeagueInfo } from "./schemas";

/** Rank labels observed verbatim in Capcom payloads. Extend only with captured evidence. */
export const OBSERVED_LEAGUE_RANK_LABELS: Readonly<Record<number, string>> = {
  31: "Diamond 1",
};

/** Capcom's play page shows Master Rate when master_league >= this value. */
export const MASTER_LEAGUE_MIN = 36;
/** The base Master league; deeper values (37 seen in JS) have no observed label. */
export const MASTER_LEAGUE_BASE = 36;
/** league_point sentinel for "not rated yet". */
export const UNRATED_LEAGUE_POINT = -1;

export interface MappedLeague {
  ratingSystem: RatingSystem | null;
  leaguePoints: number | null;
  masterRate: number | null;
  rank: string | null;
  rankTier: string | null;
  leagueRankRaw: number;
  /** false when the league_rank number has no evidence-backed label. */
  rankKnown: boolean;
  unrated: boolean;
}

/** "Diamond 1" → "diamond-1". */
export function rankLabelToTier(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @param labelHints extra league_rank → label pairs read from the SAME payload
 *   (fighter_banner_info.favorite_character_league_info.league_rank_info), i.e. Capcom's own words.
 */
export function mapLeagueInfo(
  info: CapcomLeagueInfo,
  labelHints: ReadonlyMap<number, string> = new Map(),
): MappedLeague {
  const base = { leagueRankRaw: info.league_rank };
  if (info.league_point < 0) {
    return {
      ...base,
      ratingSystem: null,
      leaguePoints: null,
      masterRate: null,
      rank: null,
      rankTier: null,
      rankKnown: true,
      unrated: true,
    };
  }
  if (info.master_league >= MASTER_LEAGUE_MIN) {
    const isBase = info.master_league === MASTER_LEAGUE_BASE;
    return {
      ...base,
      ratingSystem: "mr",
      leaguePoints: info.league_point,
      masterRate: info.master_rating > 0 ? info.master_rating : null,
      rank: isBase ? "Master" : null,
      rankTier: isBase ? "master" : null,
      rankKnown: isBase,
      unrated: false,
    };
  }
  const label = labelHints.get(info.league_rank) ?? OBSERVED_LEAGUE_RANK_LABELS[info.league_rank];
  return {
    ...base,
    ratingSystem: "lp",
    leaguePoints: info.league_point,
    masterRate: null,
    rank: label ?? null,
    rankTier: label ? rankLabelToTier(label) : null,
    rankKnown: label !== undefined,
    unrated: false,
  };
}
