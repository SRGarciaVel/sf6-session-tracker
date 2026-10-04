/**
 * Provider factory. The rest of the server calls getSF6DataProvider() and never imports a
 * concrete implementation directly.
 */
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import type { SF6DataProvider } from "./provider";
import { CapcomSF6DataProvider } from "./providers/capcom";
import { loadCapcomSession } from "./providers/capcom/session";
import { CompanionSF6DataProvider } from "./providers/companion";
import { MockSF6DataProvider } from "./providers/mock";
import { ResilientProvider } from "./resilient";

interface ProviderGlobal {
  __sf6Provider?: ResilientProvider;
}
const g = globalThis as ProviderGlobal;

function createInnerProvider(): SF6DataProvider {
  const env = getEnv();
  switch (env.SF6_PROVIDER) {
    case "capcom":
      return createCapcomProvider();
    case "companion":
      return new CompanionSF6DataProvider(getDb(), env.COMPANION_SNAPSHOT_MAX_AGE_MS);
    case "mock":
      return new MockSF6DataProvider(getDb());
  }
}

/** Prototype — only reached with SF6_PROVIDER=capcom (never the default). */
function createCapcomProvider(): CapcomSF6DataProvider {
  const env = getEnv();
  const log = logger.child({ provider: "capcom" });
  let cookieHeader: string | null = null;
  if (env.CAPCOM_SESSION_FILE) {
    const session = loadCapcomSession(env.CAPCOM_SESSION_FILE);
    cookieHeader = session.cookieHeader;
    // Names only — values are secret.
    log.info("capcom_session_loaded", {
      cookieNames: session.summary.cookieNames,
      expiredNames: session.summary.expiredNames,
    });
  }
  return CapcomSF6DataProvider.withClientOptions(
    {
      baseUrl: env.CAPCOM_BASE_URL,
      cookieHeader,
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      buildIdTtlMs: env.CAPCOM_BUILD_ID_TTL_MS,
    },
    { maxBattlelogPagesPerPoll: env.CAPCOM_MAX_BATTLELOG_PAGES, logger: log },
  );
}

export function getSF6DataProvider(): ResilientProvider {
  if (!g.__sf6Provider) {
    const env = getEnv();
    g.__sf6Provider = new ResilientProvider(createInnerProvider(), {
      timeoutMs: env.PROVIDER_TIMEOUT_MS,
      cacheTtlMs: env.PROVIDER_CACHE_TTL_MS,
    });
  }
  return g.__sf6Provider;
}

/** The provider WITHOUT the resilience/validation wrapper — for `provider:check` only. */
export function getRawSF6DataProvider(): SF6DataProvider {
  return createInnerProvider();
}

/** Only available when SF6_PROVIDER=mock. Callers must also check devToolsEnabled(). */
export function getMockProvider(): MockSF6DataProvider | null {
  return getEnv().SF6_PROVIDER === "mock" ? new MockSF6DataProvider(getDb()) : null;
}

export { SF6ProviderError, cfnUserIdSchema, type SF6DataProvider } from "./provider";
