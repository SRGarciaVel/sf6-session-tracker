"use client";

/**
 * Creator motion runtime for the overlay renderer (Phase 5.0). CSS does the animating
 * (overlay.css, "Creator motion"); this only decides WHEN, once per meaningful data change.
 *
 *   useOverlayUpdate  derives at most one event per new data summary (adjusting state during
 *                     render, like Animated): re-renders, resizes, fit-to-box passes, locale,
 *                     theme or other config edits never produce an event. The event is cleared
 *                     after the effect so nothing replays when elements re-mount later. An
 *                     out-of-order (stale) snapshot never replaces the baseline, so the current
 *                     data arriving again can't replay an already processed match.
 *   MotionFx          one keyed, aria-hidden sweep element per event (re-mount restarts it).
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  detectOverlayChange,
  isStaleSummary,
  summaryKey,
  type OverlayUpdate,
  type OverlaySummary,
} from "@/domain/overlay/motion";

export interface ActiveUpdate extends OverlayUpdate {
  /** Increments per event: re-keys the sweep, alternates keyframes for persistent elements. */
  seq: number;
}

export function useOverlayUpdate(summary: OverlaySummary, clearAfterMs: number | null) {
  const key = summaryKey(summary);
  const [tracked, setTracked] = useState<{
    key: string;
    summary: OverlaySummary;
    update: ActiveUpdate | null;
    seq: number;
  }>({ key, summary, update: null, seq: 0 });

  if (tracked.key !== key) {
    if (isStaleSummary(tracked.summary, summary) || summaryKey(tracked.summary) === key) {
      // Out-of-order snapshot (or the baseline's own data again after one): keep the baseline
      // and any running effect. Only the key is recorded, so this runs once per new snapshot.
      setTracked({ ...tracked, key });
    } else {
      const change = detectOverlayChange(tracked.summary, summary);
      const seq = change ? tracked.seq + 1 : tracked.seq;
      setTracked({ key, summary, seq, update: change ? { ...change, seq } : null });
    }
  }

  // One timer per event; cleared on the next event or unmount (no accumulation).
  const active = tracked.update;
  useEffect(() => {
    if (!active || clearAfterMs === null) return;
    const id = setTimeout(
      () => setTracked((t) => (t.update?.seq === active.seq ? { ...t, update: null } : t)),
      clearAfterMs,
    );
    return () => clearTimeout(id);
  }, [active, clearAfterMs]);

  return clearAfterMs === null ? null : active;
}

/** prefers-reduced-motion, identical on server and first client render (false). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

const MotionContext = createContext<{ update: ActiveUpdate | null; sweep: boolean }>({
  update: null,
  sweep: false,
});
export const MotionProvider = MotionContext.Provider;

/** Accent sweep across the theme panel (only with accentMotion = "sweep" and an active update). */
export function MotionFx() {
  const { update, sweep } = useContext(MotionContext);
  if (!update || !sweep) return null;
  return (
    <span
      key={update.seq}
      aria-hidden
      className="ov-m-sweep"
      data-result={update.result ?? "update"}
    />
  );
}
