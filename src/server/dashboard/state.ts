/** Private (authenticated) live state for the dashboard: overlay state + tracker health. */
import type { PlayerLiveState } from "@/domain/overlay/state";
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

export interface DashboardLiveState {
  live: PlayerLiveState;
  player: {
    cfnUserId: string;
  };
  tracker: TrackerStatus;
  overlayConnections: number;
}

export async function buildDashboardLiveState(
  db: DbExecutor,
  playerId: string,
  live?: PlayerLiveState,
): Promise<DashboardLiveState | null> {
  const [player, liveState, active, connections] = await Promise.all([
    findPlayerById(db, playerId),
    live ? Promise.resolve(live) : buildPlayerLiveState(db, playerId),
    getActiveSession(db, playerId),
    countPlayerConnections(db, playerId),
  ]);
  if (!player || !liveState) return null;

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
  };
}
