"use client";

/**
 * Creator tab (Phase 4.9). Everything Creator Beta adds beyond themes, in one place:
 *   presets (top: the fastest path to a known look) → advanced styling grouped as
 *   Typography (number font/size) · Accent (secondary colour) · Visibility (labels, units,
 *   character name, decorations) → Movement (5.0) → Automatic presentation (5.2 / 5.3A).
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
import {
  PRIORITY_DURATIONS,
  ROTATION_INTERVALS,
  ROTATION_ORDERS,
  ROTATION_TRANSITIONS,
  DEFAULT_CHARACTER_ROTATION,
  PRESENTATION_MODES,
  TRANSITION_DIRECTIONS,
  transitionHasDirection,
  type PresentationMode,
  type PriorityDuration,
  type RotationInterval,
  type RotationOrder,
  type RotationTransition,
  type TransitionDirection,
} from "@/domain/overlay/rotation";
import { THEME_REGISTRY } from "@/domain/overlay/themes";
import {
  BRAND_FLAG_ANIMATIONS,
  BRAND_FLAG_COLORS,
  BRAND_FLAG_INTERVALS,
  BRAND_FLAG_LOGOS,
  BRAND_FLAG_MODES,
  BRAND_FLAG_POSITIONS,
  BRAND_FLAG_VISIBLE,
  DEFAULT_BRAND_FLAG,
  type BrandFlagInterval,
  type BrandFlagVisible,
} from "@/domain/overlay/brand-flag";
import {
  canonicalJson,
  patchBrandFlag,
  patchCreator,
  patchMotion,
  patchRotation,
  setMotionEnabled,
} from "./builder-state";
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
  characterRotation,
  brandFlag,
  rotationViews,
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
  characterRotation: boolean;
  brandFlag: boolean;
  /** One cycle of views (null = session) the overlay would show now (live, else the sample). */
  rotationViews: { views: Array<string | null>; sample: boolean };
  overlayId: string;
  presets: PresetSummary[];
  dirty: boolean;
  onPresetApplied: (config: OverlayConfig) => void;
}) {
  const t = useTranslations("Builder.creator");
  const tp = useTranslations("Builder.presetsCreator");
  const current = config.creator ?? DEFAULT_CREATOR_CUSTOMIZATION;
  const notInTheme = NOT_IN_THEME[config.theme] ?? [];
  const entitled =
    advancedCustomization && creatorPresets && motionEffects && characterRotation && brandFlag;
  // One message for any stored Creator styling the owner can't use right now (incl. motion
  // and rotation).
  const storedCustomization =
    (!advancedCustomization && config.creator !== undefined) ||
    (!motionEffects && config.creator?.motion !== undefined) ||
    (!characterRotation && config.creator?.characterRotation?.enabled === true) ||
    (!brandFlag && config.creator?.brandFlag?.enabled === true);
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

      <RotationGroup
        config={config}
        update={update}
        enabled={characterRotation}
        views={rotationViews}
      />

      <BrandFlagGroup config={config} update={update} enabled={brandFlag} />

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
              // Resets the styling only; Movement, rotation and branding have their own switches.
              const next = { ...c };
              delete next.creator;
              const motion = c.creator?.motion;
              const characterRotation = c.creator?.characterRotation;
              const brandFlag = c.creator?.brandFlag;
              if (!motion && !characterRotation && !brandFlag) return next;
              const creator = { ...DEFAULT_CREATOR_CUSTOMIZATION };
              if (motion) creator.motion = motion;
              if (characterRotation) creator.characterRotation = characterRotation;
              if (brandFlag) creator.brandFlag = brandFlag;
              return { ...next, creator };
            })
          }
          disabled={
            !config.creator ||
            canonicalJson({
              ...config.creator,
              motion: undefined,
              characterRotation: undefined,
              brandFlag: undefined,
            }) === canonicalJson(DEFAULT_CREATOR_CUSTOMIZATION)
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

/**
 * Automatic presentation (Phase 5.2 rotation, Phase 5.3A modes): Creator option gated by
 * overlays.characterRotation. Progressive disclosure: only the switch while it's off; direction
 * only for transitions that move; character order only when it changes the cycle; priority
 * duration only meaningful with priority on.
 */
function RotationGroup({
  config,
  update,
  enabled,
  views,
}: {
  config: OverlayConfig;
  update: Update;
  enabled: boolean;
  views: { views: Array<string | null>; sample: boolean };
}) {
  const t = useTranslations("Builder.rotation");
  const rotation = config.creator?.characterRotation ?? DEFAULT_CHARACTER_ROTATION;
  const on = config.creator?.characterRotation?.enabled === true;
  const sequence = views.views.map((v) => v ?? t("viewSession"));
  return (
    <fieldset
      disabled={!enabled}
      className="min-w-0 space-y-4 border-t border-line pt-5 disabled:opacity-50"
      data-testid="creator-rotation"
    >
      <legend className="sr-only">{t("title")}</legend>
      <Group title={t("title")}>
        <Toggle
          label={t("enabled")}
          checked={on}
          onChange={(v) => update((c) => patchRotation(c, { enabled: v }))}
        />
        {!enabled && <p className="text-xs text-faint">{t("requiresCreator")}</p>}
        <p className="text-xs text-faint">{t("summary")}</p>
        {on && (
          <>
            <label className="block text-sm">
              <span className="mb-1.5 block">{t("mode")}</span>
              <select
                value={rotation.mode}
                onChange={(e) => {
                  const mode = e.target.value as PresentationMode;
                  update((c) => patchRotation(c, { mode }));
                }}
                className={selectClass}
                aria-describedby="rotation-mode-hint"
                data-testid="rotation-mode"
              >
                {PRESENTATION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`modes.${m}.label`)}
                  </option>
                ))}
              </select>
              <span id="rotation-mode-hint" className="mt-1 block text-xs text-faint">
                {t(`modes.${rotation.mode}.hint`)}
              </span>
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("interval")}</span>
              <select
                value={rotation.intervalSeconds}
                onChange={(e) => {
                  const intervalSeconds = Number(e.target.value) as RotationInterval;
                  update((c) => patchRotation(c, { intervalSeconds }));
                }}
                className={`${selectClass} max-w-40`}
                data-testid="rotation-interval"
              >
                {ROTATION_INTERVALS.map((n) => (
                  <option key={n} value={n}>
                    {t("seconds", { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t("transition")}</span>
              <select
                value={rotation.transition}
                onChange={(e) => {
                  const transition = e.target.value as RotationTransition;
                  update((c) => patchRotation(c, { transition }));
                }}
                className={`${selectClass} max-w-40`}
                data-testid="rotation-transition"
              >
                {ROTATION_TRANSITIONS.map((v) => (
                  <option key={v} value={v}>
                    {t(`transitions.${v}`)}
                  </option>
                ))}
              </select>
            </label>
            {transitionHasDirection(rotation.transition) && (
              <div className="space-y-1">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("direction")}</span>
                  <select
                    value={rotation.direction}
                    onChange={(e) => {
                      const direction = e.target.value as TransitionDirection;
                      update((c) => patchRotation(c, { direction }));
                    }}
                    className={`${selectClass} max-w-40`}
                    aria-describedby="rotation-direction-hint"
                    data-testid="rotation-direction"
                  >
                    {TRANSITION_DIRECTIONS.map((v) => (
                      <option key={v} value={v}>
                        {t(`directions.${v}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <p id="rotation-direction-hint" className="text-xs text-faint">
                  {t("directionHint")}
                </p>
              </div>
            )}
            {rotation.mode !== "session-active" && (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t("order")}</span>
                <select
                  value={rotation.order}
                  onChange={(e) => {
                    const order = e.target.value as RotationOrder;
                    update((c) => patchRotation(c, { order }));
                  }}
                  className={`${selectClass} max-w-48`}
                  data-testid="rotation-order"
                >
                  {ROTATION_ORDERS.map((o) => (
                    <option key={o} value={o}>
                      {t(`orders.${o}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Toggle
              label={t("prioritize")}
              checked={rotation.prioritizeLatestMatch}
              onChange={(prioritizeLatestMatch) =>
                update((c) => patchRotation(c, { prioritizeLatestMatch }))
              }
            />
            <div className="space-y-1">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t("priorityDuration")}</span>
                <select
                  value={rotation.prioritySeconds}
                  disabled={!rotation.prioritizeLatestMatch}
                  onChange={(e) => {
                    const prioritySeconds = Number(e.target.value) as PriorityDuration;
                    update((c) => patchRotation(c, { prioritySeconds }));
                  }}
                  className={`${selectClass} max-w-40 disabled:opacity-50`}
                  aria-describedby="rotation-priority-hint"
                  data-testid="rotation-priority"
                >
                  {PRIORITY_DURATIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("seconds", { n })}
                    </option>
                  ))}
                </select>
              </label>
              <p id="rotation-priority-hint" className="text-xs text-faint">
                {rotation.prioritizeLatestMatch ? t("priorityHint") : t("priorityOffHint")}
              </p>
            </div>
            <div className="space-y-0.5 text-sm" data-testid="rotation-characters">
              <p>{t("included")}</p>
              <p className="text-xs text-muted">
                {sequence.length > 0
                  ? `${sequence.join(" → ")}${views.sample ? ` (${t("sample")})` : ""}`
                  : t("noCharacters")}
              </p>
            </div>
            {rotation.mode !== "characters" && (
              <p className="text-xs text-faint">{t("viewLabelHint")}</p>
            )}
            {config.ratingCharacterKey !== null && (
              <p
                className="border-l-2 border-cyan/60 bg-surface-2/60 px-3 py-2 text-xs text-text"
                data-testid="rotation-pinned-note"
              >
                {t("pinnedNote")}
              </p>
            )}
          </>
        )}
      </Group>
    </fieldset>
  );
}

/**
 * SST branding (Phase 5.3B): Creator option gated by overlays.brandFlag. Progressive disclosure:
 * only the switch while it's off; frequency and visible time only for the periodic tab.
 */
function BrandFlagGroup({
  config,
  update,
  enabled,
}: {
  config: OverlayConfig;
  update: Update;
  enabled: boolean;
}) {
  const t = useTranslations("Builder.brandFlag");
  const flag = config.creator?.brandFlag ?? DEFAULT_BRAND_FLAG;
  const on = config.creator?.brandFlag?.enabled === true;
  const timed = flag.mode === "timed-tab";
  return (
    <fieldset
      disabled={!enabled}
      className="min-w-0 space-y-4 border-t border-line pt-5 disabled:opacity-50"
      data-testid="creator-brand-flag"
    >
      <legend className="sr-only">{t("title")}</legend>
      <Group title={t("title")}>
        <Toggle
          label={t("enabled")}
          checked={on}
          onChange={(v) => update((c) => patchBrandFlag(c, { enabled: v }))}
        />
        {!enabled && <p className="text-xs text-faint">{t("requiresCreator")}</p>}
        <p className="text-xs text-faint">{t("summary")}</p>
        {on && (
          <>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{t("mode")}</span>
                <Segmented
                  value={flag.mode}
                  onChange={(mode) => update((c) => patchBrandFlag(c, { mode }))}
                  options={BRAND_FLAG_MODES.map((m) => ({
                    value: m,
                    label: t(`modes.${m}.label`),
                  }))}
                />
              </div>
              <p className="text-xs text-faint">{t(`modes.${flag.mode}.hint`)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t("position")}</span>
              <Segmented
                value={flag.position}
                onChange={(position) => update((c) => patchBrandFlag(c, { position }))}
                options={BRAND_FLAG_POSITIONS.map((v) => ({
                  value: v,
                  label: t(`positions.${v}`),
                }))}
              />
            </div>
            {timed && (
              <>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("interval")}</span>
                  <select
                    value={flag.intervalSeconds}
                    onChange={(e) => {
                      const intervalSeconds = Number(e.target.value) as BrandFlagInterval;
                      update((c) => patchBrandFlag(c, { intervalSeconds }));
                    }}
                    className={`${selectClass} max-w-40`}
                    aria-describedby="brand-interval-hint"
                    data-testid="brand-interval"
                  >
                    {BRAND_FLAG_INTERVALS.map((n) => (
                      <option key={n} value={n}>
                        {n < 60 ? t("seconds", { n }) : t("minutes", { n: n / 60 })}
                      </option>
                    ))}
                  </select>
                </label>
                <p id="brand-interval-hint" className="-mt-2 text-xs text-faint">
                  {t("intervalHint")}
                </p>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{t("visible")}</span>
                  <select
                    value={flag.visibleSeconds}
                    onChange={(e) => {
                      const visibleSeconds = Number(e.target.value) as BrandFlagVisible;
                      update((c) => patchBrandFlag(c, { visibleSeconds }));
                    }}
                    className={`${selectClass} max-w-40`}
                    data-testid="brand-visible"
                  >
                    {BRAND_FLAG_VISIBLE.map((n) => (
                      <option key={n} value={n}>
                        {t("seconds", { n })}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{t("animation")}</span>
                    <Segmented
                      value={flag.animation}
                      onChange={(animation) => update((c) => patchBrandFlag(c, { animation }))}
                      options={BRAND_FLAG_ANIMATIONS.map((v) => ({
                        value: v,
                        label: t(`animations.${v}`),
                      }))}
                    />
                  </div>
                  {!config.animations && (
                    <p className="text-xs text-faint" data-testid="brand-instant-note">
                      {t("animationsOff")}
                    </p>
                  )}
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{t("logo")}</span>
              <Segmented
                value={flag.logoVariant}
                onChange={(logoVariant) => update((c) => patchBrandFlag(c, { logoVariant }))}
                options={BRAND_FLAG_LOGOS.map((v) => ({ value: v, label: t(`logos.${v}`) }))}
              />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{t("color")}</span>
                <Segmented
                  value={flag.colorMode}
                  onChange={(colorMode) => update((c) => patchBrandFlag(c, { colorMode }))}
                  options={BRAND_FLAG_COLORS.map((v) => ({ value: v, label: t(`colors.${v}`) }))}
                />
              </div>
              <p className="text-xs text-faint">{t("colorHint")}</p>
            </div>
            <p className="text-xs text-faint">{t("spaceHint")}</p>
          </>
        )}
      </Group>
    </fieldset>
  );
}
