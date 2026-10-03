import { getEnv } from "@/server/env";

/**
 * Client IP for rate limiting. X-Forwarded-For is only trusted when TRUST_PROXY=true (i.e. we
 * run behind a proxy that overwrites it); otherwise all requests share one "unknown" bucket key
 * per header-less client.
 */
export function getClientIp(headers: Headers): string {
  if (getEnv().TRUST_PROXY) {
    const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "local";
}
