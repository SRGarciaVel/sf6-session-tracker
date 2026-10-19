/**
 * Analytics read model (Phase 6.0b): one NARROW query of the player's recorded matches, then pure
 * aggregation in domain/analytics.
 *
 * OWNERSHIP lives here, not in the caller: the only public entry point takes the authenticated
 * USER id and resolves that user's own player (sf6_player.user_id is unique). Nothing exported
 * accepts a player id, so no caller can read another account's analytics by mistake; the
 * player-id loader below is module-private. There is no API route for analytics.
 *
 * Only analytics columns are selected (9): no opponent NAMES, no ratings, no JSON. Matchups use the
 * opponent CHARACTER only.
 * Cost: `match_player_played_idx (player_id, played_at)` serves the player + range filter and the
 * ordering; the optional mode predicate is a filter on those rows.
 */
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import {
  computeAnalyticsDetailed,
  rangeStart,
  type AnalyticsMatchRow,
  type AnalyticsMode,
  type AnalyticsRange,
  type AnalyticsSummary,
} from "@/domain/analytics/aggregate";
import type { ReviewReplaySelection } from "@/domain/analytics/review-replays";
import type { CharacterKey } from "@/domain/sf6/types";
import type { DbExecutor } from "@/server/db/client";
import { match } from "@/server/db/schema";
import { findPlayerByUserId } from "@/server/players/service";

/** One of the player's own recorded characters (a value of the `character` filter). */
export interface OwnCharacterOption {
  characterKey: CharacterKey;
  /** Display name of its most recent recorded match. */
  characterName: string;
}

export interface PlayerAnalytics {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  /** Applied own-character filter (validated against `characters`); null = all. */
  character: CharacterKey | null;
  /** Own characters in the player's whole recorded history (filter options). */
  characters: OwnCharacterOption[];
  /** Start of the rolling window (null = all recorded history). */
  from: Date | null;
  generatedAt: Date;
  summary: AnalyticsSummary;
  /**
   * Replay Selection (Phase 6.4C), aligned with `summary.review.signals`: concrete recorded
   * matches of each selected signal's evidence, computed in memory from the SAME rows (no extra
   * query). Authenticated Analytics page only — never part of ReviewReport, the plain-text summary
   * or the PDF.
   */
  reviewReplays: ReviewReplaySelection[];
}

/** The analytics projection of a player's recorded matches, newest first. Private. */
async function loadAnalyticsRows(
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
      // Opponent CHARACTER only (Phase 6.1) — never opponent_name.
      opponentCharacterKey: match.opponentCharacterKey,
      opponentCharacterName: match.opponentCharacter,
    })
    .from(match)
    .where(and(...where))
    .orderBy(desc(match.playedAt), desc(match.externalMatchId));
}

/** The player's own recorded characters (any range / mode), latest display name, by name. */
async function loadOwnCharacters(db: DbExecutor, playerId: string): Promise<OwnCharacterOption[]> {
  const rows = await db
    .select({
      characterKey: match.characterKey,
      // Name of the most recent match with that character.
      characterName: sql<string>`(array_agg(${match.characterName} order by ${match.playedAt} desc))[1]`,
    })
    .from(match)
    .where(eq(match.playerId, playerId))
    .groupBy(match.characterKey);
  return rows.sort(
    (a, b) =>
      a.characterName.localeCompare(b.characterName) ||
      a.characterKey.localeCompare(b.characterKey),
  );
}

export interface AnalyticsQuery {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  /**
   * Own-character filter (syntax already checked by parseAnalyticsSearchParams). A key that is
   * not one of the player's own recorded characters falls back to all (null).
   */
  character?: CharacterKey | null;
  /** Injectable clock (tests). */
  now?: Date;
}

/**
 * Analytics of the player that belongs to `userId` (the authenticated account: pass
 * `requireUser()/requirePlayer()`'s user id, never anything from the request). null when that
 * user has no player yet.
 */
export async function getPlayerAnalyticsForUser(
  db: DbExecutor,
  userId: string,
  query: AnalyticsQuery,
): Promise<PlayerAnalytics | null> {
  const player = await findPlayerByUserId(db, userId);
  if (!player) return null;
  return analyticsForOwnedPlayer(db, player.id, query);
}

/** Private: `playerId` must come from an ownership check (getPlayerAnalyticsForUser). */
async function analyticsForOwnedPlayer(
  db: DbExecutor,
  playerId: string,
  options: AnalyticsQuery,
): Promise<PlayerAnalytics> {
  const now = options.now ?? new Date();
  const from = rangeStart(options.range, now);
  // Sequential on purpose: one connection per request (pool max 5).
  const characters = await loadOwnCharacters(db, playerId);
  const requested = options.character ?? null;
  const character =
    requested && characters.some((c) => c.characterKey === requested) ? requested : null;
  const rows = await loadAnalyticsRows(db, playerId, { from, mode: options.mode });
  const { summary, reviewReplays } = computeAnalyticsDetailed(rows, { character });
  return {
    range: options.range,
    mode: options.mode,
    character,
    characters,
    from,
    generatedAt: now,
    summary,
    reviewReplays,
  };
}
