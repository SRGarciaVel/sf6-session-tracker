/** Row ↔ domain mapping. Keeps Drizzle row shapes out of the Session Engine. */
import { DEFAULT_SESSION_FILTER, type SessionBaseline, type SessionMatch } from "@/domain/session/engine";
import type { RatingSnapshot } from "@/domain/sf6/rating";
import type { GameSessionRow, MatchRow, Sf6PlayerRow } from "@/server/db/schema";

export function sessionRowToBaseline(row: GameSessionRow): SessionBaseline {
  return {
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    baselineMatchId: row.baselineMatchId,
    baselinePlayedAt: row.baselinePlayedAt,
    initialRating: {
      rank: row.initialRank,
      leaguePoints: row.initialLeaguePoints,
      masterRate: row.initialMasterRate,
    },
    filter: Array.isArray(row.filter?.modes) ? row.filter : DEFAULT_SESSION_FILTER,
  };
}

export function matchRowToSessionMatch(row: MatchRow): SessionMatch {
  return {
    externalMatchId: row.externalMatchId,
    playedAt: row.playedAt,
    mode: row.mode,
    result: row.result,
    playerCharacter: row.playerCharacter,
    opponentCharacter: row.opponentCharacter,
    opponentName: row.opponentName,
  };
}

export function playerRating(row: Pick<Sf6PlayerRow, "rank" | "leaguePoints" | "masterRate">): RatingSnapshot {
  return { rank: row.rank, leaguePoints: row.leaguePoints, masterRate: row.masterRate };
}

/** Rating to compare against the baseline: frozen final values for ended sessions. */
export function sessionCurrentRating(session: GameSessionRow, player: Sf6PlayerRow): RatingSnapshot {
  if (session.status === "ended") {
    return {
      rank: session.finalRank,
      leaguePoints: session.finalLeaguePoints,
      masterRate: session.finalMasterRate,
    };
  }
  return playerRating(player);
}
