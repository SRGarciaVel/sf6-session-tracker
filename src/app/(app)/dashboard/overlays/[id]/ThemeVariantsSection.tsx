"use client";

/**
 * Variants of the current Creator theme (Phase 4.5; inline under the picker since 4.9). Bounded enums/booleans only; each one
 * has a visible effect in that theme. Stored per theme, so switching themes keeps them.
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { CreatorThemeId } from "@/domain/overlay/themes";
import { DEFAULT_THEME_VARIANTS, type ThemeVariants } from "@/domain/overlay/variants";
import { Segmented, Toggle } from "./controls";

export function ThemeVariantsSection({
  theme,
  value,
  enabled,
  onChange,
}: {
  theme: CreatorThemeId;
  value: ThemeVariants | undefined;
  enabled: boolean;
  onChange: (next: ThemeVariants) => void;
}) {
  const t = useTranslations("Builder.variants");
  const tb = useTranslations("Builder");
  const all = value ?? DEFAULT_THEME_VARIANTS;
  const patch = <K extends CreatorThemeId>(key: K, p: Partial<ThemeVariants[K]>) =>
    onChange({ ...all, [key]: { ...all[key], ...p } });

  const row = (label: string, control: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      {control}
    </div>
  );

  // Rendered inline right under the theme picker (Phase 4.9): contextual to the selected theme.
  return (
    <div className="space-y-3 border-l-2 border-magenta/60 pl-4" data-testid="theme-variants">
      <p
        id="theme-variants-title"
        className="font-display text-xs font-semibold tracking-[0.14em] text-muted uppercase"
      >
        {t("titleFor", { theme: tb(`themes.${theme}.name`) })}
      </p>
      {!enabled && value && (
        <p className="border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs font-semibold">
          {t("savedButInactive")}
        </p>
      )}
      <fieldset disabled={!enabled} className="space-y-3 disabled:opacity-50">
        <legend className="sr-only">{t("title")}</legend>
        {theme === "rank-card" && (
          <>
            {row(
              t("density"),
              <Segmented
                value={all["rank-card"].density}
                onChange={(density) => patch("rank-card", { density })}
                options={(["compact", "normal"] as const).map((v) => ({
                  value: v,
                  label: t(`densityValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("badge"),
              <Segmented
                value={all["rank-card"].badge}
                onChange={(badge) => patch("rank-card", { badge })}
                options={(["normal", "large"] as const).map((v) => ({
                  value: v,
                  label: t(`badgeValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("glow"),
              <Segmented
                value={all["rank-card"].glow}
                onChange={(glow) => patch("rank-card", { glow })}
                options={(["off", "subtle", "strong"] as const).map((v) => ({
                  value: v,
                  label: t(`glowValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("background"),
              <Segmented
                value={all["rank-card"].background}
                onChange={(background) => patch("rank-card", { background })}
                options={(["translucent", "solid"] as const).map((v) => ({
                  value: v,
                  label: t(`backgroundValues.${v}`),
                }))}
              />,
            )}
          </>
        )}
        {theme === "broadcast" && (
          <>
            {row(
              t("separators"),
              <Segmented
                value={all.broadcast.separators}
                onChange={(separators) => patch("broadcast", { separators })}
                options={(["subtle", "strong"] as const).map((v) => ({
                  value: v,
                  label: t(`separatorsValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("accent"),
              <Segmented
                value={all.broadcast.accent}
                onChange={(accent) => patch("broadcast", { accent })}
                options={(["line", "block"] as const).map((v) => ({
                  value: v,
                  label: t(`accentValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("density"),
              <Segmented
                value={all.broadcast.density}
                onChange={(density) => patch("broadcast", { density })}
                options={(["compact", "normal"] as const).map((v) => ({
                  value: v,
                  label: t(`densityValues.${v}`),
                }))}
              />,
            )}
          </>
        )}
        {theme === "prestige" && (
          <>
            {row(
              t("glow"),
              <Segmented
                value={all.prestige.glow}
                onChange={(glow) => patch("prestige", { glow })}
                options={(["subtle", "normal", "strong"] as const).map((v) => ({
                  value: v,
                  label: t(`glowValues.${v}`),
                }))}
              />,
            )}
            {row(
              t("frame"),
              <Segmented
                value={all.prestige.frame}
                onChange={(frame) => patch("prestige", { frame })}
                options={(["subtle", "normal"] as const).map((v) => ({
                  value: v,
                  label: t(`frameValues.${v}`),
                }))}
              />,
            )}
            <Toggle
              label={t("animatedAccent")}
              checked={all.prestige.animatedAccent}
              onChange={(animatedAccent) => patch("prestige", { animatedAccent })}
            />
          </>
        )}
      </fieldset>
    </div>
  );
}
