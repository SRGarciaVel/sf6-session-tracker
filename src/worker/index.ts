/**
 * Standalone tracking worker — a persistent process, independent of HTTP requests and of OBS.
 *
 *   pnpm dev:worker            (development, auto-reload)
 *   node dist/worker.mjs       (production split deploy, after `pnpm build:worker`)
 *
 * Thin wrapper around TrackerRuntime (src/server/tracking/worker-runtime.ts), which is shared
 * with the embedded mode. Safe to run several replicas: players are claimed through DB leases.
 */
// No module reads env at import time (getEnv() is lazy), so loading .env below is early enough.
import { closeDb, getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getSF6DataProvider } from "@/server/sf6";
import { trackerConfigFromEnv } from "@/server/tracking/tracker";
import { TrackerRuntime } from "@/server/tracking/worker-runtime";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional; production uses real environment variables.
}

const env = getEnv();

if (env.TRACKER_RUNTIME_MODE === "embedded") {
  // The web server already runs the scheduler (src/instrumentation.ts). Refuse loudly instead of
  // running a second scheduler; use `pnpm dev:web` / `pnpm start` alone in this mode.
  logger.error("worker.refused_embedded_mode", {
    hint: "TRACKER_RUNTIME_MODE=embedded runs the tracker inside the web process; unset it (or set standalone) to run this worker",
  });
  process.exit(1);
}

const runtime = new TrackerRuntime({
  db: getDb(),
  provider: getSF6DataProvider(),
  env,
  config: trackerConfigFromEnv(env),
  logger,
  mode: "standalone",
});

async function shutdown(signal: string): Promise<void> {
  await runtime.stop(signal);
  await closeDb();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

runtime.start();
