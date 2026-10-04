/**
 * HTTP plumbing for /api/companion/*. These endpoints are called by the browser extension's
 * service worker (chrome-extension:// origin) with a Bearer device token — never with cookies —
 * so a permissive CORS policy without credentials is safe.
 */
import { COMPANION_LIMITS } from "@sf6/capcom-core";
import type { CompanionDeviceRow } from "@/server/db/schema";
import { getDb } from "@/server/db/client";
import { rateLimit } from "@/server/security/rate-limit";
import { authenticateDevice } from "./service";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "600",
  "Cache-Control": "no-store, max-age=0",
} as const;

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export function tooMany(retryAfterSeconds: number): Response {
  return json({ error: "rate_limited" }, 429, { "Retry-After": String(retryAfterSeconds) });
}

/**
 * Read a JSON body with a hard size cap enforced WHILE reading (a missing or lying
 * Content-Length cannot make the server buffer an unbounded body).
 */
export async function readJson(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const max = COMPANION_LIMITS.maxBodyBytes;
  const tooLarge = { ok: false as const, response: json({ error: "payload_too_large" }, 413) };
  if (Number(request.headers.get("content-length") ?? "0") > max) return tooLarge;

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
}

/** Authenticated device or a ready 401 response. */
export async function requireDevice(
  request: Request,
): Promise<{ ok: true; device: CompanionDeviceRow } | { ok: false; response: Response }> {
  const device = await authenticateDevice(getDb(), request.headers.get("authorization"));
  if (!device) return { ok: false, response: json({ error: "unauthorized" }, 401) };
  return { ok: true, device };
}

/** Per-device limiter: protects against a buggy extension looping, never bites at 30 s cadence. */
export function limitDevice(deviceId: string, kind: "sync" | "state") {
  return kind === "sync"
    ? rateLimit(`companion-sync:${deviceId}`, 1, COMPANION_LIMITS.minSyncIntervalMs)
    : rateLimit(`companion-state:${deviceId}`, 20, 60_000);
}
