"use client";

/**
 * Visual theme selector (Phase 4.5). Every theme is shown with a live thumbnail. Creator themes
 * are visible to everyone; without `premiumThemes` they can't be selected (one discreet note,
 * no per-card padlocks). Display only: the server enforces what is saved and rendered.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
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

const THUMB = { width: 280, height: 63 } as const;
const SAMPLE = sampleLiveState({ rank: "Diamond 3", system: "lp", value: 21_480 });

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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {OVERLAY_THEMES.map((theme) => {
          const creator = isCreatorTheme(theme);
          const locked = creator && !premiumThemes;
          const selected = value === theme;
          return (
            <button
              key={theme}
              type="button"
              data-theme={theme}
              aria-pressed={selected}
              aria-disabled={locked}
              disabled={locked}
              onClick={() => onSelect(theme)}
              className={cx(
                "group block w-full border text-left transition-colors",
                selected ? "border-cyan bg-cyan/8" : "border-line hover:border-line-strong",
                locked && "cursor-not-allowed",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "relative block overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]",
                  locked && "opacity-60",
                )}
                style={{ aspectRatio: `${THUMB.width} / ${THUMB.height}` }}
              >
                <span className="pointer-events-none absolute inset-0">
                  <OverlayView
                    config={{
                      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
                      preset: "standard",
                      fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true },
                      animations: false,
                      locale,
                    }}
                    live={SAMPLE}
                    sizing={{ mode: "box", ...THUMB }}
                  />
                </span>
              </span>
              <span className="flex items-center gap-2 px-3 pt-2">
                <span className="font-display text-base leading-tight font-bold uppercase">
                  {t(`themes.${theme}.name`)}
                </span>
                {creator && <Badge tone="accent">Creator Beta</Badge>}
              </span>
              <span className="block px-3 pb-2 text-xs text-muted">
                {t(`themes.${theme}.description`)}
              </span>
            </button>
          );
        })}
      </div>

      {savedInactive && (
        <p className="border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs">
          <span className="font-semibold text-text">
            {t("themeSavedInactive", {
              theme: t(`themes.${value}.name`),
              fallback: t(`themes.${THEME_REGISTRY[value].fallback}.name`),
            })}
          </span>
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
