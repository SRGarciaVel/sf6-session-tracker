"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge, Button, Input, buttonClass, cx } from "@/components/ui/primitives";
import { getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import {
  OVERLAY_FIELDS,
  OVERLAY_FONTS,
  OVERLAY_PRESETS,
  applyThemeDefaults,
  type OverlayConfig,
  type OverlayFieldId,
  type OverlayFontId,
  type OverlayPresetId,
} from "@/domain/overlay/config";
import { sampleLiveState, type SampleRank } from "@/domain/overlay/state";
import { THEME_REGISTRY, isCreatorTheme, supportedCanvas } from "@/domain/overlay/themes";
import { LOCALES, type Locale } from "@/i18n/locale";
import { getOverlayMessages } from "@/i18n/overlay-messages";
import { deleteOverlayAction, rotateOverlayTokenAction, saveOverlayAction } from "../../actions";
import { ColorField, Section, Segmented, Slider, Toggle } from "./controls";
import { CreatorCustomizationSection } from "./CreatorCustomizationSection";
import { PresetsSection, type PresetSummary } from "./PresetsSection";
import { ThemePicker } from "./ThemePicker";
import { ThemeVariantsSection } from "./ThemeVariantsSection";
import { useLiveDashboard } from "../../_components/LiveDashboard";

type PreviewBg = "gameplay" | "light" | "checker";
type PreviewZoom = "fit" | "actual";

/** Sample ranks for previewing rank-aware themes (official SF6 rank names, shown as data). */
const SAMPLE_RANKS: SampleRank[] = [
  { rank: "Iron 3", system: "lp", value: 1_450 },
  { rank: "Gold 2", system: "lp", value: 9_620 },
  { rank: "Platinum 4", system: "lp", value: 16_840 },
  { rank: "Diamond 1", system: "lp", value: 20_120 },
  { rank: "Master", system: "mr", value: 1_684 },
  { rank: "High Master", system: "mr", value: 1_712 },
  { rank: "Grand Master", system: "mr", value: 1_845 },
  { rank: "Ultimate Master", system: "mr", value: 2_030 },
];

const PREVIEW_BG: Record<PreviewBg, string> = {
  gameplay: "bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]",
  light: "bg-[linear-gradient(135deg,#d9dde6,#a7b0c2)]",
  checker: "bg-[repeating-conic-gradient(#2a2e38_0%_25%,#1c1f27_0%_50%)] bg-[length:20px_20px]",
};

/** Measures the preview container so the overlay renders at its real aspect ratio. */
function usePreviewWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Creator capabilities of the owner (booleans only; never the plan). */
export interface BuilderAccess {
  advancedCustomization: boolean;
  premiumThemes: boolean;
  creatorPresets: boolean;
}

/* ───────────────────────── Builder ───────────────────────── */

export function OverlayBuilder({
  overlayId,
  initialName,
  initialConfig,
  url,
  access,
  presets,
}: {
  overlayId: string;
  initialName: string;
  initialConfig: OverlayConfig;
  url: string;
  /** Owner entitlements, resolved on the server (display only: saving is enforced server-side). */
  access: BuilderAccess;
  presets: PresetSummary[];
}) {
  const { advancedCustomization } = access;
  const router = useRouter();
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const tDash = useTranslations("Dashboard.overlays");
  const { state } = useLiveDashboard();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState({ name: initialName, config: initialConfig });
  const [previewBg, setPreviewBg] = useState<PreviewBg>("gameplay");
  const [zoom, setZoom] = useState<PreviewZoom>("fit");
  const [sampleRank, setSampleRank] = useState(4); // Master
  const [useSample, setUseSample] = useState(state.live.session.totalGames === 0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const { ref, width } = usePreviewWidth();

  const dirty = name !== saved.name || JSON.stringify(config) !== JSON.stringify(saved.config);
  // Same rule as OBS: Creator values render only while the owner is entitled.
  const effectiveConfig = getEffectiveOverlayConfig(config, { overlays: access });
  const effectiveTheme = THEME_REGISTRY[effectiveConfig.theme];
  const preset = OVERLAY_PRESETS[effectiveConfig.preset];
  const previewWidth = zoom === "actual" ? preset.width : width;
  const previewHeight = Math.round((previewWidth * preset.height) / preset.width);
  const live = useSample ? sampleLiveState(SAMPLE_RANKS[sampleRank]) : state.live;
  // Localized default title in the OVERLAY's language (what OBS shows when the title is empty).
  const overlayStrings = getOverlayMessages(config.locale).Overlay;
  const defaultTitle =
    typeof overlayStrings === "object" && typeof overlayStrings.session === "string"
      ? overlayStrings.session
      : "";

  const set = <K extends keyof OverlayConfig>(key: K, value: OverlayConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setMessage(null);
  };
  const setField = (field: OverlayFieldId, value: boolean) =>
    setConfig((c) => ({ ...c, fields: { ...c.fields, [field]: value } }));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startTransition(async () => {
      const res = await saveOverlayAction(overlayId, { name, config });
      if (res.ok) {
        setSaved({ name, config });
        setMessage({ tone: "ok", text: t("savedMessage") });
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });

  const rotate = () =>
    startTransition(async () => {
      setConfirm(null);
      const res = await rotateOverlayTokenAction(overlayId);
      if (res.ok) {
        setMessage({ tone: "ok", text: t("rotatedMessage") });
        router.refresh();
      } else setMessage({ tone: "error", text: res.error });
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteOverlayAction(overlayId);
      if (res.ok) router.push("/dashboard");
      else setMessage({ tone: "error", text: res.error });
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-muted hover:text-text">
            {tc("backToDashboard")}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold">{t("title")}</h1>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? (
            <Badge tone="warn">{t("unsaved")}</Badge>
          ) : (
            <Badge tone="win">{t("saved")}</Badge>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setConfig(saved.config);
              setName(saved.name);
            }}
            disabled={!dirty || pending}
          >
            {t("discard")}
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty || pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>
      {message && (
        <p
          role="status"
          className={cx("text-sm", message.tone === "ok" ? "text-win" : "text-loss")}
        >
          {message.text}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Controls */}
        <div className="hud-panel lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <Section title={t("sectionName")}>
            <Input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("nameAria")}
            />
          </Section>

          <Section title={t("sectionTheme")}>
            <ThemePicker
              value={config.theme}
              locale={config.locale}
              premiumThemes={access.premiumThemes}
              onSelect={(theme) =>
                setConfig((c) => {
                  const next = applyThemeDefaults(c, theme);
                  return { ...next, preset: supportedCanvas(theme, next.preset) };
                })
              }
            />
          </Section>

          {isCreatorTheme(config.theme) && (
            <ThemeVariantsSection
              theme={config.theme}
              value={config.variants}
              enabled={access.premiumThemes}
              onChange={(variants) => set("variants", variants)}
            />
          )}

          <Section title={t("sectionSize")}>
            <Segmented<OverlayPresetId>
              value={effectiveConfig.preset}
              onChange={(v) => set("preset", v)}
              options={(Object.keys(OVERLAY_PRESETS) as OverlayPresetId[]).map((p) => ({
                value: p,
                label: t(`presets.${p}`),
                // The theme declares its canvases (registry); others can't be picked.
                disabled: !effectiveTheme.canvases.includes(p),
              }))}
            />
            {effectiveTheme.canvases.length < Object.keys(OVERLAY_PRESETS).length && (
              <p className="text-xs text-muted">
                {t("canvasLimited", {
                  theme: t(`themes.${effectiveTheme.id}.name`),
                  canvases: effectiveTheme.canvases.map((c) => t(`presets.${c}`)).join(" · "),
                })}
              </p>
            )}
            <p className="text-xs text-faint">
              {t("sizeHint", { width: preset.width, height: preset.height })}
            </p>
          </Section>

          <Section title={t("sectionShow")}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {OVERLAY_FIELDS.map((f: OverlayFieldId) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config.fields[f]}
                    onChange={(e) => setField(f, e.target.checked)}
                    className="size-4 accent-[var(--color-cyan)]"
                  />
                  {t(`fields.${f}`)}
                </label>
              ))}
            </div>
          </Section>

          <Section title={t("sectionText")}>
            <div className="space-y-1.5 text-sm">
              <span className="block">{t("overlayLanguage")}</span>
              <Segmented<Locale>
                value={config.locale}
                onChange={(v) => set("locale", v)}
                options={LOCALES.map((l) => ({ value: l, label: tc(`languageNames.${l}`) }))}
              />
              <p className="text-xs text-faint">{t("overlayLanguageHint")}</p>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block">{t("ratingCharacter")}</span>
              <select
                value={config.ratingCharacterKey ?? ""}
                onChange={(e) => set("ratingCharacterKey", e.target.value || null)}
                className="h-10 w-full border border-line-strong bg-surface-2 px-3 text-sm focus:border-cyan focus:outline-none"
                data-testid="rating-character"
              >
                <option value="">{t("ratingCharacterActive")}</option>
                {state.live.session.characters.map((c) => (
                  <option key={c.characterKey} value={c.characterKey}>
                    {c.characterName}
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              label={t("showTitle")}
              checked={config.showTitle}
              onChange={(v) => set("showTitle", v)}
            />
            <label className="block text-sm">
              <span className="mb-1.5 block">{t("titleLabel")}</span>
              <Input
                value={config.title}
                maxLength={24}
                disabled={!config.showTitle}
                onChange={(e) => set("title", e.target.value)}
                placeholder={t("titlePlaceholder", { default: defaultTitle })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block">{t("font")}</span>
              <select
                value={config.font}
                onChange={(e) => set("font", e.target.value as OverlayFontId)}
                className="h-10 w-full border border-line-strong bg-surface-2 px-3 text-sm focus:border-cyan focus:outline-none"
              >
                {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `var(--ovf-${f})` }}>
                    {OVERLAY_FONTS[f]}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title={t("sectionColors")}>
            <ColorField
              label={t("colorText")}
              value={config.textColor}
              onChange={(v) => set("textColor", v)}
            />
            <ColorField
              label={t("colorLabels")}
              value={config.mutedColor}
              onChange={(v) => set("mutedColor", v)}
            />
            <ColorField
              label={t("colorAccent")}
              value={config.accentColor}
              onChange={(v) => set("accentColor", v)}
            />
            <ColorField
              label={t("colorWin")}
              value={config.winColor}
              onChange={(v) => set("winColor", v)}
            />
            <ColorField
              label={t("colorLoss")}
              value={config.lossColor}
              onChange={(v) => set("lossColor", v)}
            />
          </Section>

          <Section title={t("sectionBackground")}>
            <ColorField
              label={t("colorBackground")}
              value={config.backgroundColor}
              onChange={(v) => set("backgroundColor", v)}
            />
            <Slider
              label={t("opacity")}
              value={config.backgroundOpacity}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => set("backgroundOpacity", v)}
            />
            <Toggle
              label={t("border")}
              checked={config.borderEnabled}
              onChange={(v) => set("borderEnabled", v)}
            />
            {config.borderEnabled && (
              <>
                <ColorField
                  label={t("borderColor")}
                  value={config.borderColor}
                  onChange={(v) => set("borderColor", v)}
                />
                <Slider
                  label={t("borderWidth")}
                  value={config.borderWidth}
                  min={1}
                  max={8}
                  step={1}
                  format={(v) => `${v}px`}
                  onChange={(v) => set("borderWidth", v)}
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
              onChange={(v) => set("borderRadius", v)}
            />
          </Section>

          <Section title={t("sectionLayout")}>
            <Slider
              label={t("scale")}
              value={config.scale}
              min={0.5}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => set("scale", v)}
            />
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{t("spacing")}</span>
              <Segmented
                value={config.spacing}
                onChange={(v) => set("spacing", v)}
                options={[
                  { value: "tight", label: t("spacingTight") },
                  { value: "normal", label: t("spacingNormal") },
                  { value: "relaxed", label: t("spacingRelaxed") },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{t("align")}</span>
              <Segmented
                value={config.align}
                onChange={(v) => set("align", v)}
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
              onChange={(v) => set("animations", v)}
            />
          </Section>

          <CreatorCustomizationSection
            theme={config.theme}
            value={config.creator}
            enabled={advancedCustomization}
            onChange={(creator) => set("creator", creator)}
          />

          <PresetsSection
            overlayId={overlayId}
            presets={presets}
            config={config}
            enabled={access.creatorPresets}
            dirty={dirty}
            onApplied={(applied) => {
              setConfig(applied);
              setSaved((prev) => ({ name: prev.name, config: applied }));
              setMessage({ tone: "ok", text: t("savedMessage") });
            }}
          />
        </div>

        {/* Preview */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <div className="hud-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h2 className="hud-heading">
                {t("previewTitle")}{" "}
                <span className="ml-2 font-mono tracking-normal text-faint normal-case">
                  {preset.width} × {preset.height}
                </span>
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                <Toggle label={t("sampleData")} checked={useSample} onChange={setUseSample} />
                {useSample && effectiveTheme.rankAware && (
                  <label className="flex items-center gap-2 text-sm">
                    <span>{t("sampleRank")}</span>
                    <select
                      value={sampleRank}
                      onChange={(e) => setSampleRank(Number(e.target.value))}
                      className="h-8 border border-line-strong bg-surface-2 px-2 text-sm focus:border-cyan focus:outline-none"
                      data-testid="sample-rank"
                    >
                      {SAMPLE_RANKS.map((r, i) => (
                        <option key={r.rank} value={i}>
                          {r.rank}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Segmented<PreviewZoom>
                  value={zoom}
                  onChange={setZoom}
                  options={[
                    { value: "fit", label: t("zoomFit") },
                    { value: "actual", label: t("zoomActual") },
                  ]}
                />
                <Segmented<PreviewBg>
                  value={previewBg}
                  onChange={setPreviewBg}
                  options={[
                    { value: "gameplay", label: t("bgDark") },
                    { value: "light", label: t("bgLight") },
                    { value: "checker", label: t("bgAlpha") },
                  ]}
                />
              </div>
            </div>
            <div className="p-5">
              <div ref={ref} className="relative w-full">
                <div className={cx("relative", zoom === "actual" && "overflow-x-auto")}>
                  {/* program-monitor corner brackets */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-1.5 -left-1.5 z-10 size-4 border-t-2 border-l-2 border-cyan"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-1.5 -bottom-1.5 z-10 size-4 border-r-2 border-b-2 border-cyan"
                  />
                  <div
                    className={cx("relative overflow-hidden", PREVIEW_BG[previewBg])}
                    style={{ width: previewWidth, height: previewHeight }}
                    data-testid="overlay-preview"
                  >
                    <OverlayView
                      config={effectiveConfig}
                      live={live}
                      sizing={{ mode: "box", width: previewWidth, height: previewHeight }}
                    />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-faint">
                {useSample ? t("previewSample") : t("previewLive")} {t("previewUnsaved")}
              </p>
            </div>
          </div>

          <div className="hud-panel space-y-3 p-5">
            <h2 className="hud-heading">{t("urlTitle")}</h2>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("urlTitle")}
              className="h-9 w-full border border-line bg-surface-0 px-3 font-mono text-xs text-muted focus:border-cyan focus:text-text focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <CopyButton value={url} label={tDash("copyUrl")} size="sm" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className={buttonClass("secondary", "sm")}
              >
                {tDash("openPreview")}
              </a>
            </div>
            <p className="text-xs text-faint">{t("urlNote")}</p>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {confirm === "rotate" ? (
                <>
                  <span className="self-center text-xs text-warn">{t("regenerateWarn")}</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    {tc("cancel")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={rotate} disabled={pending}>
                    {t("generateNew")}
                  </Button>
                </>
              ) : confirm === "delete" ? (
                <>
                  <span className="self-center text-xs text-warn">{t("deleteWarn")}</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    {tc("cancel")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={remove} disabled={pending}>
                    {t("deleteConfirm")}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>
                    {t("regenerate")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
                    {t("delete")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
