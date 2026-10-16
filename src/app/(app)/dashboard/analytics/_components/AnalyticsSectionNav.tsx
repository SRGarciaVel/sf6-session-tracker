"use client";

/**
 * In-page section navigation of the Analytics page — the ONLY client component of the page.
 * It holds no analytics data: just section ids and their (already translated) labels.
 *
 *   desktop (lg+)  sticky sidebar, grouped
 *   < lg           sticky horizontal strip, scrollable inside itself (never the page)
 *
 * Links are plain `#anchors`, so they work without JavaScript and keep the current query string
 * (range / mode / character). JavaScript only adds scroll-spy: an IntersectionObserver marks the
 * section being read with aria-current="location".
 */
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";

export interface SectionNavItem {
  id: string;
  label: string;
  /** Shorter label for the mobile strip. */
  shortLabel: string;
}

export interface SectionNavGroup {
  label: string;
  items: SectionNavItem[];
}

/**
 * The active section. At the very top of the page it is the first section and at the very bottom
 * the last one (a short last section may never reach the reading band); otherwise the first
 * section (in document order) inside the reading band, or — between two far-apart headings — the
 * previous one. Pure — unit tested.
 */
export function pickActiveSection(
  order: readonly string[],
  visible: ReadonlySet<string>,
  previous: string,
  edge: "top" | "bottom" | null = null,
): string {
  if (edge === "top") return order[0] ?? previous;
  if (edge === "bottom") return order[order.length - 1] ?? previous;
  return order.find((id) => visible.has(id)) ?? previous;
}

function scrollEdge(): "top" | "bottom" | null {
  const el = document.documentElement;
  if (window.scrollY <= 4) return "top";
  if (window.scrollY + window.innerHeight >= el.scrollHeight - 4) return "bottom";
  return null;
}

/**
 * Reading band top, per breakpoint: just above where an anchored heading lands (the section
 * scroll margins in parts.tsx: 208 / 160 / 96 px), so after a jump the target is in the band and
 * the previous section (≥ 48 px above) is not. The band ends above the lower 55 % of the viewport.
 */
const BAND_TOP: ReadonlyArray<{ query: string | null; px: number }> = [
  { query: "(min-width: 1024px)", px: 72 },
  { query: "(min-width: 640px)", px: 136 },
  { query: null, px: 184 },
];

function readingBandTop(): number {
  return BAND_TOP.find((b) => b.query === null || window.matchMedia(b.query).matches)?.px ?? 184;
}

export function AnalyticsSectionNav({
  label,
  groups,
  context,
}: {
  /** aria-label of the navigation landmark. */
  label: string;
  groups: SectionNavGroup[];
  /** Compact active-filter summary ("90 días · Ranked · A.K.I."), kept visible while scrolling. */
  context: string;
}) {
  const items = groups.flatMap((g) => g.items);
  const order = items.map((i) => i.id);
  const orderKey = order.join("|");
  const [active, setActive] = useState(order[0] ?? "");
  // Recomputed only when a breakpoint flips (media-query events, not scroll events).
  const [bandTop, setBandTop] = useState<number | null>(null);

  useEffect(() => {
    const queries = BAND_TOP.flatMap((b) => (b.query ? [window.matchMedia(b.query)] : []));
    const update = () => setBandTop(readingBandTop());
    for (const q of queries) q.addEventListener("change", update);
    const raf = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(raf);
      for (const q of queries) q.removeEventListener("change", update);
    };
  }, []);
  const stripRef = useRef<HTMLUListElement>(null);

  // Scroll-spy: one observer for all sections; no scroll listeners. A deep link (#matchups) needs
  // no special case: the browser scrolls to the anchor and the observer reports it.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || bandTop === null) return;
    const ids = orderKey.split("|");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // Edges are read only when the observer fires (no scroll listener).
        const edge = scrollEdge();
        setActive((prev) => pickActiveSection(ids, visible, prev, edge));
      },
      { rootMargin: `-${bandTop}px 0px -55% 0px` },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [orderKey, bandTop]);

  // Keep the active pill visible inside the mobile strip (horizontal only: never moves the page).
  useEffect(() => {
    const strip = stripRef.current;
    const pill = strip?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!strip || !pill) return;
    const left = pill.offsetLeft - strip.clientWidth / 2 + pill.offsetWidth / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [active]);

  const current = (id: string) => (id === active ? "location" : undefined);

  return (
    <>
      {/* < lg: sticky strip under the global header. */}
      <nav
        aria-label={label}
        className="sticky top-[103px] z-20 -mx-4 border-b border-line bg-bg/95 px-4 backdrop-blur-sm sm:top-[58px] sm:-mx-6 sm:px-6 lg:hidden"
        data-testid="analytics-nav-mobile"
      >
        <p className="truncate pt-2 text-xs text-muted" data-testid="analytics-nav-context-mobile">
          {context}
        </p>
        <ul ref={stripRef} className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                data-section={item.id}
                aria-current={current(item.id)}
                onClick={() => setActive(item.id)}
                className={cx(
                  "inline-flex h-9 items-center border px-3 font-display text-sm font-bold tracking-wide whitespace-nowrap uppercase transition-colors motion-reduce:transition-none",
                  "focus-visible:-outline-offset-2",
                  item.id === active
                    ? "border-cyan bg-cyan/12 text-text"
                    : "border-line-strong text-muted hover:border-cyan hover:text-text",
                )}
              >
                {item.shortLabel}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* lg+: sticky sidebar. */}
      <nav
        aria-label={label}
        className="sticky top-20 hidden max-h-[calc(100vh-6rem)] self-start overflow-y-auto lg:block"
        data-testid="analytics-nav-desktop"
      >
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="hud-label mb-1.5 text-xs text-faint">{g.label}</p>
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      data-section={item.id}
                      aria-current={current(item.id)}
                      onClick={() => setActive(item.id)}
                      className={cx(
                        "block border-l-2 py-1.5 pl-3 text-sm transition-colors motion-reduce:transition-none",
                        "focus-visible:-outline-offset-2",
                        item.id === active
                          ? "border-cyan font-semibold text-text"
                          : "border-transparent text-muted hover:border-line-strong hover:text-text",
                      )}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p
            className="border-t border-line pt-3 text-xs leading-relaxed text-muted"
            data-testid="analytics-nav-context"
          >
            {context}
          </p>
        </div>
      </nav>
    </>
  );
}
