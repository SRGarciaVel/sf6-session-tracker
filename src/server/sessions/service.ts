/**
 * Session lifecycle + read models. Calculations are delegated to the pure Session Engine.
 *
 * Ratings are per character: a session stores one baseline row per character at start
 * (session_character_baseline.initial_*) and freezes each character's final value at the end
 * (final_*), so closed sessions never depend on future profile values.
 */
import { and, desc, eq, inArray, max, sql } from "drizzle-orm";
import {
  DEFAULT_SESSION_FILTER,
  computeCharacterProgress,
  resolveActiveCharacter,
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionSummary,
} from "@/domain/session/engine";
import { toLiveSessionState, type PlayerLiveState } from "@/domain/overlay/state";
import { ratingPointOf } from "@/domain/sf6/rating";
import type { NormalizedPlayerProfile, NormalizedSF6Match, RatingPoint } from "@/domain/sf6/types";
import type { Database, DbExecutor } from "@/server/db/client";
import {
  gameSession,
  match,
  sessionCharacterBaseline,
  sf6Player,
  type GameSessionRow,
  type MatchRow,
  type Sf6PlayerRow,
} from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { ingestMatchesInTx } from "@/server/ingestion/ingest";
import { logger } from "@/server/logger";
import {
  findPlayerById,
  listPlayerCharacters,
  updatePlayerProfile,
} from "@/server/players/service";
import { publishEvent } from "@/server/realtime/events";
import type { SF6DataProvider } from "@/server/sf6/provider";
import {
  baselineRowToCharacterBaseline,
  baselineRowToFinalSnapshot,
  characterRowToProfile,
  characterRowToSnapshot,
  matchRowToSessionMatch,
  sessionRowToBaseline,
  type PlayerCharacterRatingRow,
  type SessionCharacterBaselineRow,
} from "./mappers";

const log = logger.child({ component: "sessions" });

export async function getActiveSession(
  db: DbExecutor,
  playerId: string,
): Promise<GameSessionRow | null> {
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

/* ───────────────────────── Loading (batched) ───────────────────────── */

interface SessionContext {
  matchesBySession: Map<string, MatchRow[]>;
  baselinesBySession: Map<string, SessionCharacterBaselineRow[]>;
  characters: PlayerCharacterRatingRow[];
}

/** Matches + character baselines of N sessions + the player's characters: 3 queries total. */
async function loadSessionContext(
  db: DbExecutor,
  playerId: string,
  sessionIds: string[],
): Promise<SessionContext> {
  const [matchRows, baselineRows, characters] = await Promise.all([
    sessionIds.length
      ? db.select().from(match).where(inArray(match.sessionId, sessionIds))
      : Promise.resolve([] as MatchRow[]),
    sessionIds.length
      ? db
          .select()
          .from(sessionCharacterBaseline)
          .where(inArray(sessionCharacterBaseline.sessionId, sessionIds))
      : Promise.resolve([] as SessionCharacterBaselineRow[]),
    listPlayerCharacters(db, playerId),
  ]);
  const group = <T extends { sessionId: string | null }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      if (!r.sessionId) continue;
      const list = map.get(r.sessionId);
      if (list) list.push(r);
      else map.set(r.sessionId, [r]);
    }
    return map;
  };
  return {
    matchesBySession: group(matchRows),
    baselinesBySession: group(baselineRows),
    characters,
  };
}

function summarizeFromContext(
  session: GameSessionRow,
  player: Sf6PlayerRow,
  ctx: SessionContext,
): SessionSummary {
  const baselineRows = ctx.baselinesBySession.get(session.id) ?? [];
  const characterBaselines: CharacterBaseline[] =
    session.ratingModel === "legacy"
      ? []
      : baselineRows.flatMap((r) => {
          const b = baselineRowToCharacterBaseline(r);
          return b ? [b] : [];
        });
  // Ended sessions use their frozen finals only — never later profile values.
  const current: CharacterSnapshot[] =
    session.status === "ended"
      ? baselineRows.flatMap((r) => {
          const f = baselineRowToFinalSnapshot(r);
          return f ? [f] : [];
        })
      : ctx.characters.map(characterRowToSnapshot);
  return summarizeSession({
    status: session.status,
    ratingModel: session.ratingModel,
    baseline: sessionRowToBaseline(session),
    matches: (ctx.matchesBySession.get(session.id) ?? []).map(matchRowToSessionMatch),
    characterBaselines,
    current,
    favoriteCharacterKey: player.favoriteCharacterKey,
  });
}

/* ───────────────────────── Lifecycle ───────────────────────── */

/**
 * Freeze each character's final rating for a session that is about to end. Characters that
 * were played without a start baseline get a row with source "none" (initial unknown).
 */
async function finalizeCharactersInTx(
  tx: DbExecutor,
  session: GameSessionRow,
  player: Sf6PlayerRow,
): Promise<void> {
  if (session.ratingModel === "legacy") return;
  const ctx = await loadSessionContext(tx, player.id, [session.id]);
  const progress = summarizeFromContext(session, player, ctx).characters;
  const existing = new Set(
    (ctx.baselinesBySession.get(session.id) ?? []).map((r) => r.characterKey),
  );
  const now = new Date();
  for (const p of progress) {
    if (!existing.has(p.characterKey) && p.games === 0) continue;
    const final = finalColumns(p.current);
    if (existing.has(p.characterKey)) {
      await tx
        .update(sessionCharacterBaseline)
        .set({ ...final, finalizedAt: now, updatedAt: sql`now()` })
        .where(
          and(
            eq(sessionCharacterBaseline.sessionId, session.id),
            eq(sessionCharacterBaseline.characterKey, p.characterKey),
          ),
        );
    } else {
      await tx
        .insert(sessionCharacterBaseline)
        .values({
          sessionId: session.id,
          characterKey: p.characterKey,
          characterName: p.characterName,
          source: "none",
          capturedAt: now,
          ...final,
          finalizedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}

function finalColumns(point: RatingPoint | null) {
  return {
    finalRank: point?.rank ?? null,
    finalRankTier: point?.rankTier ?? null,
    finalRatingSystem: point?.system ?? null,
    finalLeaguePoints: point?.system === "lp" ? point.value : null,
    finalMasterRate: point?.system === "mr" ? point.value : null,
    finalPhase: point?.phase ?? null,
  };
}

async function endSessionInTx(tx: DbExecutor, session: GameSessionRow, player: Sf6PlayerRow) {
  await finalizeCharactersInTx(tx, session, player);
  await tx
    .update(gameSession)
    .set({ status: "ended", endedAt: sql`now()` })
    .where(and(eq(gameSession.id, session.id), eq(gameSession.status, "active")));
}

/**
 * Start a new session (ending the current one, if any).
 *
 * 1. Fetch the latest profile + matches from the provider (fails fast if CFN is down — we never
 *    start a session on a stale baseline).
 * 2. In one transaction: lock the player, assign any not-yet-ingested matches to the previous
 *    session and end it (freezing its per-character finals), ingest the rest as known history,
 *    store the profile, and record the new baselines: match IDs + one row per character.
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
  const startGraceMs = getEnv().SESSION_START_GRACE_SECONDS * 1000;
  const observedAt = new Date();

  const session = await db.transaction(async (tx) => {
    await tx
      .select({ id: sf6Player.id })
      .from(sf6Player)
      .where(eq(sf6Player.id, player.id))
      .for("update");

    const previous = await getActiveSession(tx, player.id);
    await ingestMatchesInTx(tx, recent, {
      playerId: player.id,
      sessionId: previous?.id ?? null,
      startGraceMs,
    });
    await updatePlayerProfile(tx, player.id, profile, observedAt);
    const freshPlayer = (await findPlayerById(tx, player.id)) ?? player;
    if (previous) await endSessionInTx(tx, previous, freshPlayer);

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
        startedAt: observedAt,
        baselineMatchId,
        baselinePlayedAt,
        filter: DEFAULT_SESSION_FILTER,
        ratingModel: "per_character",
      })
      .returning();
    if (!created) throw new Error("Failed to create session");

    await insertCharacterBaselines(tx, created.id, player.id, profile, observedAt);

    // Make the tracker pick this player up immediately.
    await tx
      .update(sf6Player)
      .set({ nextPollAt: sql`now()`, consecutiveFailures: 0, lastError: null })
      .where(eq(sf6Player.id, player.id));

    await publishEvent(tx, { kind: "player", playerId: player.id });
    return created;
  });

  log.info("session.started", {
    playerId: player.id,
    sessionId: session.id,
    baselineMatchId: session.baselineMatchId,
    characters: profile.characters.length,
  });
  return session;
}

/**
 * One baseline row per character with a known rating: from the fresh profile ("session_start"),
 * plus characters only present in an earlier stored snapshot ("prior_snapshot").
 */
async function insertCharacterBaselines(
  tx: DbExecutor,
  sessionId: string,
  playerId: string,
  profile: NormalizedPlayerProfile,
  capturedAt: Date,
): Promise<void> {
  const fresh = new Set(profile.characters.map((c) => c.characterKey));
  const stored = await listPlayerCharacters(tx, playerId);
  const rows = stored.flatMap((row) => {
    const c = characterRowToProfile(row);
    if (!ratingPointOf(c)) return [];
    const source = fresh.has(c.characterKey) ? "session_start" : "prior_snapshot";
    return [
      {
        sessionId,
        characterKey: c.characterKey,
        characterName: c.characterName,
        source,
        initialRank: c.rank,
        initialRankTier: c.rankTier,
        initialRatingSystem: c.ratingSystem,
        initialLeaguePoints: c.leaguePoints,
        initialMasterRate: c.masterRate,
        initialPhase: c.phase ?? null,
        capturedAt: source === "session_start" ? capturedAt : row.observedAt,
      } as const,
    ];
  });
  if (rows.length) await tx.insert(sessionCharacterBaseline).values(rows).onConflictDoNothing();
}

/**
 * End the player's active session. Idempotent.
 *
 * With a provider, a final fetch runs first so a match finished seconds before "End session"
 * (i.e. after the last poll) is still counted, and the final ratings are fresh. If CFN is down
 * the session ends anyway with the last known data.
 */
export async function endSession(
  db: Database,
  playerId: string,
  provider?: SF6DataProvider,
): Promise<GameSessionRow | null> {
  let finalMatches: NormalizedSF6Match[] | null = null;
  let finalProfile: NormalizedPlayerProfile | null = null;
  if (provider) {
    const player = await findPlayerById(db, playerId);
    if (player) {
      const [matches, profile] = await Promise.allSettled([
        provider.getRecentMatches(player.cfnUserId),
        provider.getPlayerProfile(player.cfnUserId),
      ]);
      if (matches.status === "fulfilled") finalMatches = matches.value;
      if (profile.status === "fulfilled") finalProfile = profile.value;
      if (matches.status === "rejected" || profile.status === "rejected") {
        log.warn("session.end_final_fetch_failed", { playerId });
      }
    }
  }
  const startGraceMs = getEnv().SESSION_START_GRACE_SECONDS * 1000;

  const ended = await db.transaction(async (tx) => {
    const [active] = await tx
      .select()
      .from(gameSession)
      .where(and(eq(gameSession.playerId, playerId), eq(gameSession.status, "active")))
      .for("update");
    if (!active) return null;
    if (finalMatches) {
      await ingestMatchesInTx(tx, finalMatches, { playerId, sessionId: active.id, startGraceMs });
    }
    if (finalProfile) await updatePlayerProfile(tx, playerId, finalProfile);
    const player = await findPlayerById(tx, playerId);
    if (!player) return null;
    await endSessionInTx(tx, active, player);
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

/* ───────────────────────── Read models ───────────────────────── */

export async function summarizeSessionRow(
  db: DbExecutor,
  session: GameSessionRow,
  player: Sf6PlayerRow,
): Promise<SessionSummary> {
  const ctx = await loadSessionContext(db, player.id, [session.id]);
  return summarizeFromContext(session, player, ctx);
}

/** Authoritative live snapshot for overlays and the dashboard. */
export async function buildPlayerLiveState(
  db: DbExecutor,
  playerId: string,
): Promise<PlayerLiveState | null> {
  const player = await findPlayerById(db, playerId);
  if (!player) return null;
  const session = await getCurrentOrLatestSession(db, playerId);
  const ctx = await loadSessionContext(db, playerId, session ? [session.id] : []);
  const summary = session ? summarizeFromContext(session, player, ctx) : null;

  // No session yet: show the player's characters as-is (no deltas).
  const snapshots = ctx.characters.map(characterRowToSnapshot);
  const idle = {
    characters: computeCharacterProgress({ baselines: [], matches: [], current: snapshots }),
    activeCharacterKey: resolveActiveCharacter({
      matches: [],
      favoriteCharacterKey: player.favoriteCharacterKey,
      characters: snapshots,
    }),
  };
  return {
    player: { displayName: player.displayName },
    session: toLiveSessionState(session?.id ?? null, summary, idle),
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
  const ctx = await loadSessionContext(
    db,
    player.id,
    sessions.map((s) => s.id),
  );
  return sessions.map((s) => ({ id: s.id, summary: summarizeFromContext(s, player, ctx) }));
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
