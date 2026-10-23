"use client";

import { useEffect } from "react";

/**
 * Moves keyboard / screen-reader focus to an element once, on mount — for a screen reached
 * through an action whose control is now gone (e.g. «End session» → the recap heading), so
 * focus does not fall back to <body>. The target needs `tabIndex={-1}`. Renders nothing.
 */
export function FocusTarget({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.focus();
  }, [id]);
  return null;
}
