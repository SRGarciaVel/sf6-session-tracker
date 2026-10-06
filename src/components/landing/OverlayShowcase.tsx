"use client";

/**
 * Scene 4 — the overlay catalog as a product, not a grid. Desktop: one sticky stage that swaps
 * between every registered theme (THEME_REGISTRY order: Free, then Creator Beta) as the list
 * scrolls. Small screens: no pinning — each entry shows its own preview inline.
 * Every visual is the real renderer with a real theme config.
 */
import { useTranslations } from "next-intl";
import { AnimatePresence, m } from "motion/react";
import { Badge, cx } from "@/components/ui/primitives";
import { THEME_REGISTRY } from "@/domain/overlay/themes";
import type { Locale } from "@/i18n/locale";
import { DemoOverlay } from "./DemoOverlay";
import {
  HERO_AFTER,
  SHOWCASE_THEMES,
  STAGE_SCALE,
  landingLiveState,
  landingOverlayConfig,
} from "./demo-state";
import { STAGE_SWAP } from "./motion-tokens";
import { useActiveStep } from "./use-active-step";
import { DESKTOP_QUERY, useMedia } from "./use-media";

const LIVE = landingLiveState(HERO_AFTER);

export function OverlayShowcase({ locale }: { locale: Locale }) {
  const t = useTranslations("Landing.showcase");
  const tb = useTranslations("Builder.themes");
  const { active, stepRef } = useActiveStep(SHOWCASE_THEMES.length);
  const desktop = useMedia(DESKTOP_QUERY, true);
  const theme = SHOWCASE_THEMES[active] ?? SHOWCASE_THEMES[0] ?? "competitive";
  const tierLabel = (id: (typeof SHOWCASE_THEMES)[number]) =>
    THEME_REGISTRY[id].tier === "creator" ? "Creator Beta" : "Free";

  return (
    <section aria-labelledby="showcase-title" className="py-16 lg:py-24">
      <header className="max-w-2xl">
        <p className="hud-label text-cyan">{t("eyebrow")}</p>
        <h2
          id="showcase-title"
          data-reveal="mask"
          className="mt-3 font-display text-3xl font-bold sm:text-5xl"
        >
          {t("title")}
        </h2>
        <p data-reveal="rise" className="mt-4 text-muted">
          {t("subtitle")}
        </p>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-14">
        <ol>
          {SHOWCASE_THEMES.map((id, i) => {
            const creator = THEME_REGISTRY[id].tier === "creator";
            const firstCreator =
              creator && THEME_REGISTRY[SHOWCASE_THEMES[i - 1] ?? id].tier !== "creator";
            return (
              <li
                key={id}
                ref={stepRef(i)}
                data-step={i}
                data-theme={id}
                aria-current={desktop && i === active ? "true" : undefined}
                className="flex flex-col justify-center py-6 lg:min-h-[52vh]"
              >
                {(i === 0 || firstCreator) && (
                  <p className="mb-4 max-w-sm text-sm text-faint">
                    {creator ? t("creatorGroup") : t("freeGroup")}
                  </p>
                )}
                <div
                  className={cx(
                    "border-l-2 pl-5 transition-colors",
                    desktop && i === active
                      ? creator
                        ? "border-magenta"
                        : "border-cyan"
                      : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-2xl font-bold uppercase sm:text-3xl">
                      {tb(`${id}.name`)}
                    </h3>
                    <Badge tone={creator ? "accent" : "neutral"}>{tierLabel(id)}</Badge>
                  </div>
                  <p className="mt-1 text-muted">{t(`taglines.${id}`)}</p>
                </div>
                {!desktop && (
                  <div className="sst-mini-stage mt-4">
                    <DemoOverlay
                      config={landingOverlayConfig(id, locale, { scale: STAGE_SCALE })}
                      live={LIVE}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {desktop && (
          <div className="sticky top-[16vh] self-start">
            <div className="sst-stage sst-stage-tall" data-tier={THEME_REGISTRY[theme].tier}>
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="font-display text-sm font-bold tracking-[0.18em] uppercase">
                  {tb(`${theme}.name`)}
                </span>
                <span className="font-mono text-[11px] text-faint">{tierLabel(theme)}</span>
              </div>
              <div className="relative grid min-h-[340px] grid-cols-[minmax(0,1fr)] place-items-center px-6 py-8">
                <AnimatePresence mode="wait" initial={false}>
                  <m.div key={theme} className="w-full" {...STAGE_SWAP}>
                    <DemoOverlay
                      config={landingOverlayConfig(theme, locale, { scale: STAGE_SCALE })}
                      live={LIVE}
                    />
                  </m.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
