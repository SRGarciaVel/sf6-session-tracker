/**
 * Provider factory. The rest of the server calls getSF6DataProvider() and never imports a
 * concrete implementation directly.
 */
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import type { SF6DataProvider } from "./provider";
import { CapcomSF6DataProvider } from "./providers/capcom";
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
      return new CapcomSF6DataProvider();
    case "mock":
      return new MockSF6DataProvider(getDb());
  }
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

/** Only available when SF6_PROVIDER=mock. Callers must also check devToolsEnabled(). */
export function getMockProvider(): MockSF6DataProvider | null {
  return getEnv().SF6_PROVIDER === "mock" ? new MockSF6DataProvider(getDb()) : null;
}

export { SF6ProviderError, cfnUserIdSchema, type SF6DataProvider } from "./provider";
