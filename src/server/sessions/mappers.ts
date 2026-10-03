/** Row ↔ domain mapping. Keeps Drizzle row shapes out of the Session Engine. */
import {
  DEFAULT_SESSION_FILTER,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionBaseline,
  type SessionMatch,
} from "@/domain/session/engine";
import { ratingPointOf } from "@/domain/sf6/rating";
import type { CharacterRatingProfile, RatingPoint, RatingSystem } from "@/domain/sf6/types";
import type { GameSessionRow, MatchRow } from "@/server/db/schema";
import { playerCharacterRating, sessionCharacterBaseline } from "@/server/db/schema";

type PlayerCharacterRatingRow = typeof playerCharacterRating.$inferSelect;
type SessionCharacterBaselineRow = typeof sessionCharacterBaseline.$inferSelect;

export function sessionRowToBaseline(row: GameSessionRow): SessionBaseline {
  return {
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    baselineMatchId: row.baselineMatchId,
    baselinePlayedAt: row.baselinePlayedAt,
    filter: Array.isArray(row.filter?.modes) ? row.filter : DEFAULT_SESSION_FILTER,
  };
}

function point(
  system: RatingSystem | null,
  value: number | null,
  extra: { rank?: string | null; rankTier?: string | null; phase?: number | null } = {},
): RatingPoint | null {
  if (system === null || value === null) return null;
  return {
    system,
    value,
    rank: extra.rank ?? null,
    rankTier: extra.rankTier ?? null,
    phase: extra.phase ?? null,
  };
}

export function matchRowToSessionMatch(row: MatchRow): SessionMatch {
  return {
    externalMatchId: row.externalMatchId,
    playedAt: row.playedAt,
    mode: row.mode,
    result: row.result,
    characterKey: row.characterKey,
    characterName: row.characterName,
    opponentCharacter: row.opponentCharacter,
    opponentName: row.opponentName,
    ratingBefore: point(row.ratingBeforeSystem, row.ratingBeforeValue, {
      rank: row.ratingBeforeRank,
      phase: row.ratingBeforePhase,
    }),
    ratingAfter: point(row.ratingAfterSystem, row.ratingAfterValue, {
      rank: row.ratingAfterRank,
      rankTier: row.ratingAfterRankTier,
      phase: row.ratingAfterPhase,
    }),
  };
}

export function characterRowToProfile(row: PlayerCharacterRatingRow): CharacterRatingProfile {
  return {
    characterKey: row.characterKey,
    characterName: row.characterName,
    rank: row.rank,
    rankTier: row.rankTier,
    ratingSystem: row.ratingSystem,
    leaguePoints: row.leaguePoints,
    masterRate: row.masterRate,
    phase: row.phase,
  };
}

/** Current per-character snapshot (from the latest profile observation). */
export function characterRowToSnapshot(row: PlayerCharacterRatingRow): CharacterSnapshot {
  return {
    characterKey: row.characterKey,
    characterName: row.characterName,
    rating: ratingPointOf(characterRowToProfile(row)),
    observedAt: row.observedAt,
  };
}

/** Session-start baseline; null for rows that only carry a final value (source "none"). */
export function baselineRowToCharacterBaseline(
  row: SessionCharacterBaselineRow,
): CharacterBaseline | null {
  if (row.source === "none") return null;
  return {
    characterKey: row.characterKey,
    characterName: row.characterName,
    source: row.source,
    rating: ratingPointOf({
      characterKey: row.characterKey,
      characterName: row.characterName,
      rank: row.initialRank,
      rankTier: row.initialRankTier,
      ratingSystem: row.initialRatingSystem,
      leaguePoints: row.initialLeaguePoints,
      masterRate: row.initialMasterRate,
      phase: row.initialPhase,
    }),
    capturedAt: row.capturedAt,
  };
}

/** Frozen final value of an ended session; null if the session never finalized this character. */
export function baselineRowToFinalSnapshot(
  row: SessionCharacterBaselineRow,
): CharacterSnapshot | null {
  if (!row.finalizedAt) return null;
  return {
    characterKey: row.characterKey,
    characterName: row.characterName,
    rating: ratingPointOf({
      characterKey: row.characterKey,
      characterName: row.characterName,
      rank: row.finalRank,
      rankTier: row.finalRankTier,
      ratingSystem: row.finalRatingSystem,
      leaguePoints: row.finalLeaguePoints,
      masterRate: row.finalMasterRate,
      phase: row.finalPhase,
    }),
    observedAt: row.finalizedAt,
  };
}

export type { PlayerCharacterRatingRow, SessionCharacterBaselineRow };
