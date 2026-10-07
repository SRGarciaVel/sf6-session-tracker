"use client";

/**
 * Overlay builder panels (Phase 4.9): Appearance, Content and Style. Every control edits the
 * ONE canonical config held by OverlayBuilder through `update`. Every option here is Free;
 * Creator-only controls live in CreatorPanel (one place for entitlement UI).
 */
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Input, cx } from "@/components/ui/primitives";
import {
  OVERLAY_FONTS,
  STATS_SCOPES,
  applyThemeDefaults,
  type OverlayConfig,
  type StatsScope,
  type OverlayFontId,
} from "@/domain/overlay/config";
import { isCreatorTheme, supportedCanvas } from "@/domain/overlay/themes";
import { LOCALES, type Locale } from "@/i18n/locale";
import { FIELD_GROUPS, setAllFields, themeDefault, type ResettableKey } from "./builder-state";
import { ColorField, Group, Segmented, Slider, Toggle, selectClass } from "./controls";
import { ThemePicker } from "./ThemePicker";
import { ThemeVariantsSection } from "./ThemeVariantsSection";

export type Update = (fn: (c: OverlayConfig) => OverlayConfig) => void;

/* ───────────────────────── Appearance ───────────────────────── */

export function AppearancePanel({
  config,
  update,
  premiumThemes,
}: {
  config: OverlayConfig;
  update: Update;
  premiumThemes: boolean;
}) {
  return (
    <div className="space-y-5">
      <ThemePicker
        value={config.theme}
        locale={config.locale}
        premiumThemes={premiumThemes}
        onSelect={(theme) =>
          update((c) => {
            const next = applyThemeDefaults(c, theme);
            return { ...next, preset: supportedCanvas(theme, next.preset) };
          })
        }
      />
      {/* Variants appear right where the theme is chosen. */}
      {isCreatorTheme(config.theme) && (
        <ThemeVariantsSection
          theme={config.theme}
          value={config.variants}
          enabled={premiumThemes}
          onChange={(variants) => update((c) => ({ ...c, variants }))}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Content ───────────────────────── */

export function ContentPanel({
  config,
  update,
  characters,
  defaultTitle,
}: {
  config: OverlayConfig;
  update: Update;
  characters: ReadonlyArray<{ characterKey: string; characterName: string }>;
  defaultTitle: string;
}) {
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  return (
    <div className="space-y-6">
      <Group title={t("statsTitle")}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => update((c) => setAllFields(c, true))}>
            {t("showAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => update((c) => setAllFields(c, false))}>
            {t("hideAll")}
          </Button>
        </div>
        {FIELD_GROUPS.map((group) => (
          <div key={group.id} className="space-y-2">
            <p className="text-xs text-faint">{t(`statsGroups.${group.id}`)}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {group.fields.map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config.fields[f]}
                    onChange={(e) =>
                      update((c) => ({ ...c, fields: { ...c.fields, [f]: e.target.checked } }))
                    }
                    className="size-4 accent-[var(--color-cyan)]"
                  />
                  {t(`fields.${f}`)}
                </label>
              ))}
            </div>
          </div>
        ))}
      </Group>

      <Group title={t("titleGroup")}>
        <Toggle
          label={t("showTitle")}
          checked={config.showTitle}
          onChange={(v) => update((c) => ({ ...c, showTitle: v }))}
        />
        <label className="block text-sm">
          <span className="mb-1.5 block">{t("titleLabel")}</span>
          <Input
            value={config.title}
            maxLength={24}
            disabled={!config.showTitle}
            onChange={(e) => {
              const title = e.target.value;
              update((c) => ({ ...c, title }));
            }}
            placeholder={t("titlePlaceholder", { default: defaultTitle })}
          />
        </label>
      </Group>

      <Group title={t("sessionStatsGroup")}>
        <label className="block text-sm">
          <span className="mb-1.5 block">{t("statsScope")}</span>
          <select
            value={config.statsScope}
            onChange={(e) => {
              const statsScope = e.target.value as StatsScope;
              update((c) => ({ ...c, statsScope }));
            }}
            className={selectClass}
            data-testid="stats-scope"
            aria-describedby="stats-scope-hint"
          >
            {STATS_SCOPES.map((scope) => (
              <option key={scope} value={scope}>
                {t(`statsScopes.${scope}.label`)}
              </option>
            ))}
          </select>
          <span id="stats-scope-hint" className="mt-1 block text-xs text-faint">
            {t(`statsScopes.${config.statsScope}.hint`)}
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block">{t("ratingCharacter")}</span>
          <select
            value={config.ratingCharacterKey ?? ""}
            onChange={(e) => {
              const key = e.target.value || null;
              update((c) => ({ ...c, ratingCharacterKey: key }));
            }}
            className={selectClass}
            data-testid="rating-character"
            aria-describedby="rating-character-hint"
          >
            <option value="">{t("ratingCharacterActive")}</option>
            {characters.map((c) => (
              <option key={c.characterKey} value={c.characterKey}>
                {c.characterName}
              </option>
            ))}
          </select>
          <span id="rating-character-hint" className="mt-1 block text-xs text-faint">
            {config.statsScope === "character"
              ? t("ratingCharacterHintScoped")
              : t("ratingCharacterHint")}
          </span>
        </label>
      </Group>

      <Group title={t("languageGroup")}>
        <div className="space-y-1.5 text-sm">
          <span className="block">{t("overlayLanguage")}</span>
          <Segmented<Locale>
            value={config.locale}
            onChange={(v) => update((c) => ({ ...c, locale: v }))}
            options={LOCALES.map((l) => ({ value: l, label: tc(`languageNames.${l}`) }))}
          />
          <p className="text-xs text-faint">{t("overlayLanguageHint")}</p>
        </div>
      </Group>
    </div>
  );
}

/* ───────────────────────── Style ───────────────────────── */

export function StylePanel({
  config,
  update,
  onOpenCreator,
}: {
  config: OverlayConfig;
  update: Update;
  onOpenCreator: () => void;
}) {
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const [confirmReset, setConfirmReset] = useState(false);
  const color = (key: ResettableKey, label: string) => (
    <ColorField
      label={label}
      value={config[key]}
      resetTo={themeDefault(config, key)}
      onChange={(v) => update((c) => ({ ...c, [key]: v }))}
    />
  );

  return (
    <div className="space-y-6">
      <Group title={t("typography")}>
        <label className="block text-sm">
          <span className="mb-1.5 block">{t("font")}</span>
          <select
            value={config.font}
            onChange={(e) => {
              const font = e.target.value as OverlayFontId;
              update((c) => ({ ...c, font }));
            }}
            className={selectClass}
          >
            {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((f) => (
              <option key={f} value={f} style={{ fontFamily: `var(--ovf-${f})` }}>
                {OVERLAY_FONTS[f]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onOpenCreator}
          className="text-xs text-cyan underline-offset-4 hover:underline"
        >
          {t("moreTypography")}
        </button>
      </Group>

      <Group title={t("colorsCore")}>
        {color("textColor", t("colorText"))}
        {color("mutedColor", t("colorLabels"))}
        {color("accentColor", t("colorAccent"))}
      </Group>

      <Group title={t("colorsResults")}>
        {color("winColor", t("colorWin"))}
        {color("lossColor", t("colorLoss"))}
      </Group>

      <Group title={t("backgroundGroup")}>
        {color("backgroundColor", t("colorBackground"))}
        <Slider
          label={t("opacity")}
          value={config.backgroundOpacity}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update((c) => ({ ...c, backgroundOpacity: v }))}
        />
      </Group>

      <Group title={t("borderGroup")}>
        <Toggle
          label={t("border")}
          checked={config.borderEnabled}
          onChange={(v) => update((c) => ({ ...c, borderEnabled: v }))}
        />
        {config.borderEnabled && (
          <>
            {color("borderColor", t("borderColor"))}
            <Slider
              label={t("borderWidth")}
              value={config.borderWidth}
              min={1}
              max={8}
              step={1}
              format={(v) => `${v}px`}
              onChange={(v) => update((c) => ({ ...c, borderWidth: v }))}
            />
          </>
        )}
        <Slider
          label={t("radius")}
          value={config.borderRadius}
          min={0}
          max={40}
          step={1}
          format={(v) => `${v}px`}
          onChange={(v) => update((c) => ({ ...c, borderRadius: v }))}
        />
      </Group>

      <Group title={t("layoutGroup")}>
        <Slider
          label={t("scale")}
          value={config.scale}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => update((c) => ({ ...c, scale: v }))}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>{t("spacing")}</span>
          <Segmented
            value={config.spacing}
            onChange={(v) => update((c) => ({ ...c, spacing: v }))}
            options={[
              { value: "tight", label: t("spacingTight") },
              { value: "normal", label: t("spacingNormal") },
              { value: "relaxed", label: t("spacingRelaxed") },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>{t("align")}</span>
          <Segmented
            value={config.align}
            onChange={(v) => update((c) => ({ ...c, align: v }))}
            options={[
              { value: "left", label: t("alignLeft") },
              { value: "center", label: t("alignCenter") },
              { value: "right", label: t("alignRight") },
            ]}
          />
        </div>
        <Toggle
          label={t("animate")}
          checked={config.animations}
          onChange={(v) => update((c) => ({ ...c, animations: v }))}
        />
      </Group>

      {/* Restores the theme's own look (existing resolver); local until saved. */}
      <div className={cx("border-t border-line pt-4", confirmReset && "space-y-2")}>
        {confirmReset ? (
          <div className="flex flex-wrap items-center gap-2" role="group">
            <span className="text-xs text-warn">{t("resetThemeStyleConfirm")}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              {tc("cancel")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                update((c) => ({ ...applyThemeDefaults(c, c.theme), preset: c.preset }));
                setConfirmReset(false);
              }}
            >
              {t("resetThemeStyle")}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
            {t("resetThemeStyle")}
          </Button>
        )}
      </div>
    </div>
  );
}
