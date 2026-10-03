/** Public (unauthenticated) overlay access shared by the OBS page and API routes. */
import type { OverlayPayload } from "@/domain/overlay/state";
import { getDb } from "@/server/db/client";
import { buildPlayerLiveState } from "@/server/sessions/service";
import { rateLimit, type RateLimitResult } from "@/server/security/rate-limit";
import { getOverlayByToken, type OverlayView } from "./service";

/** Generous: OBS reconnects + several scenes. Stops token brute-forcing and abuse. */
export function limitOverlayRequest(ip: string, kind: "state" | "stream"): RateLimitResult {
  return kind === "stream"
    ? rateLimit(`overlay-stream:${ip}`, 60, 60_000)
    : rateLimit(`overlay-state:${ip}`, 240, 60_000);
}

export async function loadOverlayPayload(
  token: string,
): Promise<{ overlay: OverlayView; payload: OverlayPayload } | null> {
  const db = getDb();
  const overlay = await getOverlayByToken(db, token);
  if (!overlay) return null;
  const live = await buildPlayerLiveState(db, overlay.playerId);
  if (!live) return null;
  return { overlay, payload: { config: overlay.config, live } };
}

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
} as const;
