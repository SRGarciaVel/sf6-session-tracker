/**
 * Tracking worker — a persistent process, independent of HTTP requests and of OBS.
 *
 *   pnpm dev:worker            (development, auto-reload)
 *   node dist/worker.mjs       (production, after `pnpm build:worker`)
 *
 * Safe to run several replicas: players are claimed through DB leases (see tracker.ts).
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
// No module reads env at import time (getEnv() is lazy), so loading .env below is early enough.
import { closeDb, getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { pruneStaleConnections } from "@/server/overlays/service";
import { getSF6DataProvider } from "@/server/sf6";
import {
  claimDuePlayers,
  pollPlayer,
  releaseAllLeases,
  trackerConfigFromEnv,
} from "@/server/tracking/tracker";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; production uses real environment variables.
}

const env = getEnv();
const db = getDb();
const provider = getSF6DataProvider();
const config = trackerConfigFromEnv(env);
const workerId = `${hostname()}-${process.pid}-${randomBytes(3).toString("hex")}`;
const log = logger.child({ component: "worker", workerId });

const inFlight = new Set<Promise<unknown>>();
let stopping = false;
let lastMaintenance = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick(): Promise<void> {
  const capacity = env.WORKER_CONCURRENCY - inFlight.size;
  if (capacity <= 0) return;
  const claimed = await claimDuePlayers(db, workerId, capacity, config.leaseMs, {
    requireCompanionData: env.SF6_PROVIDER === "companion",
  });
  for (const player of claimed) {
    const job: Promise<unknown> = pollPlayer(db, provider, player, config, workerId, log)
      .catch((err: unknown) =>
        log.error("worker.poll_crashed", { playerId: player.id, error: err }),
      )
      .finally(() => inFlight.delete(job));
    inFlight.add(job);
  }
}

async function maintenance(): Promise<void> {
  if (Date.now() - lastMaintenance < 60_000) return;
  lastMaintenance = Date.now();
  const pruned = await pruneStaleConnections(db);
  if (pruned > 0) log.debug("worker.pruned_connections", { pruned });
}

async function main(): Promise<void> {
  log.info("worker.started", {
    provider: provider.name,
    pollIntervalMs: config.polling.intervalMs,
    concurrency: env.WORKER_CONCURRENCY,
  });
  let consecutiveTickErrors = 0;
  while (!stopping) {
    try {
      await tick();
      await maintenance();
      consecutiveTickErrors = 0;
    } catch (err) {
      // e.g. database restarting: keep the process alive and retry with a short backoff.
      consecutiveTickErrors++;
      log.error("worker.tick_failed", { error: err, consecutiveTickErrors });
      await sleep(Math.min(30_000, 1_000 * 2 ** Math.min(consecutiveTickErrors, 5)));
    }
    await sleep(env.WORKER_TICK_MS);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info("worker.stopping", { signal, inFlight: inFlight.size });
  await Promise.allSettled([...inFlight]);
  try {
    await releaseAllLeases(db, workerId);
  } catch (err) {
    log.warn("worker.release_failed", { error: err });
  }
  await closeDb();
  log.info("worker.stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err: unknown) => {
  log.error("worker.fatal", { error: err });
  process.exit(1);
});
