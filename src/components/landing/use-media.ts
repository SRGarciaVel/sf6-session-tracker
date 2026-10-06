"use client";

import { useSyncExternalStore } from "react";

/**
 * Media query as state. The server snapshot is `serverDefault` (the desktop layout is the SSR
 * baseline); the client switches after hydration. Re-renders only when the match flips.
 */
export function useMedia(query: string, serverDefault: boolean): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

/** Tailwind `lg` (64rem). */
export const DESKTOP_QUERY = "(min-width: 64rem)";

/**
 * Reduced-motion preference that is identical on the server and during hydration (false), then
 * follows the OS setting. (Motion's own hook reads it during the first client render, which
 * makes server and client markup differ.)
 */
export function usePrefersReducedMotion(): boolean {
  return useMedia("(prefers-reduced-motion: reduce)", false);
}
