"use client";

/**
 * Progressive reveals (Phase 4.7). Elements marked `data-reveal` are visible in the server HTML.
 * Only after hydration does this root set `data-motion="ready"`; the CSS hides not-yet-seen
 * elements under that attribute alone, and an IntersectionObserver marks them `data-inview`
 * once (no re-hiding). No JS, failed hydration or reduced motion ⇒ everything simply shows.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function RevealRoot({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-inview", "");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const node of el.querySelectorAll("[data-reveal]")) observer.observe(node);
    el.dataset.motion = "ready";
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={root} className="sst-landing">
      {children}
    </div>
  );
}
