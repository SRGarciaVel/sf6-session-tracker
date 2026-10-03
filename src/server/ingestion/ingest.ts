/**
 * Match ingestion pipeline:  VALIDATE → DEDUPLICATE → PERSIST → ASSIGN SESSION → PUBLISH
 *
 * Exactly-once *effect*: the unique index (player_id, external_match_id) plus
 * ON CONFLICT DO NOTHING means a match row is created at most once, and session membership is
 * decided only for rows that were actually inserted. Re-ingesting the same payload any number of
 * times is a no-op.
 */
import { eq } from "drizzle-orm";
import { isMatchInSession, type SessionBaseline } from "@/domain/session/engine";
import type { NormalizedSF6Match } from "@/domain/sf6/types";
import type { Database, DbExecutor } from "@/server/db/client";
import { gameSession, match } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { publishEvent } from "@/server/realtime/events";
import { normalizedMatchSchema } from "@/server/sf6/provider";
import { sessionRowToBaseline } from "@/server/sessions/mappers";

export interface IngestResult {
  received: number;
  invalid: number;
  inserted: number;
  duplicates: number;
  countedInSession: number;
}

export interface IngestOptions {
  playerId: string;
  /** Active session to assign new matches to (re-validated under lock), or null. */
  sessionId: string | null;
  startGraceMs: number;
}

const log = logger.child({ component: "ingestion" });

export async function ingestMatches(
  db: Database,
  matches: readonly NormalizedSF6Match[],
  options: IngestOptions,
): Promise<IngestResult> {
  return db.transaction((tx) => ingestMatchesInTx(tx, matches, options));
}

/** Same as ingestMatches but inside a caller-provided transaction. */
export async function ingestMatchesInTx(
  tx: DbExecutor,
  matches: readonly NormalizedSF6Match[],
  options: IngestOptions,
): Promise<IngestResult> {
  // VALIDATE + in-batch DEDUPLICATE
  const unique = new Map<string, NormalizedSF6Match>();
  let invalid = 0;
  for (const raw of matches) {
    const parsed = normalizedMatchSchema.safeParse(raw);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    if (!unique.has(parsed.data.externalMatchId))
      unique.set(parsed.data.externalMatchId, parsed.data);
  }
  const result: IngestResult = {
    received: matches.length,
    invalid,
    inserted: 0,
    duplicates: 0,
    countedInSession: 0,
  };
  if (unique.size === 0) return result;

  // Lock the session row so a concurrent "End session" cannot interleave with assignment.
  let baseline: SessionBaseline | null = null;
  if (options.sessionId) {
    const [row] = await tx
      .select()
      .from(gameSession)
      .where(eq(gameSession.id, options.sessionId))
      .for("update");
    if (row && row.playerId === options.playerId) baseline = sessionRowToBaseline(row);
  }

  // PERSIST (DB-level dedupe) + ASSIGN SESSION
  const rows = [...unique.values()].map((m) => ({
    playerId: options.playerId,
    sessionId:
      baseline &&
      options.sessionId &&
      isMatchInSession(baseline, m, { startGraceMs: options.startGraceMs })
        ? options.sessionId
        : null,
    externalMatchId: m.externalMatchId,
    playedAt: m.playedAt,
    mode: m.mode,
    result: m.result,
    playerCharacter: m.playerCharacter,
    playerControlType: m.playerControlType ?? null,
    opponentName: m.opponent.name,
    opponentCharacter: m.opponent.character,
    opponentRank: m.opponent.rank ?? null,
    leaguePointsAfter: m.ratingAfter?.leaguePoints ?? null,
    masterRateAfter: m.ratingAfter?.masterRate ?? null,
  }));

  const inserted = await tx
    .insert(match)
    .values(rows)
    .onConflictDoNothing({ target: [match.playerId, match.externalMatchId] })
    .returning({ externalMatchId: match.externalMatchId, sessionId: match.sessionId });

  result.inserted = inserted.length;
  result.duplicates = unique.size - inserted.length;
  result.countedInSession = inserted.filter((r) => r.sessionId !== null).length;

  for (const row of inserted) {
    log.info("match.detected", {
      playerId: options.playerId,
      externalMatchId: row.externalMatchId,
      counted: row.sessionId !== null,
    });
  }
  if (result.duplicates > 0) {
    log.debug("match.duplicated", { playerId: options.playerId, count: result.duplicates });
  }

  // PUBLISH (delivered on commit)
  if (result.inserted > 0) {
    await publishEvent(tx, { kind: "player", playerId: options.playerId });
  }
  return result;
}
