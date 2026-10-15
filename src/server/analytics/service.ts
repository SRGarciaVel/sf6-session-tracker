/**
 * Analytics read model (Phase 6.0b): one NARROW query of the player's recorded matches, then pure
 * aggregation in domain/analytics. Callers pass the player of the authenticated account
 * (requirePlayer) — there is no route that takes a player id, so another account's matches can
 * never be read.
 *
 * Only analytics columns are selected: no opponent names, no ratings, no JSON.
 * Cost: `match_player_played_idx (player_id, played_at)` serves the player + range filter and the
 * ordering; the optional mode predicate is a filter on those rows.
 */
import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import {
  computeAnalytics,
  rangeStart,
  type AnalyticsMatchRow,
  type AnalyticsMode,
  type AnalyticsRange,
  type AnalyticsSummary,
} from "@/domain/analytics/aggregate";
import type { DbExecutor } from "@/server/db/client";
import { match } from "@/server/db/schema";

export interface PlayerAnalytics {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  /** Start of the rolling window (null = all recorded history). */
  from: Date | null;
  generatedAt: Date;
  summary: AnalyticsSummary;
}

/** The analytics projection of a player's recorded matches, newest first. */
export async function loadAnalyticsRows(
  db: DbExecutor,
  playerId: string,
  options: { from: Date | null; mode: AnalyticsMode },
): Promise<AnalyticsMatchRow[]> {
  const where: SQL[] = [eq(match.playerId, playerId)];
  if (options.from) where.push(gte(match.playedAt, options.from));
  if (options.mode === "ranked") where.push(eq(match.mode, "ranked"));
  return db
    .select({
      externalMatchId: match.externalMatchId,
      playedAt: match.playedAt,
      result: match.result,
      mode: match.mode,
      characterKey: match.characterKey,
      characterName: match.characterName,
      sessionId: match.sessionId,
    })
    .from(match)
    .where(and(...where))
    .orderBy(desc(match.playedAt), desc(match.externalMatchId));
}

export async function getPlayerAnalytics(
  db: DbExecutor,
  playerId: string,
  options: { range: AnalyticsRange; mode: AnalyticsMode; now?: Date },
): Promise<PlayerAnalytics> {
  const now = options.now ?? new Date();
  const from = rangeStart(options.range, now);
  const rows = await loadAnalyticsRows(db, playerId, { from, mode: options.mode });
  return {
    range: options.range,
    mode: options.mode,
    from,
    generatedAt: now,
    summary: computeAnalytics(rows),
  };
}
