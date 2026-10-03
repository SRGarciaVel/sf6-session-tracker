"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge, Button, Input, buttonClass, cx } from "@/components/ui/primitives";
import {
  OVERLAY_FIELDS,
  OVERLAY_FONTS,
  OVERLAY_PRESETS,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
  type OverlayFieldId,
  type OverlayFontId,
  type OverlayPresetId,
} from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import { LOCALES, type Locale } from "@/i18n/locale";
import { getOverlayMessages } from "@/i18n/overlay-messages";
import { deleteOverlayAction, rotateOverlayTokenAction, saveOverlayAction } from "../../actions";
import { useLiveDashboard } from "../../_components/LiveDashboard";

type PreviewBg = "gameplay" | "light" | "checker";

const PREVIEW_BG: Record<PreviewBg, string> = {
  gameplay: "bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]",
  light: "bg-[linear-gradient(135deg,#d9dde6,#a7b0c2)]",
  checker: "bg-[repeating-conic-gradient(#2a2e38_0%_25%,#1c1f27_0%_50%)] bg-[length:20px_20px]",
};

/* ───────────── Small form controls (local to the builder) ───────────── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-5 py-4 last:border-b-0">
      <h3 className="hud-heading">{title}</h3>
      {children}
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex border-b border-line-strong" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative px-3 py-1.5 font-display text-sm font-semibold tracking-[0.05em] uppercase transition-colors",
            "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-cyan after:transition-transform after:duration-200",
            value === o.value
              ? "bg-cyan/8 text-text after:scale-x-100 after:shadow-[0_0_8px_var(--color-cyan)]"
              : "text-muted after:scale-x-0 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-5 w-10 border transition-colors [clip-path:polygon(4px_0,100%_0,calc(100%-4px)_100%,0_100%)]",
          checked ? "border-cyan bg-cyan/25" : "border-line-strong bg-surface-2",
        )}
      >
        <span
          className={cx(
            "absolute top-[3px] left-0 h-3 w-4 transition-transform duration-150",
            checked ? "translate-x-5 bg-cyan" : "translate-x-1 bg-muted",
          )}
        />
      </button>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 flex justify-between">
        <span>{label}</span>
        <span className="font-mono text-xs text-muted tabular">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-cyan)]"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("Builder");
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          className="h-8 w-20 border border-line-strong bg-surface-2 px-2 font-mono text-xs uppercase focus:border-cyan focus:outline-none"
          aria-label={t("hexAria", { label })}
          maxLength={7}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer border border-line-strong bg-transparent"
          aria-label={label}
        />
      </span>
    </label>
  );
}

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

/* ───────────────────────── Builder ───────────────────────── */

export function OverlayBuilder({
  overlayId,
  initialName,
  initialConfig,
  url,
}: {
  overlayId: string;
  initialName: string;
  initialConfig: OverlayConfig;
  url: string;
}) {
  const router = useRouter();
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const tDash = useTranslations("Dashboard.overlays");
  const { state } = useLiveDashboard();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState({ name: initialName, config: initialConfig });
  const [previewBg, setPreviewBg] = useState<PreviewBg>("gameplay");
  const [useSample, setUseSample] = useState(state.live.session.totalGames === 0);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "delete" | null>(null);
  const [pending, startTransition] = useTransition();
  const { ref, width } = usePreviewWidth();

  const dirty = name !== saved.name || JSON.stringify(config) !== JSON.stringify(saved.config);
  const preset = OVERLAY_PRESETS[config.preset];
  const previewHeight = Math.round((width * preset.height) / preset.width);
  const live = useSample ? sampleLiveState() : state.live;
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
            <div className="-mx-5 divide-y divide-line border-y border-line">
              {OVERLAY_THEMES.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  data-theme={theme}
                  onClick={() => setConfig((c) => applyThemeDefaults(c, theme))}
                  aria-pressed={config.theme === theme}
                  className="hud-row block w-full px-5 py-2.5 text-left"
                >
                  <span className="font-display text-lg leading-tight font-bold uppercase">
                    {t(`themes.${theme}.name`)}
                  </span>
                  <span className="block text-xs text-muted">
                    {t(`themes.${theme}.description`)}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title={t("sectionSize")}>
            <Segmented<OverlayPresetId>
              value={config.preset}
              onChange={(v) => set("preset", v)}
              options={(Object.keys(OVERLAY_PRESETS) as OverlayPresetId[]).map((p) => ({
                value: p,
                label: t(`presets.${p}`),
              }))}
            />
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
              <div className="flex items-center gap-3">
                <Toggle label={t("sampleData")} checked={useSample} onChange={setUseSample} />
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
                  style={{ width, height: previewHeight }}
                >
                  <OverlayView
                    config={config}
                    live={live}
                    sizing={{ mode: "box", width, height: previewHeight }}
                  />
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
