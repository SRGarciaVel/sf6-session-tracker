"use client";

/**
 * Visual theme selector (Phase 4.5, reorganised in 4.9). Real radio inputs (one group, arrow
 * keys and Tab work natively) styled as compact cards, grouped Free / Creator Beta. Creator
 * themes stay visible to everyone; without `premiumThemes` they're disabled and ONE note explains
 * why (no per-card padlocks). Display only: the server enforces what is saved and rendered.
 *
 * Thumbnails are the real renderer at the real 800×180 canvas, shrunk with a transform, and
 * memoised: they depend only on (theme, locale), so editing the overlay never re-renders them.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { memo, useMemo } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { Badge, cx } from "@/components/ui/primitives";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayThemeId,
} from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import { THEME_REGISTRY, isCreatorTheme } from "@/domain/overlay/themes";
import type { Locale } from "@/i18n/locale";

const CANVAS = { width: 800, height: 180 } as const;
const THUMB_SCALE = 0.21;
const SAMPLE = sampleLiveState({ rank: "Diamond 3", system: "lp", value: 21_480 });

const ThemeThumb = memo(function ThemeThumb({
  theme,
  locale,
}: {
  theme: OverlayThemeId;
  locale: Locale;
}) {
  const config = useMemo(
    () => ({
      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
      preset: "standard" as const,
      fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true },
      animations: false,
      locale,
    }),
    [theme, locale],
  );
  return (
    <span
      aria-hidden
      className="relative flex justify-center overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]"
      style={{ height: CANVAS.height * THUMB_SCALE }}
    >
      <span
        className="pointer-events-none block shrink-0 origin-top"
        style={{
          width: CANVAS.width,
          height: CANVAS.height,
          transform: `scale(${THUMB_SCALE})`,
          marginInline: (CANVAS.width * (1 - THUMB_SCALE)) / -2,
        }}
      >
        <OverlayView config={config} live={SAMPLE} sizing={{ mode: "box", ...CANVAS }} />
      </span>
    </span>
  );
});

export function ThemePicker({
  value,
  locale,
  premiumThemes,
  onSelect,
}: {
  /** STORED theme (may be a Creator theme the owner can't currently use). */
  value: OverlayThemeId;
  locale: Locale;
  premiumThemes: boolean;
  onSelect: (theme: OverlayThemeId) => void;
}) {
  const t = useTranslations("Builder");
  const savedInactive = isCreatorTheme(value) && !premiumThemes;
  const groups = [
    { id: "standard", themes: OVERLAY_THEMES.filter((th) => !isCreatorTheme(th)) },
    { id: "premium", themes: OVERLAY_THEMES.filter((th) => isCreatorTheme(th)) },
  ] as const;

  return (
    <div className="space-y-4" role="radiogroup" aria-label={t("sectionTheme")}>
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          <p className="flex items-center gap-2 font-display text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {group.id === "standard" ? (
              t("themeGroupFree")
            ) : (
              <Badge tone="accent">Creator Beta</Badge>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
            {group.themes.map((theme) => {
              const locked = isCreatorTheme(theme) && !premiumThemes;
              const selected = value === theme;
              return (
                <label
                  key={theme}
                  data-theme={theme}
                  className={cx(
                    "group relative block border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cyan",
                    selected ? "border-cyan bg-cyan/8" : "border-line hover:border-line-strong",
                    locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                  )}
                >
                  <input
                    type="radio"
                    name="overlay-theme"
                    value={theme}
                    checked={selected}
                    disabled={locked}
                    onChange={() => onSelect(theme)}
                    className="sr-only"
                  />
                  <ThemeThumb theme={theme} locale={locale} />
                  <span className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <span className="truncate font-display text-sm leading-tight font-bold uppercase">
                      {t(`themes.${theme}.name`)}
                    </span>
                    {selected && (
                      <span aria-hidden className="text-xs text-cyan">
                        ●
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-muted" data-testid="theme-description">
        {t(`themes.${value}.description`)}
      </p>

      {savedInactive && (
        <p className="border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs font-semibold text-text">
          {t("themeSavedInactive", {
            theme: t(`themes.${value}.name`),
            fallback: t(`themes.${THEME_REGISTRY[value].fallback}.name`),
          })}
        </p>
      )}
      {!premiumThemes && (
        <p className="text-xs text-muted">
          {t("creatorThemesNote")}{" "}
          <Link href="/dashboard#creator-beta" className="text-cyan underline underline-offset-4">
            {t("creator.haveKey")}
          </Link>
        </p>
      )}
    </div>
  );
}
