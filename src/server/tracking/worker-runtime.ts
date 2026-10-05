/**
 * Tracking runtime: the scheduler loop shared by both deployment modes.
 *
 *   standalone  src/worker/index.ts wraps it in its own process (Render Background Worker)
 *   embedded    src/instrumentation.ts starts one instance inside the web process (free beta)
 *
 * Coordination across instances stays in Postgres (FOR UPDATE SKIP LOCKED leases, see
 * tracker.ts), so any mix of runtimes is safe: two runtimes never poll the same player at once,
 * and a crashed runtime's players are taken over when its leases expire.
 *
 * The runtime never closes the database pool and never calls process.exit(): the process that
 * owns it decides that (the standalone worker does; Next.js does in embedded mode).
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { Database } from "@/server/db/client";
import type { Env } from "@/server/env";
import type { Logger } from "@/server/logger";
import { pruneStaleConnections } from "@/server/overlays/service";
import type { SF6DataProvider } from "@/server/sf6/provider";
import { claimDuePlayers, pollPlayer, releaseAllLeases, type TrackerConfig } from "./tracker";

export type TrackerRuntimeMode = "standalone" | "embedded";

export interface TrackerRuntimeDeps {
  db: Database;
  provider: SF6DataProvider;
  env: Pick<Env, "WORKER_CONCURRENCY" | "WORKER_TICK_MS" | "SF6_PROVIDER">;
  /** trackerConfigFromEnv(env) in production. */
  config: TrackerConfig;
  logger: Logger;
  mode: TrackerRuntimeMode;
  /** Injectable for tests. */
  workerId?: string;
  maintenanceEveryMs?: number;
}

export class TrackerRuntime {
  readonly workerId: string;
  private readonly inFlight = new Set<Promise<unknown>>();
  private readonly config: TrackerConfig;
  private readonly log: Logger;
  private stopping = false;
  private loop: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private lastMaintenance = 0;
  /** Resolves the current inter-tick sleep early so stop() does not wait a full tick. */
  private wake: (() => void) | null = null;

  constructor(private readonly deps: TrackerRuntimeDeps) {
    this.workerId =
      deps.workerId ??
      `${deps.mode === "embedded" ? "web-" : ""}${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
    this.config = deps.config;
    this.log = deps.logger.child({ component: "worker", workerId: this.workerId, mode: deps.mode });
  }

  get running(): boolean {
    return this.loop !== null && !this.stopping;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }

  /** Starts the loop once; later calls are no-ops. Never awaits the loop (it runs forever). */
  start(): void {
    if (this.loop || this.stopping) return;
    this.log.info("worker.started", {
      provider: this.deps.provider.name,
      pollIntervalMs: this.config.polling.intervalMs,
      concurrency: this.deps.env.WORKER_CONCURRENCY,
    });
    this.loop = this.run().catch((err: unknown) => {
      this.log.error("worker.fatal", { error: err });
    });
  }

  /** One scheduling step: claim due players up to the free capacity and poll them. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    const capacity = this.deps.env.WORKER_CONCURRENCY - this.inFlight.size;
    if (capacity <= 0) return;
    const claimed = await claimDuePlayers(
      this.deps.db,
      this.workerId,
      capacity,
      this.config.leaseMs,
      {
        requireCompanionData: this.deps.env.SF6_PROVIDER === "companion",
      },
    );
    for (const player of claimed) {
      const job: Promise<unknown> = pollPlayer(
        this.deps.db,
        this.deps.provider,
        player,
        this.config,
        this.workerId,
        this.log,
      )
        .catch((err: unknown) =>
          this.log.error("worker.poll_crashed", { playerId: player.id, error: err }),
        )
        .finally(() => this.inFlight.delete(job));
      this.inFlight.add(job);
    }
  }

  async maintenance(): Promise<void> {
    const every = this.deps.maintenanceEveryMs ?? 60_000;
    if (Date.now() - this.lastMaintenance < every) return;
    this.lastMaintenance = Date.now();
    const pruned = await pruneStaleConnections(this.deps.db);
    if (pruned > 0) this.log.debug("worker.pruned_connections", { pruned });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  private async run(): Promise<void> {
    let consecutiveTickErrors = 0;
    while (!this.stopping) {
      try {
        await this.tick();
        await this.maintenance();
        consecutiveTickErrors = 0;
      } catch (err) {
        // e.g. database restarting: keep running and retry with a short backoff.
        consecutiveTickErrors++;
        this.log.error("worker.tick_failed", { error: err, consecutiveTickErrors });
        await this.sleep(Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveTickErrors, 5)));
      }
      if (!this.stopping) await this.sleep(this.deps.env.WORKER_TICK_MS);
    }
  }

  /**
   * Graceful stop (idempotent): no new claims from this point, wait for in-flight polls, then
   * release this runtime's leases so another instance can take its players immediately.
   */
  stop(reason = "stop"): Promise<void> {
    this.stopPromise ??= (async () => {
      this.stopping = true;
      this.wake?.();
      this.log.info("worker.stopping", { reason, inFlight: this.inFlight.size });
      await this.loop;
      await Promise.allSettled([...this.inFlight]);
      try {
        await releaseAllLeases(this.deps.db, this.workerId);
      } catch (err) {
        this.log.warn("worker.release_failed", { error: err });
      }
      this.log.info("worker.stopped", { reason });
    })();
    return this.stopPromise;
  }
}
