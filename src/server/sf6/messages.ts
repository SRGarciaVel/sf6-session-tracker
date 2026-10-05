import { getEnv } from "@/server/env";
import { SF6ProviderError } from "./provider";

export type ProviderErrorKey =
  "notFound" | "rateLimited" | "timeout" | "unavailable" | "invalidResponse" | "generic";

/** Translation key (namespace Errors.provider) for a provider failure; never leaks internals. */
export function providerErrorKey(err: unknown): ProviderErrorKey {
  if (err instanceof SF6ProviderError) {
    switch (err.code) {
      case "not_found":
        return "notFound";
      case "rate_limited":
        return "rateLimited";
      case "timeout":
        return "timeout";
      case "unavailable":
        return "unavailable";
      case "invalid_response":
        return "invalidResponse";
    }
  }
  return "generic";
}

/**
 * Companion mode: "unavailable" means the browser companion's data is missing or stale (not a
 * Capcom outage), so callers show a "open the Companion and sync" message instead.
 */
export function isMissingCompanionData(err: unknown): boolean {
  return providerErrorKey(err) === "unavailable" && getEnv().SF6_PROVIDER === "companion";
}
