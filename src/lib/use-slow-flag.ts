"use client";

import { useEffect, useState } from "react";

/** After this long a pending request gets the "server is starting" hint (free beta wake-up). */
export const SLOW_AFTER_MS = 4_000;

/**
 * True once `active` has stayed true for `ms` (one timer per activation, cleared on change).
 * Used to explain slow responses instead of leaving a spinner unexplained.
 */
export function useSlowFlag(active: boolean, ms = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setSlow(true), ms);
    return () => {
      clearTimeout(id);
      setSlow(false);
    };
  }, [active, ms]);
  return active && slow;
}
