"use client";

/**
 * Scene 1 — Hero. The message and CTA are readable immediately (plain server-rendered text; the
 * headline reveal is a CSS load animation). The stage is an abstract "stream" with the real
 * Street overlay docked like on a broadcast; once visible it shows one live update (11-5 → 12-5).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { m, useInView, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/primitives";
import type { Locale } from "@/i18n/locale";
import { usePrefersReducedMotion } from "./use-media";
import { DemoOverlay } from "./DemoOverlay";
import { HERO_AFTER, HERO_BEFORE, landingLiveState, landingOverlayConfig } from "./demo-state";

const BEFORE = landingLiveState(HERO_BEFORE);
const AFTER = landingLiveState(HERO_AFTER);
/** Long enough to read the "before" numbers, short enough to see the update without waiting. */
const LIVE_UPDATE_DELAY_MS = 2200;

export function Hero({
  locale,
  primary,
}: {
  locale: Locale;
  primary: { href: string; label: string };
}) {
  const t = useTranslations("Landing");
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const inView = useInView(stage, { once: true, amount: 0.5 });
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (!inView) return;
    const id = setTimeout(() => setUpdated(true), reduce ? 0 : LIVE_UPDATE_DELAY_MS);
    return () => clearTimeout(id);
  }, [inView, reduce]);

  // Depth on exit: the stage drifts up slower than the page, the backdrop slower still.
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const stageY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -60]);
  const backdropY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 50]);

  return (
    <section
      ref={section}
      aria-labelledby="hero-title"
      className="relative grid items-center gap-10 py-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14 lg:py-16"
    >
      <div className="relative z-10">
        <p className="font-display text-xs font-semibold tracking-[0.3em] text-magenta uppercase">
          {t("eyebrow")}
        </p>
        <h1
          id="hero-title"
          className="mt-4 font-display text-4xl leading-[1.02] font-bold tracking-tight sm:text-6xl"
        >
          <span className="sst-load-mask block">{t("titleLine1")}</span>
          <span className="sst-load-mask sst-delay-1 block text-magenta">{t("titleLine2")}</span>
        </h1>
        <p className="mt-6 max-w-lg text-lg text-muted">{t("subtitle")}</p>
        <p className="mt-3 max-w-lg text-sm font-semibold text-cyan">{t("supportedGame")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={primary.href} className={buttonClass("primary", "lg")}>
            {primary.label}
          </Link>
          <a href="#how" className={buttonClass("ghost", "lg")}>
            {t("seeHow")}
          </a>
        </div>
      </div>

      <m.div ref={stage} style={{ y: stageY }} className="sst-load-stage relative">
        <div className="sst-stream" role="img" aria-label={t("heroStageAlt")}>
          <m.div aria-hidden style={{ y: backdropY }} className="sst-stream-backdrop" />
          <span aria-hidden className="sst-stream-live">
            <span className="sst-live-dot" />
            {t("live")}
          </span>
          <div className="absolute inset-x-[3%] bottom-[5%] w-[78%]">
            <DemoOverlay
              config={landingOverlayConfig("fighter", locale, { preset: "standard" })}
              live={updated ? AFTER : BEFORE}
            />
          </div>
        </div>
        <p className="mt-3 font-mono text-[11px] tracking-wide text-faint">{t("demoNote")}</p>
      </m.div>
    </section>
  );
}
