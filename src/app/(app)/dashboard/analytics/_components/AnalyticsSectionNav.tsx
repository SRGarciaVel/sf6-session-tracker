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
 * The active section: the first one (in document order) currently inside the reading band; if
 * none is (between two far-apart headings) keep the previous one. Pure — unit tested.
 */
export function pickActiveSection(
  order: readonly string[],
  visible: ReadonlySet<string>,
  previous: string,
): string {
  return order.find((id) => visible.has(id)) ?? previous;
}

/**
 * Reading band: below the sticky chrome (~ header + strip) and above the lower 55 % of the
 * viewport, so a section becomes active when its top reaches the upper part of the screen.
 */
const ROOT_MARGIN = "-120px 0px -55% 0px";

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
  const stripRef = useRef<HTMLUListElement>(null);

  // Scroll-spy: one observer for all sections; no scroll listeners. A deep link (#matchups) needs
  // no special case: the browser scrolls to the anchor and the observer reports it.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = orderKey.split("|");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        setActive((prev) => pickActiveSection(ids, visible, prev));
      },
      { rootMargin: ROOT_MARGIN },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [orderKey]);

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
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan",
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
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan",
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
