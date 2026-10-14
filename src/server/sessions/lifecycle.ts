/**
 * Idle auto-end (server side). Run by TrackerRuntime.maintenance(): server-authoritative, on the
 * existing maintenance cadence, never driven by the dashboard, OBS or the Companion.
 *
 *   find candidates (bounded, index-backed) → evaluate the pure policy (domain/session/lifecycle)
 *   → endSessionInternal({ kind: "idle" }) = the SAME finalization as a manual end, which
 *     re-evaluates the policy under the session lock after ingesting the final batch.
 *
 * Nothing about the lifecycle is persisted besides what a manual end writes (no ended_reason,
 * no idle columns); `session.auto_ended` is logged with the policy that fired.
 */
import { sql } from "drizzle-orm";
import { DEFAULT_SESSION_FILTER, type SessionFilter } from "@/domain/session/engine";
import {
  DEFAULT_LIFECYCLE_POLICY,
  evaluateSessionLifecycle,
  parsePresenceTrack,
  type LifecycleDecision,
  type LifecyclePolicy,
  type SessionLifecycleInput,
} from "@/domain/session/lifecycle";
import type { Database, DbExecutor } from "@/server/db/client";
import type { Env } from "@/server/env";
import type { Logger } from "@/server/logger";
import type { SF6DataProvider } from "@/server/sf6/provider";
import { endSessionInternal } from "./service";

/**
 * Where "SST observed the player's matches" comes from:
 *   companion  companion_snapshot.matches_observed_at — when the account's Companion last
 *              delivered a battlelog (the server's acceptance time). Presence comes from there too.
 *   provider   sf6_player.last_success_at — the last poll whose provider read succeeded (direct
 *              Capcom / mock). A failed or stale read never moves it. No presence in this mode.
 */
export type ObservationSource = "companion" | "provider";

export function observationSourceFor(provider: Env["SF6_PROVIDER"]): ObservationSource {
  return provider === "companion" ? "companion" : "provider";
}

export function lifecyclePolicyFromEnv(
  env: Pick<
    Env,
    | "SESSION_IDLE_TIMEOUT_MINUTES"
    | "SESSION_OFFLINE_CLOSE_MINUTES"
    | "SESSION_ABSOLUTE_CEILING_HOURS"
    | "COMPANION_SNAPSHOT_MAX_AGE_MS"
  >,
): LifecyclePolicy {
  return {
    ...DEFAULT_LIFECYCLE_POLICY,
    idleTimeoutMs: env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000,
    offlineCloseMs: env.SESSION_OFFLINE_CLOSE_MINUTES * 60_000,
    absoluteCeilingMs: env.SESSION_ABSOLUTE_CEILING_HOURS * 3_600_000,
    presenceMaxAgeMs: env.COMPANION_SNAPSHOT_MAX_AGE_MS,
  };
}

interface LifecycleRow extends Record<string, unknown> {
  session_id: string;
  player_id: string;
  started_at: Date | string;
  filter: unknown;
  last_match_at: Date | string | null;
  last_success_at: Date | string | null;
  matches_observed_at: Date | string | null;
  presence: unknown;
}

export interface LifecycleCandidate {
  sessionId: string;
  playerId: string;
  /** Everything the policy needs except `now`. */
  input: Omit<SessionLifecycleInput, "now">;
}

const toDate = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

function filterModes(raw: unknown): SessionFilter["modes"] {
  const modes = (raw as Partial<SessionFilter> | null)?.modes;
  return Array.isArray(modes) ? modes : DEFAULT_SESSION_FILTER.modes;
}

function toCandidate(row: LifecycleRow, source: ObservationSource): LifecycleCandidate {
  return {
    sessionId: row.session_id,
    playerId: row.player_id,
    input: {
      startedAt: new Date(row.started_at),
      lastSessionMatchAt: toDate(row.last_match_at),
      filterModes: filterModes(row.filter),
      lastObservedAt:
        source === "companion" ? toDate(row.matches_observed_at) : toDate(row.last_success_at),
      presence: source === "companion" ? parsePresenceTrack(row.presence) : null,
    },
  };
}

/**
 * One query for both the sweep and the in-lock re-check. Cost: active sessions come from the
 * partial unique index `game_session_one_active_uq` (status = 'active'); the latest session match
 * is a backward index scan of `match_session_idx (session_id, played_at)`; the Companion snapshot
 * is a primary-key lookup. The match table is never scanned.
 */
async function loadLifecycleRows(
  db: DbExecutor,
  where: { sessionId: string } | { idleAtLeastMs: number; now: Date; limit: number },
): Promise<LifecycleRow[]> {
  const activity = sql`greatest(s.started_at, coalesce(lm.last_match_at, s.started_at))`;
  const filter =
    "sessionId" in where
      ? sql`and s.id = ${where.sessionId}`
      : sql`and ${activity} <= ${where.now.toISOString()}::timestamptz - ${`${where.idleAtLeastMs} milliseconds`}::interval`;
  const tail =
    "sessionId" in where ? sql`` : sql`order by ${activity} asc, s.id limit ${where.limit}`;
  return db.execute<LifecycleRow>(sql`
    select s.id as session_id,
           s.player_id,
           s.started_at,
           s.filter,
           lm.last_match_at,
           p.last_success_at,
           cs.matches_observed_at,
           cs.profile -> 'presence' as presence
      from game_session s
      join sf6_player p on p.id = s.player_id
      left join lateral (
        select m.played_at as last_match_at
          from match m
         where m.session_id = s.id
         order by m.played_at desc
         limit 1
      ) lm on true
      left join companion_snapshot cs
        on cs.user_id = p.user_id and cs.cfn_user_id = p.cfn_user_id
     where s.status = 'active'
       ${filter}
     ${tail}
  `);
}

/**
 * Active sessions that MAY be closable: no session activity for at least the shortest rule
 * window (Offline 15 min). The policy itself decides; this only bounds the work.
 */
export async function findIdleSessionCandidates(
  db: DbExecutor,
  options: { source: ObservationSource; policy: LifecyclePolicy; now: Date; limit: number },
): Promise<LifecycleCandidate[]> {
  const idleAtLeastMs = Math.min(
    options.policy.offlineCloseMs,
    options.policy.idleTimeoutMs,
    options.policy.absoluteCeilingMs,
  );
  const rows = await loadLifecycleRows(db, {
    idleAtLeastMs,
    now: options.now,
    limit: options.limit,
  });
  return rows.map((r) => toCandidate(r, options.source));
}

export interface AutoEndOptions {
  source: ObservationSource;
  policy?: LifecyclePolicy;
  /** Injectable clock (tests). Read again for the in-lock re-check. */
  now?: () => Date;
  /** Candidates handled per maintenance run (processed sequentially, one connection). */
  limit?: number;
  log: Logger;
}

export interface AutoEndResult {
  evaluated: number;
  ended: Array<{ sessionId: string; decision: LifecycleDecision }>;
  aborted: number;
  failed: number;
}

export const AUTO_END_BATCH = 25;

export async function autoEndIdleSessions(
  db: Database,
  provider: SF6DataProvider | undefined,
  options: AutoEndOptions,
): Promise<AutoEndResult> {
  const policy = options.policy ?? DEFAULT_LIFECYCLE_POLICY;
  const now = options.now ?? (() => new Date());
  const log = options.log;
  const candidates = await findIdleSessionCandidates(db, {
    source: options.source,
    policy,
    now: now(),
    limit: options.limit ?? AUTO_END_BATCH,
  });
  const result: AutoEndResult = { evaluated: candidates.length, ended: [], aborted: 0, failed: 0 };

  for (const c of candidates) {
    if (evaluateSessionLifecycle({ ...c.input, now: now() }, policy).action !== "end") continue;
    try {
      const outcome = await endSessionInternal(db, c.playerId, provider, {
        kind: "idle",
        expectedSessionId: c.sessionId,
        recheck: async (tx) => {
          const [row] = await loadLifecycleRows(tx, { sessionId: c.sessionId });
          if (!row) throw new Error("locked session vanished");
          const fresh = toCandidate(row, options.source);
          return evaluateSessionLifecycle({ ...fresh.input, now: now() }, policy);
        },
      });
      const d = outcome.status === "ended" ? outcome.decision : null;
      if (d?.action === "end") {
        result.ended.push({ sessionId: c.sessionId, decision: d });
        log.info("session.auto_ended", {
          sessionId: c.sessionId,
          playerId: c.playerId,
          policy: d.policy,
          idleMinutes: Math.round(d.idleMs / 60_000),
          presenceState: d.presenceState,
          presenceAgeSeconds: d.presenceAgeMs === null ? null : Math.round(d.presenceAgeMs / 1000),
        });
      } else if (outcome.status === "aborted") {
        result.aborted++;
        log.info("session.auto_end_aborted", {
          sessionId: c.sessionId,
          reason: outcome.decision.action === "keep" ? outcome.decision.reason : null,
        });
      }
    } catch (err) {
      result.failed++;
      log.warn("session.auto_end_failed", { sessionId: c.sessionId, error: err });
    }
  }
  return result;
}
