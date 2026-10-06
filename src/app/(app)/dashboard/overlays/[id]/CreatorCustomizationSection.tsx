"use client";

/**
 * Creator Beta — advanced overlay customization controls (Creator-module candidate, see
 * docs/creator-overlays.md). Display/editing convenience only: the server decides what is
 * persisted and rendered (owner entitlements). Every pre-Phase-4 option stays in the Free
 * sections above.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@/components/ui/primitives";
import type { OverlayThemeId } from "@/domain/overlay/config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  NUMBER_SCALE_MAX,
  NUMBER_SCALE_MIN,
  type CreatorCustomization,
} from "@/domain/overlay/creator";
import { OVERLAY_FONTS, type OverlayFontId } from "@/domain/overlay/fonts";
import { ColorField, Slider, Toggle } from "./controls";

const SHOW_KEYS = ["labels", "units", "characterName", "decorations"] as const;
/** Elements a theme doesn't draw, so the toggle explains instead of silently doing nothing. */
const NOT_IN_THEME: Partial<Record<OverlayThemeId, ReadonlyArray<(typeof SHOW_KEYS)[number]>>> = {
  minimal: ["labels"],
  broadcast: ["decorations"],
};

export function CreatorCustomizationSection({
  theme,
  value,
  enabled,
  onChange,
}: {
  theme: OverlayThemeId;
  value: CreatorCustomization | undefined;
  enabled: boolean;
  onChange: (next: CreatorCustomization | undefined) => void;
}) {
  const t = useTranslations("Builder.creator");
  const current = value ?? DEFAULT_CREATOR_CUSTOMIZATION;
  const patch = (p: Partial<CreatorCustomization>) => onChange({ ...current, ...p });
  const notInTheme = NOT_IN_THEME[theme] ?? [];

  return (
    <section
      className="space-y-3 border-b border-line px-5 py-4 last:border-b-0"
      aria-labelledby="creator-customization-title"
      data-testid="creator-customization"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="creator-customization-title" className="hud-heading">
          {t("title")}
        </h3>
        <Badge tone="accent">Creator Beta</Badge>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t("summary")}</p>

      {!enabled && (
        <div className="space-y-1 border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs">
          {value && <p className="font-semibold text-text">{t("savedButInactive")}</p>}
          <p className="text-muted">
            {t("inviteOnly")}{" "}
            <Link href="/dashboard#creator-beta" className="text-cyan underline underline-offset-4">
              {t("haveKey")}
            </Link>
          </p>
        </div>
      )}

      <fieldset disabled={!enabled} className="space-y-3 disabled:opacity-50">
        <legend className="sr-only">{t("title")}</legend>

        <Toggle
          label={t("secondaryAccentToggle")}
          checked={current.secondaryAccent !== null}
          onChange={(on) => patch({ secondaryAccent: on ? "#ff2e93" : null })}
        />
        {current.secondaryAccent !== null && (
          <ColorField
            label={t("secondaryAccent")}
            value={current.secondaryAccent}
            onChange={(v) => patch({ secondaryAccent: v })}
          />
        )}

        <label className="flex items-center justify-between gap-3 text-sm">
          <span>{t("numberFont")}</span>
          <select
            value={current.numberFont ?? ""}
            onChange={(e) =>
              patch({
                numberFont: e.target.value === "" ? null : (e.target.value as OverlayFontId),
              })
            }
            className="h-8 max-w-48 border border-line-strong bg-surface-2 px-2 text-sm focus:border-cyan focus:outline-none"
          >
            <option value="">{t("numberFontSame")}</option>
            {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((f) => (
              <option key={f} value={f}>
                {OVERLAY_FONTS[f]}
              </option>
            ))}
          </select>
        </label>

        <Slider
          label={t("numberScale")}
          value={current.numberScale}
          min={NUMBER_SCALE_MIN}
          max={NUMBER_SCALE_MAX}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => patch({ numberScale: v })}
        />

        <p className="hud-label pt-1 text-xs">{t("showTitle")}</p>
        {SHOW_KEYS.map((key) => (
          <div key={key}>
            <Toggle
              label={t(`show.${key}`)}
              checked={current.show[key]}
              onChange={(v) => patch({ show: { ...current.show, [key]: v } })}
            />
            {notInTheme.includes(key) && (
              <p className="mt-0.5 text-xs text-faint">{t("notInTheme")}</p>
            )}
          </div>
        ))}

        <Button variant="ghost" size="sm" onClick={() => onChange(undefined)} disabled={!value}>
          {t("reset")}
        </Button>
      </fieldset>
    </section>
  );
}
