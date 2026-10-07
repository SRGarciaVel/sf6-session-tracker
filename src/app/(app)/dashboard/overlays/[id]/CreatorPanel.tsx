"use client";

/**
 * Creator tab (Phase 4.9). Everything Creator Beta adds beyond themes, in one place:
 *   presets (top: the fastest path to a known look) → advanced styling grouped as
 *   Typography (number font/size) · Accent (secondary colour) · Visibility (labels, units,
 *   character name, decorations).
 * ONE badge and ONE entitlement/renewal message for the whole tab. Display only: the server
 * keeps or applies Creator values according to the owner's entitlements (saving a Free edit
 * never drops a stored Creator block).
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button } from "@/components/ui/primitives";
import type { OverlayConfig, OverlayThemeId } from "@/domain/overlay/config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  NUMBER_SCALE_MAX,
  NUMBER_SCALE_MIN,
} from "@/domain/overlay/creator";
import { OVERLAY_FONTS, type OverlayFontId } from "@/domain/overlay/fonts";
import { patchCreator } from "./builder-state";
import { ColorField, Group, Slider, Toggle, selectClass } from "./controls";
import type { Update } from "./panels";
import { PresetsSection, type PresetSummary } from "./PresetsSection";

const SHOW_KEYS = ["labels", "units", "characterName", "decorations"] as const;
/** Elements a theme doesn't draw, so the toggle explains instead of silently doing nothing. */
const NOT_IN_THEME: Partial<Record<OverlayThemeId, ReadonlyArray<(typeof SHOW_KEYS)[number]>>> = {
  minimal: ["labels"],
  broadcast: ["decorations"],
};

export function CreatorPanel({
  config,
  update,
  advancedCustomization,
  creatorPresets,
  overlayId,
  presets,
  dirty,
  onPresetApplied,
}: {
  config: OverlayConfig;
  update: Update;
  advancedCustomization: boolean;
  creatorPresets: boolean;
  overlayId: string;
  presets: PresetSummary[];
  dirty: boolean;
  onPresetApplied: (config: OverlayConfig) => void;
}) {
  const t = useTranslations("Builder.creator");
  const tp = useTranslations("Builder.presetsCreator");
  const current = config.creator ?? DEFAULT_CREATOR_CUSTOMIZATION;
  const notInTheme = NOT_IN_THEME[config.theme] ?? [];
  const entitled = advancedCustomization && creatorPresets;
  const storedCustomization = !advancedCustomization && config.creator !== undefined;
  const storedPresets = !creatorPresets && presets.length > 0;

  return (
    <div className="space-y-6" data-testid="creator-panel">
      <div className="space-y-2">
        <Badge tone="accent">Creator Beta</Badge>
        <p className="text-xs leading-relaxed text-muted">{t("tabSummary")}</p>
      </div>

      {!entitled && (
        <div
          className="space-y-1 border-l-2 border-line-strong bg-surface-2/60 px-3 py-2 text-xs"
          data-testid="creator-notice"
        >
          {storedCustomization && (
            <p className="font-semibold text-text">{t("savedButInactive")}</p>
          )}
          {storedPresets && <p className="font-semibold text-text">{tp("savedButInactive")}</p>}
          <p className="text-muted">
            {t("inviteOnly")}{" "}
            <Link href="/dashboard#creator-beta" className="text-cyan underline underline-offset-4">
              {t("haveKey")}
            </Link>
          </p>
        </div>
      )}

      <PresetsSection
        overlayId={overlayId}
        presets={presets}
        config={config}
        enabled={creatorPresets}
        dirty={dirty}
        onApplied={onPresetApplied}
      />

      <fieldset
        disabled={!advancedCustomization}
        className="min-w-0 space-y-6 border-t border-line pt-5 disabled:opacity-50"
        data-testid="creator-customization"
      >
        <legend className="sr-only">{t("title")}</legend>

        <Group title={t("typographyGroup")}>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("numberFont")}</span>
            <select
              value={current.numberFont ?? ""}
              onChange={(e) => {
                const numberFont = e.target.value === "" ? null : (e.target.value as OverlayFontId);
                update((c) => patchCreator(c, { numberFont }));
              }}
              className={`${selectClass} max-w-48`}
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
            onChange={(numberScale) => update((c) => patchCreator(c, { numberScale }))}
          />
        </Group>

        <Group title={t("accentGroup")}>
          <Toggle
            label={t("secondaryAccentToggle")}
            checked={current.secondaryAccent !== null}
            onChange={(on) =>
              update((c) => patchCreator(c, { secondaryAccent: on ? "#ff2e93" : null }))
            }
          />
          {current.secondaryAccent !== null && (
            <ColorField
              label={t("secondaryAccent")}
              value={current.secondaryAccent}
              onChange={(secondaryAccent) => update((c) => patchCreator(c, { secondaryAccent }))}
            />
          )}
        </Group>

        <Group title={t("showTitle")}>
          {SHOW_KEYS.map((key) => (
            <div key={key}>
              <Toggle
                label={t(`show.${key}`)}
                checked={current.show[key]}
                onChange={(v) =>
                  update((c) =>
                    patchCreator(c, {
                      show: { ...(c.creator ?? DEFAULT_CREATOR_CUSTOMIZATION).show, [key]: v },
                    }),
                  )
                }
              />
              {notInTheme.includes(key) && (
                <p className="mt-0.5 text-xs text-faint">{t("notInTheme")}</p>
              )}
            </div>
          ))}
        </Group>

        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update((c) => {
              const next = { ...c };
              delete next.creator;
              return next;
            })
          }
          disabled={!config.creator}
        >
          {t("reset")}
        </Button>
      </fieldset>
    </div>
  );
}
