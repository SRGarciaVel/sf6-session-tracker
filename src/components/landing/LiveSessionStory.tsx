"use client";

/**
 * Scene 2 — a match ends and the overlay updates by itself. Scrollytelling with native
 * `position: sticky`: the step texts scroll normally (all in the DOM, readable without JS); the
 * stage sticks beside them (above them on small screens) and follows the step crossing the
 * viewport centre. The overlay is the real renderer: at "updated" it ticks 11-5 → 12-5,
 * 1588 → 1684 MR (+96), streak 3 → 4 with its own HUD animation.
 */
import { useTranslations } from "next-intl";
import { AnimatePresence, m } from "motion/react";
import { cx } from "@/components/ui/primitives";
import type { Locale } from "@/i18n/locale";
import { DemoOverlay } from "./DemoOverlay";
import {
  STAGE_SCALE,
  STORY_STATS,
  STORY_STEPS,
  landingLiveState,
  landingOverlayConfig,
} from "./demo-state";
import { DURATION, EASE_SNAP } from "./motion-tokens";
import { useActiveStep } from "./use-active-step";

const STATES = Object.fromEntries(
  STORY_STEPS.map((s) => [s, landingLiveState(STORY_STATS[s])]),
) as Record<(typeof STORY_STEPS)[number], ReturnType<typeof landingLiveState>>;

export function LiveSessionStory({ locale }: { locale: Locale }) {
  const t = useTranslations("Landing.story");
  const { active, stepRef } = useActiveStep(STORY_STEPS.length);
  const step = STORY_STEPS[active] ?? "live";
  const config = landingOverlayConfig("competitive", locale, { scale: STAGE_SCALE });

  return (
    <section aria-labelledby="story-title" className="relative py-16 lg:py-24">
      <header className="max-w-2xl">
        <p className="hud-label text-cyan">{t("eyebrow")}</p>
        <h2
          id="story-title"
          data-reveal="mask"
          className="mt-3 font-display text-3xl font-bold sm:text-5xl"
        >
          {t("title")}
        </h2>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
        {/* Stage: sticky beside (desktop) or above (mobile) the steps */}
        <div className="sticky top-2 z-10 self-start lg:order-2 lg:top-[18vh]">
          <div className="sst-stage" data-step={step}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <AnimatePresence mode="wait" initial={false}>
                <m.span
                  key={step}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: DURATION.fast, ease: EASE_SNAP }}
                  className={cx("sst-status", `sst-status-${step}`)}
                >
                  {t(`status.${step}`)}
                </m.span>
              </AnimatePresence>
              <span className="hidden font-mono text-[11px] text-faint sm:inline">
                {t("demoValues")}
              </span>
            </div>
            <div className="relative px-3 py-5 sm:px-6 sm:py-8">
              <DemoOverlay config={config} live={STATES[step]} />
              {step === "victory" && <span aria-hidden className="sst-victory-flash" />}
            </div>
            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs">
              <span aria-hidden className={cx("sst-obs-dot", step === "obs" && "is-on")} />
              <span className={step === "obs" ? "text-win" : "text-faint"}>{t("obsSource")}</span>
            </div>
          </div>
        </div>

        <ol className="relative lg:order-1">
          {STORY_STEPS.map((s, i) => (
            <li
              key={s}
              ref={stepRef(i)}
              data-step={i}
              aria-current={i === active ? "step" : undefined}
              className={cx(
                "sst-story-step flex min-h-[40vh] flex-col justify-center border-l-2 py-8 pl-5 lg:min-h-[60vh] lg:pl-8",
                i === active ? "border-cyan" : "border-line",
              )}
            >
              <span className="font-mono text-xs text-faint">{`0${i + 1}`}</span>
              <h3
                className={cx(
                  "mt-1 font-display text-2xl font-bold uppercase transition-colors sm:text-3xl",
                  i === active ? "text-text" : "text-muted",
                )}
              >
                {t(`steps.${s}.title`)}
              </h3>
              <p className="mt-2 max-w-sm text-muted">{t(`steps.${s}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
