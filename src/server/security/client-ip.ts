import { getEnv } from "@/server/env";

/**
 * Client IP for rate limiting.
 *
 * Only trusted when TRUST_PROXY=true (we run behind a proxy that sets the header). For
 * x-forwarded-for the RIGHTMOST entry is used: proxies APPEND the address they saw, so the
 * leftmost entries are whatever the client sent and are spoofable (SEC-013). Platforms with a
 * dedicated header (Vercel: x-real-ip / x-vercel-forwarded-for) set CLIENT_IP_HEADER.
 * Without TRUST_PROXY all requests share one "local" bucket (fine for local dev only).
 */
export function getClientIp(headers: Headers): string {
  const env = getEnv();
  if (!env.TRUST_PROXY) return "local";
  const raw = headers.get(env.CLIENT_IP_HEADER);
  const ip = raw
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  return ip && ip.length <= 64 ? ip : "unknown";
}
