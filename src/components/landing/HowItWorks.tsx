"use client";

/**
 * Scene 3 — how data flows: Buckler → Companion → SST → OBS. Normal scroll (no pinning). A
 * scroll-linked line fills along the pipeline (Motion value → transform, no React renders) and
 * each node lights up when the line reaches it (state changes only at the 4 thresholds).
 * Icons are SST-native SVG (no third-party logos). The existing 3-step copy stays as text.
 */
import { useTranslations } from "next-intl";
import { m, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui/primitives";
import { usePrefersReducedMotion } from "./use-media";

const NODES = ["buckler", "companion", "sst", "obs"] as const;
/** Which landing step copy (step1..3) explains each node; Buckler is just the source. */
const STEP_OF: Record<(typeof NODES)[number], 1 | 2 | 3 | null> = {
  buckler: null,
  companion: 1,
  sst: 2,
  obs: 3,
};

const ICONS: Record<(typeof NODES)[number], ReactNode> = {
  // Browser window
  buckler: (
    <svg viewBox="0 0 48 48" aria-hidden className="size-9">
      <rect
        x="5"
        y="9"
        width="38"
        height="30"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path d="M5 16h38" stroke="currentColor" strokeWidth="2.5" />
      <path d="M12 26h10M12 31h18" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  ),
  // Extension: a slanted "plug" piece
  companion: (
    <svg viewBox="0 0 48 48" aria-hidden className="size-9">
      <path
        d="M10 14h10v-4h8v4h10v10h-4v8h4v10H10z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="miter"
      />
      <path d="M18 28l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  ),
  // SST: processing — stacked stat bars
  sst: (
    <svg viewBox="0 0 48 48" aria-hidden className="size-9">
      <path d="M8 38l10-28h22L30 38z" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M17 31h10M20 24h12M23 17h12" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  ),
  // Broadcast monitor with a lower-third
  obs: (
    <svg viewBox="0 0 48 48" aria-hidden className="size-9">
      <rect
        x="4"
        y="8"
        width="40"
        height="26"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <path d="M8 28h20" stroke="currentColor" strokeWidth="4" />
      <path d="M18 40h12" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  ),
};

export function HowItWorks() {
  const t = useTranslations("Landing");
  const ref = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 75%", "end 55%"] });
  const fill = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0, 1]);
  const [progressLit, setLit] = useState(0);
  // Reduced motion: the finished pipeline, no scroll-driven progression.
  const lit = reduce ? NODES.length : progressLit;

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const next = Math.min(NODES.length, Math.floor(v * NODES.length + 0.35));
    setLit((prev) => (prev === next ? prev : next));
  });

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-8 py-16 lg:py-24">
      <header className="max-w-2xl">
        <p className="hud-label text-cyan">{t("how.eyebrow")}</p>
        <h2
          id="how-title"
          data-reveal="mask"
          className="mt-3 font-display text-3xl font-bold sm:text-5xl"
        >
          {t("how.title")}
        </h2>
        <p data-reveal="rise" className="mt-4 text-muted">
          {t("how.subtitle")}
        </p>
      </header>

      <div ref={ref} className="relative mt-12">
        {/* Track: vertical on small screens, horizontal from lg */}
        <div aria-hidden className="sst-track">
          <m.div className="sst-track-fill sst-track-fill-y" style={{ scaleY: fill }} />
          <m.div className="sst-track-fill sst-track-fill-x" style={{ scaleX: fill }} />
        </div>
        <ol className="relative grid gap-10 lg:grid-cols-4 lg:gap-6">
          {NODES.map((node, i) => {
            const step = STEP_OF[node];
            const on = i < lit;
            return (
              <li key={node} className="relative pl-16 lg:pl-0 lg:pt-20">
                <span className={cx("sst-node", on && "is-on", node === "sst" && "is-core")}>
                  {ICONS[node]}
                </span>
                <p className="font-mono text-xs tracking-wider text-faint uppercase">
                  {t(`how.nodes.${node}`)}
                </p>
                <h3 className="mt-1 font-display text-xl font-bold uppercase">
                  {step ? t(`step${step}Title`) : t("how.sourceTitle")}
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {step ? t(`step${step}Body`) : t("how.sourceBody")}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
