/**
 * Shared analytics primitives (pure): the recorded-match projection and the W/L/D record.
 * Win rate = wins / (wins + losses) (the session engine's calculateWinRate); draws are counted
 * but never in the denominator; no decided match ⇒ null (never 0 %, never NaN).
 */
import { calculateWinRate } from "@/domain/session/engine";
import type { CharacterKey, MatchMode, MatchResult } from "@/domain/sf6/types";
import { sampleBand, type SampleBand } from "./samples";

/** Narrow projection of one recorded match (server/analytics/service.ts selects exactly this). */
export interface AnalyticsMatchRow {
  externalMatchId: string;
  playedAt: Date;
  result: MatchResult;
  mode: MatchMode;
  characterKey: CharacterKey;
  characterName: string;
  /** Session the match was counted in; null = recorded history outside any session. */
  sessionId: string | null;
  /**
   * Opponent character (Phase 6.1). Nullable in the schema: the normalizer leaves the key null
   * when Capcom's id is not a valid key. Never the opponent's NAME.
   */
  opponentCharacterKey: CharacterKey | null;
  opponentCharacterName: string | null;
}

export interface MatchRecord {
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  /** wins + losses: the win-rate denominator and the sample-band count. */
  decided: number;
  /** 0–100, or null when there is no decided match. */
  winRate: number | null;
  sample: SampleBand;
}

export function computeRecord(results: readonly MatchResult[]): MatchRecord {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const r of results) {
    if (r === "win") wins++;
    else if (r === "loss") losses++;
    else draws++;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    draws,
    matches: wins + losses + draws,
    decided,
    winRate: decided > 0 ? calculateWinRate(wins, losses) : null,
    sample: sampleBand(decided),
  };
}

/** Newest first; ties broken by external id (same total order as the session engine). */
export function newestFirst(a: AnalyticsMatchRow, b: AnalyticsMatchRow): number {
  const t = b.playedAt.getTime() - a.playedAt.getTime();
  if (t !== 0) return t;
  return a.externalMatchId < b.externalMatchId ? 1 : a.externalMatchId > b.externalMatchId ? -1 : 0;
}
