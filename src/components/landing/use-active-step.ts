"use client";

/**
 * Scrollytelling driver: which step block currently crosses the viewport centre. One
 * IntersectionObserver per scene; React state changes only when the active step changes (never
 * per scrolled pixel). Native scroll is untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_BAND_ROOT_MARGIN } from "./motion-tokens";

export function useActiveStep(count: number) {
  const [active, setActive] = useState(0);
  const nodes = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.step);
          if (Number.isInteger(index)) setActive(index);
        }
      },
      { rootMargin: ACTIVE_BAND_ROOT_MARGIN },
    );
    for (const node of nodes.current.slice(0, count)) if (node) observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  const stepRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      nodes.current[index] = node;
    },
    [],
  );
  return { active, stepRef };
}
