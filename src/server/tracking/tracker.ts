/**
 * Match Tracker: poll provider → hand matches to ingestion → schedule the next poll.
 *
 * Coordination across worker replicas uses a lease on sf6_player:
 *   claim:   rows with an ACTIVE session, next_poll_at <= now() and no live lease,
 *            selected FOR UPDATE SKIP LOCKED (two workers never claim the same player)
 *   release: clear the lease and set next_poll_at — only if we still own it
 *   crash:   the lease expires after TRACKER_LEASE_MS and another worker takes over
 * Even if leases ever overlapped, ingestion is idempotent, so stats stay correct.
 */
import { and, eq, sql } from "drizzle-orm";
import { computeNextPollDelay, type PollingConfig } from "@/domain/tracking/polling";
import type { Database } from "@/server/db/client";
import { sf6Player } from "@/server/db/schema";
import type { Env } from "@/server/env";
import { ingestMatches } from "@/server/ingestion/ingest";
import type { Logger } from "@/server/logger";
import { updatePlayerProfile } from "@/server/players/service";
import { publishEvent } from "@/server/realtime/events";
import { getActiveSession } from "@/server/sessions/service";
import { SF6ProviderError, type SF6DataProvider } from "@/server/sf6/provider";

/** After a new match, keep refreshing the profile for a while: CFN may lag updating MR/LP. */
const PROFILE_FOLLOW_UP_MS = 90_000;

export interface TrackerConfig {
  polling: PollingConfig;
  leaseMs: number;
  profileRefreshMs: number;
  startGraceMs: number;
}

export function trackerConfigFromEnv(env: Env): TrackerConfig {
  return {
    polling: {
      intervalMs: env.TRACKER_POLL_INTERVAL_MS,
      jitterMs: env.TRACKER_POLL_JITTER_MS,
      backoffBaseMs: env.TRACKER_BACKOFF_BASE_MS,
      backoffMaxMs: env.TRACKER_BACKOFF_MAX_MS,
    },
    leaseMs: env.TRACKER_LEASE_MS,
    profileRefreshMs: env.TRACKER_PROFILE_REFRESH_MS,
    startGraceMs: env.SESSION_START_GRACE_SECONDS * 1000,
  };
}

export interface ClaimedPlayer {
  id: string;
  cfnUserId: string;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  profileUpdatedAt: Date | null;
  profileRefreshUntil: Date | null;
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  cfn_user_id: string;
  consecutive_failures: number;
  last_success_at: Date | string | null;
  profile_updated_at: Date | string | null;
  profile_refresh_until: Date | string | null;
}

const toDate = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

export async function claimDuePlayers(
  db: Database,
  workerId: string,
  limit: number,
  leaseMs: number,
): Promise<ClaimedPlayer[]> {
  if (limit <= 0) return [];
  const rows = await db.execute<ClaimedRow>(sql`
    update sf6_player p
       set lease_owner = ${workerId},
           lease_expires_at = now() + ${`${leaseMs} milliseconds`}::interval
     where p.id in (
       select c.id
         from sf6_player c
        where c.next_poll_at is not null
          and c.next_poll_at <= now()
          and (c.lease_expires_at is null or c.lease_expires_at < now())
          and exists (
            select 1 from game_session s where s.player_id = c.id and s.status = 'active'
          )
        order by c.next_poll_at
        limit ${limit}
        for update skip locked
     )
    returning p.id, p.cfn_user_id, p.consecutive_failures, p.last_success_at,
              p.profile_updated_at, p.profile_refresh_until
  `);
  return rows.map((r) => ({
    id: r.id,
    cfnUserId: r.cfn_user_id,
    consecutiveFailures: Number(r.consecutive_failures),
    lastSuccessAt: toDate(r.last_success_at),
    profileUpdatedAt: toDate(r.profile_updated_at),
    profileRefreshUntil: toDate(r.profile_refresh_until),
  }));
}

export async function releaseAllLeases(db: Database, workerId: string): Promise<void> {
  await db
    .update(sf6Player)
    .set({ leaseOwner: null, leaseExpiresAt: null })
    .where(eq(sf6Player.leaseOwner, workerId));
}

export type PollOutcome =
  | {
      status: "ok";
      newMatches: number;
      counted: number;
      profileRefreshed: boolean;
      nextDelayMs: number;
    }
  | { status: "error"; code: string; nextDelayMs: number }
  | { status: "idle" };

export async function pollPlayer(
  db: Database,
  provider: SF6DataProvider,
  player: ClaimedPlayer,
  config: TrackerConfig,
  workerId: string,
  log: Logger,
): Promise<PollOutcome> {
  const plog = log.child({ playerId: player.id });
  const ownLease = and(eq(sf6Player.id, player.id), eq(sf6Player.leaseOwner, workerId));

  const session = await getActiveSession(db, player.id);
  if (!session) {
    await db
      .update(sf6Player)
      .set({ nextPollAt: null, leaseOwner: null, leaseExpiresAt: null })
      .where(ownLease);
    return { status: "idle" };
  }

  const startedAt = Date.now();
  try {
    plog.debug("player.polling");
    const matches = await provider.getRecentMatches(player.cfnUserId);
    const ingest = await ingestMatches(db, matches, {
      playerId: player.id,
      sessionId: session.id,
      startGraceMs: config.startGraceMs,
    });

    const now = Date.now();
    const followUpUntil =
      ingest.inserted > 0 ? new Date(now + PROFILE_FOLLOW_UP_MS) : player.profileRefreshUntil;
    const profileStale =
      player.profileUpdatedAt === null ||
      now - player.profileUpdatedAt.getTime() > config.profileRefreshMs;
    const inFollowUp = followUpUntil !== null && followUpUntil.getTime() > now;

    let profileRefreshed = false;
    if (ingest.inserted > 0 || inFollowUp || profileStale) {
      const profile = await provider.getPlayerProfile(player.cfnUserId);
      const changed = await updatePlayerProfile(db, player.id, profile);
      profileRefreshed = true;
      if (changed) {
        await publishEvent(db, { kind: "player", playerId: player.id });
        plog.info("session.update", { reason: "rating_changed", rank: profile.rank });
      }
    }

    const nextDelayMs = computeNextPollDelay(config.polling, { consecutiveFailures: 0 });
    await db
      .update(sf6Player)
      .set({
        nextPollAt: sql`now() + ${`${nextDelayMs} milliseconds`}::interval`,
        consecutiveFailures: 0,
        lastPollAt: sql`now()`,
        lastSuccessAt: sql`now()`,
        lastError: null,
        profileRefreshUntil: followUpUntil,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownLease);

    const firstSuccessOfSession =
      player.lastSuccessAt === null || player.lastSuccessAt < session.startedAt;
    if (player.consecutiveFailures > 0 || firstSuccessOfSession) {
      // Tracker became healthy (recovered / first check) → update dashboard status.
      await publishEvent(db, { kind: "player", playerId: player.id });
    }
    if (ingest.inserted > 0) {
      plog.info("session.update", {
        reason: "new_matches",
        inserted: ingest.inserted,
        counted: ingest.countedInSession,
        duplicates: ingest.duplicates,
      });
    }
    plog.debug("player.polled", {
      ms: Date.now() - startedAt,
      received: ingest.received,
      inserted: ingest.inserted,
      nextDelayMs,
    });
    return {
      status: "ok",
      newMatches: ingest.inserted,
      counted: ingest.countedInSession,
      profileRefreshed,
      nextDelayMs,
    };
  } catch (err) {
    const failures = player.consecutiveFailures + 1;
    const providerError = err instanceof SF6ProviderError ? err : null;
    const code = providerError?.code ?? "internal";
    const nextDelayMs = computeNextPollDelay(config.polling, {
      consecutiveFailures: failures,
      retryAfterMs: providerError?.retryAfterMs ?? null,
    });
    // A tracker failure must never touch session data — only tracker bookkeeping.
    await db
      .update(sf6Player)
      .set({
        nextPollAt: sql`now() + ${`${nextDelayMs} milliseconds`}::interval`,
        consecutiveFailures: failures,
        lastPollAt: sql`now()`,
        lastError: `${code}: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 300),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(ownLease);
    if (failures === 1) await publishEvent(db, { kind: "player", playerId: player.id });
    plog.warn("provider.error", { code, failures, nextDelayMs, error: err });
    return { status: "error", code, nextDelayMs };
  }
}
