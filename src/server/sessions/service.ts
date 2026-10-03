/**
 * Session lifecycle + read models. Calculations are delegated to the pure Session Engine.
 */
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type SessionSummary,
} from "@/domain/session/engine";
import { toLiveSessionState, type PlayerLiveState } from "@/domain/overlay/state";
import type { Database, DbExecutor } from "@/server/db/client";
import { gameSession, match, sf6Player, type GameSessionRow, type Sf6PlayerRow } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { ingestMatchesInTx } from "@/server/ingestion/ingest";
import { logger } from "@/server/logger";
import { findPlayerById, updatePlayerProfile } from "@/server/players/service";
import { publishEvent } from "@/server/realtime/events";
import type { SF6DataProvider } from "@/server/sf6/provider";
import {
  matchRowToSessionMatch,
  playerRating,
  sessionCurrentRating,
  sessionRowToBaseline,
} from "./mappers";

const log = logger.child({ component: "sessions" });

export async function getActiveSession(db: DbExecutor, playerId: string): Promise<GameSessionRow | null> {
  const [row] = await db
    .select()
    .from(gameSession)
    .where(and(eq(gameSession.playerId, playerId), eq(gameSession.status, "active")))
    .limit(1);
  return row ?? null;
}

/** Active session if any, otherwise the most recent one. */
export async function getCurrentOrLatestSession(
  db: DbExecutor,
  playerId: string,
): Promise<GameSessionRow | null> {
  const active = await getActiveSession(db, playerId);
  if (active) return active;
  const [latest] = await db
    .select()
    .from(gameSession)
    .where(eq(gameSession.playerId, playerId))
    .orderBy(desc(gameSession.startedAt))
    .limit(1);
  return latest ?? null;
}

/**
 * Start a new session (ending the current one, if any).
 *
 * 1. Fetch the latest profile + matches from the provider (fails fast if CFN is down — we never
 *    start a session on a stale baseline).
 * 2. In one transaction: lock the player, assign any not-yet-ingested matches to the previous
 *    session, end it, ingest remaining history as "known", record the new baseline.
 */
export async function startSession(
  db: Database,
  provider: SF6DataProvider,
  player: Sf6PlayerRow,
): Promise<GameSessionRow> {
  const [profile, recent] = await Promise.all([
    provider.getPlayerProfile(player.cfnUserId),
    provider.getRecentMatches(player.cfnUserId),
  ]);
  const env = getEnv();
  const startGraceMs = env.SESSION_START_GRACE_SECONDS * 1000;

  const session = await db.transaction(async (tx) => {
    await tx.select({ id: sf6Player.id }).from(sf6Player).where(eq(sf6Player.id, player.id)).for("update");

    const previous = await getActiveSession(tx, player.id);
    if (previous) {
      await ingestMatchesInTx(tx, recent, { playerId: player.id, sessionId: previous.id, startGraceMs });
    } else {
      await ingestMatchesInTx(tx, recent, { playerId: player.id, sessionId: null, startGraceMs });
    }
    await updatePlayerProfile(tx, player.id, profile);
    if (previous) await endSessionInTx(tx, previous.id, profile);

    const [baselineRow] = await tx
      .select({ playedAt: max(match.playedAt) })
      .from(match)
      .where(eq(match.playerId, player.id));
    const baselinePlayedAt = baselineRow?.playedAt ?? null;
    let baselineMatchId: string | null = null;
    if (baselinePlayedAt) {
      const [b] = await tx
        .select({ id: match.externalMatchId })
        .from(match)
        .where(and(eq(match.playerId, player.id), eq(match.playedAt, baselinePlayedAt)))
        .orderBy(desc(match.externalMatchId))
        .limit(1);
      baselineMatchId = b?.id ?? null;
    }

    const [created] = await tx
      .insert(gameSession)
      .values({
        playerId: player.id,
        status: "active",
        startedAt: new Date(),
        baselineMatchId,
        baselinePlayedAt,
        initialRank: profile.rank,
        initialLeaguePoints: profile.leaguePoints,
        initialMasterRate: profile.masterRate,
        filter: DEFAULT_SESSION_FILTER,
      })
      .returning();
    if (!created) throw new Error("Failed to create session");

    // Make the tracker pick this player up immediately.
    await tx
      .update(sf6Player)
      .set({ nextPollAt: sql`now()`, consecutiveFailures: 0, lastError: null })
      .where(eq(sf6Player.id, player.id));

    await publishEvent(tx, { kind: "player", playerId: player.id });
    return created;
  });

  log.info("session.started", { playerId: player.id, sessionId: session.id, baselineMatchId: session.baselineMatchId });
  return session;
}

async function endSessionInTx(
  tx: DbExecutor,
  sessionId: string,
  finalRating: { rank: string | null; leaguePoints: number | null; masterRate: number | null },
): Promise<void> {
  await tx
    .update(gameSession)
    .set({
      status: "ended",
      endedAt: sql`now()`,
      finalRank: finalRating.rank,
      finalLeaguePoints: finalRating.leaguePoints,
      finalMasterRate: finalRating.masterRate,
    })
    .where(and(eq(gameSession.id, sessionId), eq(gameSession.status, "active")));
}

/** End the player's active session; final rating = latest known snapshot. Idempotent. */
export async function endSession(db: Database, playerId: string): Promise<GameSessionRow | null> {
  const ended = await db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(gameSession)
      .where(and(eq(gameSession.playerId, playerId), eq(gameSession.status, "active")))
      .for("update");
    if (!active) return null;
    const player = await findPlayerById(tx, playerId);
    if (!player) return null;
    await endSessionInTx(tx, active.id, playerRating(player));
    await tx
      .update(sf6Player)
      .set({ nextPollAt: null, leaseOwner: null, leaseExpiresAt: null })
      .where(eq(sf6Player.id, playerId));
    await publishEvent(tx, { kind: "player", playerId });
    return active;
  });
  if (ended) log.info("session.ended", { playerId, sessionId: ended.id });
  return ended;
}

export async function summarizeSessionRow(
  db: DbExecutor,
  session: GameSessionRow,
  player: Sf6PlayerRow,
): Promise<SessionSummary> {
  const rows = await db.select().from(match).where(eq(match.sessionId, session.id));
  return summarizeSession({
    status: session.status,
    baseline: sessionRowToBaseline(session),
    matches: rows.map(matchRowToSessionMatch),
    currentRating: sessionCurrentRating(session, player),
  });
}

/** Authoritative live snapshot for overlays and the dashboard. */
export async function buildPlayerLiveState(db: DbExecutor, playerId: string): Promise<PlayerLiveState | null> {
  const player = await findPlayerById(db, playerId);
  if (!player) return null;
  const session = await getCurrentOrLatestSession(db, playerId);
  const summary = session ? await summarizeSessionRow(db, session, player) : null;
  return {
    player: { displayName: player.displayName, mainCharacter: player.mainCharacter },
    session: toLiveSessionState(session?.id ?? null, summary, playerRating(player)),
    generatedAt: new Date().toISOString(),
  };
}

export interface SessionHistoryItem {
  id: string;
  summary: SessionSummary;
}

export async function listSessionHistory(
  db: DbExecutor,
  player: Sf6PlayerRow,
  limit = 10,
): Promise<SessionHistoryItem[]> {
  const sessions = await db
    .select()
    .from(gameSession)
    .where(eq(gameSession.playerId, player.id))
    .orderBy(desc(gameSession.startedAt))
    .limit(limit);
  if (sessions.length === 0) return [];
  const matchRows = await db
    .select()
    .from(match)
    .where(inArray(match.sessionId, sessions.map((s) => s.id)));
  return sessions.map((s) => ({
    id: s.id,
    summary: summarizeSession({
      status: s.status,
      baseline: sessionRowToBaseline(s),
      matches: matchRows.filter((m) => m.sessionId === s.id).map(matchRowToSessionMatch),
      currentRating: sessionCurrentRating(s, player),
    }),
  }));
}

/** A session owned by the given player (IDOR-safe). */
export async function getOwnedSession(
  db: DbExecutor,
  playerId: string,
  sessionId: string,
): Promise<GameSessionRow | null> {
  const [row] = await db
    .select()
    .from(gameSession)
    .where(and(eq(gameSession.id, sessionId), eq(gameSession.playerId, playerId)))
    .limit(1);
  return row ?? null;
}
