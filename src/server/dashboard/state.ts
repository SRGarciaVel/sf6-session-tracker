/** Private (authenticated) live state for the dashboard: overlay state + tracker health. */
import { and, eq } from "drizzle-orm";
import type { CompanionSignals } from "@/domain/companion/readiness";
import type { PlayerLiveState } from "@/domain/overlay/state";
import {
  RECENT_FORM_LENGTH,
  recentSessionMatches,
  type SessionMatch,
} from "@/domain/session/engine";
import type { MatchResult } from "@/domain/sf6/types";
import { match } from "@/server/db/schema";
import { loadCompanionSignals } from "@/server/companion/readiness";
import type { DbExecutor } from "@/server/db/client";
import { countPlayerConnections } from "@/server/overlays/service";
import { findPlayerById } from "@/server/players/service";
import { buildPlayerLiveState, getActiveSession } from "@/server/sessions/service";

export type TrackerState = "idle" | "starting" | "ok" | "degraded";

export interface TrackerStatus {
  state: TrackerState;
  lastSuccessAt: string | null;
  lastPollAt: string | null;
  nextPollAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

/**
 * Phase 5.6B3 — one counted match of the shown session, for the Fight Session LIVE view
 * (authenticated dashboard only; never in the public overlay payload). Display fields only:
 * no external ids, no ratings (a per-match rating is not stored).
 */
export interface DashboardRecentMatch {
  id: string;
  /** 1-based position in the session (same order as the stats). */
  n: number;
  result: MatchResult;
  characterName: string;
  opponentCharacter: string | null;
  opponentName: string | null;
  /** Replay upload time from Buckler (ISO). */
  playedAt: string;
}

export interface DashboardLiveState {
  live: PlayerLiveState;
  player: {
    cfnUserId: string;
  };
  tracker: TrackerStatus;
  overlayConnections: number;
  /** "Ready to play?" inputs (assessed client-side with a ticking clock). */
  companion: CompanionSignals;
  /**
   * Phase 5.6B3: latest counted matches of `live.session` (oldest → newest), only built for
   * Fight Session viewers. Absent = not requested / older payload (clients must cope).
   */
  recentMatches?: DashboardRecentMatch[];
}

/**
 * Latest counted matches of a session, consistent with its summary: the same rows the engine
 * counts (match.session_id), the engine's dedupe/order, capped to the summary's totalGames.
 * One indexed query (match_session_idx), minimal columns, scoped to the player.
 */
export async function loadRecentMatches(
  db: DbExecutor,
  playerId: string,
  session: Pick<PlayerLiveState["session"], "sessionId" | "totalGames">,
): Promise<DashboardRecentMatch[]> {
  if (!session.sessionId || session.totalGames === 0) return [];
  const rows = await db
    .select({
      id: match.id,
      externalMatchId: match.externalMatchId,
      playedAt: match.playedAt,
      mode: match.mode,
      result: match.result,
      characterKey: match.characterKey,
      characterName: match.characterName,
      opponentCharacter: match.opponentCharacter,
      opponentName: match.opponentName,
    })
    .from(match)
    .where(and(eq(match.sessionId, session.sessionId), eq(match.playerId, playerId)));
  const idByExternal = new Map(rows.map((r) => [r.externalMatchId, r.id]));
  const asSession: SessionMatch[] = rows.map((r) => ({
    externalMatchId: r.externalMatchId,
    playedAt: r.playedAt,
    mode: r.mode,
    result: r.result,
    characterKey: r.characterKey,
    characterName: r.characterName,
    opponentCharacter: r.opponentCharacter,
    opponentName: r.opponentName,
  }));
  return recentSessionMatches(asSession, RECENT_FORM_LENGTH, session.totalGames).map(
    ({ match: m, n }) => ({
      id: idByExternal.get(m.externalMatchId) ?? m.externalMatchId,
      n,
      result: m.result,
      characterName: m.characterName,
      opponentCharacter: m.opponentCharacter,
      opponentName: m.opponentName,
      playedAt: m.playedAt.toISOString(),
    }),
  );
}

export async function buildDashboardLiveState(
  db: DbExecutor,
  playerId: string,
  live?: PlayerLiveState,
  opts: { recentMatches?: boolean } = {},
): Promise<DashboardLiveState | null> {
  const [player, liveState, active, connections] = await Promise.all([
    findPlayerById(db, playerId),
    live ? Promise.resolve(live) : buildPlayerLiveState(db, playerId),
    getActiveSession(db, playerId),
    countPlayerConnections(db, playerId),
  ]);
  if (!player || !liveState) return null;
  const [companion, recentMatches] = await Promise.all([
    loadCompanionSignals(db, player.userId, player.cfnUserId),
    opts.recentMatches ? loadRecentMatches(db, playerId, liveState.session) : undefined,
  ]);

  let state: TrackerState = "idle";
  if (active) {
    if (player.consecutiveFailures > 0) state = "degraded";
    else if (!player.lastSuccessAt || player.lastSuccessAt < active.startedAt) state = "starting";
    else state = "ok";
  }

  return {
    live: liveState,
    player: {
      cfnUserId: player.cfnUserId,
    },
    tracker: {
      state,
      lastSuccessAt: player.lastSuccessAt?.toISOString() ?? null,
      lastPollAt: player.lastPollAt?.toISOString() ?? null,
      nextPollAt: active ? (player.nextPollAt?.toISOString() ?? null) : null,
      consecutiveFailures: player.consecutiveFailures,
      lastError: player.lastError,
    },
    overlayConnections: connections,
    companion,
    ...(recentMatches ? { recentMatches } : {}),
  };
}
