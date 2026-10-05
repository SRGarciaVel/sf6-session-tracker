/**
 * Node-only boot for the embedded tracking runtime. Imported dynamically from
 * src/instrumentation.ts (never statically), so the Edge bundle and `next build` never load it.
 */
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { getSF6DataProvider } from "@/server/sf6";
import { startEmbeddedTracker } from "./embedded";
import { trackerConfigFromEnv } from "./tracker";
import { TrackerRuntime } from "./worker-runtime";

export function bootEmbeddedTracker(): void {
  const env = getEnv();
  startEmbeddedTracker({
    env,
    create: () =>
      new TrackerRuntime({
        db: getDb(),
        provider: getSF6DataProvider(),
        env,
        config: trackerConfigFromEnv(env),
        logger,
        mode: "embedded",
      }),
  });
}
