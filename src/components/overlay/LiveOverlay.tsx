"use client";

import { useCallback, useState } from "react";
import type { OverlayPayload } from "@/domain/overlay/state";
import { useEventStream } from "@/lib/use-event-stream";
import { OverlayView } from "./OverlayView";

function isPayload(data: unknown): data is OverlayPayload {
  return typeof data === "object" && data !== null && "config" in data && "live" in data;
}

/**
 * OBS Browser Source client. Stateless by design: it renders the server-provided state, then
 * replaces it with each full snapshot pushed by the server. It never computes or increments
 * anything locally.
 */
export function LiveOverlay({ token, initial }: { token: string; initial: OverlayPayload }) {
  const [payload, setPayload] = useState(initial);
  const [revoked, setRevoked] = useState(false);

  const apply = useCallback((data: unknown) => {
    if (!isPayload(data)) return;
    // Drop stale snapshots (e.g. a slow poll response arriving after a newer SSE event).
    // Config-only updates reuse the same live snapshot, so equal timestamps are accepted.
    setPayload((current) => (data.live.generatedAt >= current.live.generatedAt ? data : current));
  }, []);

  useEventStream({
    url: `/api/overlay/${token}/stream`,
    enabled: !revoked,
    handlers: {
      state: apply,
      revoked: () => setRevoked(true),
    },
    fallback: {
      url: `/api/overlay/${token}/state`,
      intervalMs: 10_000,
      onData: apply,
      onGone: () => setRevoked(true),
    },
  });

  if (revoked) return null;
  return <OverlayView config={payload.config} live={payload.live} sizing={{ mode: "viewport" }} />;
}
