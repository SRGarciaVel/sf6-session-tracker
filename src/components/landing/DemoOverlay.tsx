"use client";

/**
 * The REAL overlay renderer (OverlayView) at the size of its container, keeping the canvas
 * aspect ratio. Used by every landing scene, so the page shows exactly what OBS shows.
 */
import { useEffect, useRef, useState } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { OVERLAY_PRESETS, type OverlayConfig } from "@/domain/overlay/config";
import type { PlayerLiveState } from "@/domain/overlay/state";

export function DemoOverlay({
  config,
  live,
  className,
}: {
  config: OverlayConfig;
  live: PlayerLiveState;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const canvas = OVERLAY_PRESETS[config.preset];

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = Math.round((width * canvas.height) / canvas.width);
  return (
    <div
      ref={ref}
      className={className}
      // inline-size containment: the overlay's own content can never widen this box (which
      // would feed the measured width back into a bigger font: a growth loop in grid/flex).
      style={{
        aspectRatio: `${canvas.width} / ${canvas.height}`,
        width: "100%",
        minWidth: 0,
        contain: "inline-size",
      }}
    >
      <OverlayView config={config} live={live} sizing={{ mode: "box", width, height }} />
    </div>
  );
}
