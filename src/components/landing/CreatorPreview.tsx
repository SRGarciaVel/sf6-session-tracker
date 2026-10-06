"use client";

/**
 * Scene 5 — what Creator Beta adds: build a look (theme → variant → density → glow), save it
 * as a preset, apply it. Plays ONCE when the scene is in view (~6 s, then stops; Replay
 * available) — no endless motion. Reduced motion: the finished state, no sequence.
 * The overlay is the real renderer with real theme variants.
 */
import { useTranslations } from "next-intl";
import { AnimatePresence, m, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, cx } from "@/components/ui/primitives";
import type { Locale } from "@/i18n/locale";
import { usePrefersReducedMotion } from "./use-media";
import { DemoOverlay } from "./DemoOverlay";
import { CREATOR_SEQUENCE, HERO_AFTER, creatorPreviewConfig, landingLiveState } from "./demo-state";
import { STAGE_SWAP } from "./motion-tokens";

const LIVE = landingLiveState(HERO_AFTER);
const STEP_MS = 1300;
const LAST = CREATOR_SEQUENCE.length - 1;

export function CreatorPreview({ locale }: { locale: Locale }) {
  const t = useTranslations("Landing.creator");
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.6, once: true });
  const reduce = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [runs, setRuns] = useState(0);
  const started = inView || runs > 0;

  useEffect(() => {
    if (!started || reduce) return;
    const id = setInterval(() => {
      setIndex((i) => {
        if (i >= LAST) clearInterval(id);
        return Math.min(i + 1, LAST);
      });
    }, STEP_MS);
    return () => clearInterval(id);
  }, [started, reduce, runs]);

  const shown = reduce ? LAST : index;
  const step = CREATOR_SEQUENCE[shown] ?? "theme";
  const rows = CREATOR_SEQUENCE;

  return (
    <section aria-labelledby="creator-title" className="py-16 lg:py-24">
      <div
        ref={ref}
        className="sst-creator grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12"
      >
        <div>
          <Badge tone="accent">Creator Beta</Badge>
          <h2
            id="creator-title"
            data-reveal="mask"
            className="mt-4 font-display text-3xl font-bold sm:text-4xl"
          >
            {t("title")}
          </h2>
          <p data-reveal="rise" className="mt-3 max-w-md text-muted">
            {t("body")}
          </p>

          {/* The "controls": a compact read-out of what changes, not the full editor. */}
          <ol
            className="mt-6 divide-y divide-line border-y border-line"
            aria-label={t("controlsLabel")}
          >
            {rows.map((row, i) => {
              const on = i === shown;
              const done = i < shown;
              return (
                <li
                  key={row}
                  aria-current={on ? "step" : undefined}
                  className={cx(
                    "flex items-center justify-between gap-3 px-1 py-2.5 text-sm transition-colors",
                    on ? "text-text" : done ? "text-muted" : "text-faint",
                  )}
                >
                  <span className="hud-label">{t(`rows.${row}.label`)}</span>
                  <span className={cx("font-display font-semibold uppercase", on && "text-cyan")}>
                    {done || on ? t(`rows.${row}.value`) : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex items-center gap-3">
            <Button
              size="sm"
              variant="ghost"
              disabled={!reduce && started && index < LAST}
              onClick={() => {
                setIndex(0);
                setRuns((r) => r + 1);
              }}
            >
              {t("replay")}
            </Button>
            <span className="text-xs text-faint" aria-live="polite">
              {shown === LAST ? t("applied") : ""}
            </span>
          </div>
        </div>

        <div className="sst-stage self-center">
          <div className="grid min-h-[300px] grid-cols-[minmax(0,1fr)] place-items-center px-5 py-8">
            <AnimatePresence mode="wait" initial={false}>
              <m.div
                key={step === "preset" ? "preset" : "rank-card"}
                className="w-full"
                {...STAGE_SWAP}
              >
                <DemoOverlay config={creatorPreviewConfig(step, locale)} live={LIVE} />
              </m.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
