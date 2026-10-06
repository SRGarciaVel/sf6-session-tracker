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
import {
  ACCENT_MOTIONS,
  DEFAULT_CREATOR_MOTION,
  MOTION_INTENSITIES,
  RANK_MOTIONS,
  UPDATE_STYLES,
  type CreatorMotion,
} from "@/domain/overlay/motion";
import { THEME_REGISTRY } from "@/domain/overlay/themes";
import { canonicalJson, patchCreator, patchMotion, setMotionEnabled } from "./builder-state";
import { ColorField, Group, Segmented, Slider, Toggle, selectClass } from "./controls";
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
  motionEffects,
  overlayId,
  presets,
  dirty,
  onPresetApplied,
}: {
  config: OverlayConfig;
  update: Update;
  advancedCustomization: boolean;
  creatorPresets: boolean;
  motionEffects: boolean;
  overlayId: string;
  presets: PresetSummary[];
  dirty: boolean;
  onPresetApplied: (config: OverlayConfig) => void;
}) {
  const t = useTranslations("Builder.creator");
  const tp = useTranslations("Builder.presetsCreator");
  const current = config.creator ?? DEFAULT_CREATOR_CUSTOMIZATION;
  const notInTheme = NOT_IN_THEME[config.theme] ?? [];
  const entitled = advancedCustomization && creatorPresets && motionEffects;
  // One message for any stored Creator styling the owner can't use right now (incl. motion).
  const storedCustomization =
    (!advancedCustomization && config.creator !== undefined) ||
    (!motionEffects && config.creator?.motion !== undefined);
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
      </fieldset>

      <MotionGroup config={config} update={update} enabled={motionEffects} />

      <fieldset
        disabled={!advancedCustomization}
        className="min-w-0 border-t border-line pt-4 disabled:opacity-50"
      >
        <legend className="sr-only">{t("reset")}</legend>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            update((c) => {
              // Resets the styling only; Movement has its own on/off switch.
              const next = { ...c };
              delete next.creator;
              const motion = c.creator?.motion;
              return motion
                ? { ...next, creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion } }
                : next;
            })
          }
          disabled={
            !config.creator ||
            canonicalJson({ ...config.creator, motion: undefined }) ===
              canonicalJson(DEFAULT_CREATOR_CUSTOMIZATION)
          }
        >
          {t("reset")}
        </Button>
      </fieldset>
    </div>
  );
}

/** Movement (Phase 5.0): Creator motion, gated by overlays.motionEffects. */
function MotionGroup({
  config,
  update,
  enabled,
}: {
  config: OverlayConfig;
  update: Update;
  enabled: boolean;
}) {
  const t = useTranslations("Builder.motion");
  const motion = config.creator?.motion;
  const current = motion ?? DEFAULT_CREATOR_MOTION;
  const hasEmblem = THEME_REGISTRY[config.theme].rankEmblem;
  return (
    <fieldset
      disabled={!enabled}
      className="min-w-0 space-y-4 border-t border-line pt-5 disabled:opacity-50"
      data-testid="creator-motion"
    >
      <legend className="sr-only">{t("title")}</legend>
      <Group title={t("title")}>
        <Toggle
          label={t("enabled")}
          checked={motion !== undefined}
          onChange={(on) => update((c) => setMotionEnabled(c, on))}
        />
        {motion !== undefined && (
          <>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("updateStyle")}</span>
              <select
                value={current.updateStyle}
                onChange={(e) => {
                  const updateStyle = e.target.value as CreatorMotion["updateStyle"];
                  update((c) => patchMotion(c, { updateStyle }));
                }}
                className={`${selectClass} max-w-40`}
              >
                {UPDATE_STYLES.map((s) => (
                  <option key={s} value={s}>
                    {t(`styles.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t("intensity")}</span>
              <Segmented
                value={current.intensity}
                onChange={(intensity) => update((c) => patchMotion(c, { intensity }))}
                options={MOTION_INTENSITIES.map((v) => ({
                  value: v,
                  label: t(`intensities.${v}`),
                }))}
              />
            </div>
            <Toggle
              label={t("resultEmphasis")}
              checked={current.resultEmphasis}
              onChange={(resultEmphasis) => update((c) => patchMotion(c, { resultEmphasis }))}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t("accentMotion")}</span>
              <Segmented
                value={current.accentMotion}
                onChange={(accentMotion) => update((c) => patchMotion(c, { accentMotion }))}
                options={ACCENT_MOTIONS.map((v) => ({ value: v, label: t(`accents.${v}`) }))}
              />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{t("rankMotion")}</span>
                <Segmented
                  value={current.rankMotion}
                  onChange={(rankMotion) => update((c) => patchMotion(c, { rankMotion }))}
                  options={RANK_MOTIONS.map((v) => ({
                    value: v,
                    label: t(`ranks.${v}`),
                    disabled: !hasEmblem && v !== "none",
                  }))}
                />
              </div>
              {!hasEmblem && <p className="text-xs text-faint">{t("rankNotInTheme")}</p>}
            </div>
            <p className="text-xs text-faint">{t("hint")}</p>
          </>
        )}
      </Group>
    </fieldset>
  );
}
