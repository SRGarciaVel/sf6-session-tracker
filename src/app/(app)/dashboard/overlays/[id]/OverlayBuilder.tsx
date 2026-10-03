"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { CopyButton } from "@/components/ui/CopyButton";
import { Badge, Button, Input, buttonClass, cx } from "@/components/ui/primitives";
import {
  OVERLAY_FIELDS,
  OVERLAY_FONTS,
  OVERLAY_PRESETS,
  OVERLAY_THEMES,
  OVERLAY_THEME_META,
  applyThemeDefaults,
  type OverlayConfig,
  type OverlayFieldId,
  type OverlayFontId,
  type OverlayPresetId,
} from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
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
    <section className="space-y-3 border-b border-line px-5 py-5 last:border-b-0">
      <h3 className="font-display text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">{title}</h3>
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
    <div className="inline-flex rounded-md border border-line-strong bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded px-3 py-1.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface-3 text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cx("absolute top-0.5 left-0 size-4 rounded-full bg-text transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
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
        className="w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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
          className="h-8 w-20 rounded border border-line-strong bg-surface-2 px-2 font-mono text-xs uppercase"
          aria-label={`${label} hex`}
          maxLength={7}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 cursor-pointer rounded border border-line-strong bg-transparent"
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
        setMessage({ tone: "ok", text: "Saved. Your OBS overlay has updated." });
      } else {
        setMessage({ tone: "error", text: res.error });
      }
    });

  const rotate = () =>
    startTransition(async () => {
      setConfirm(null);
      const res = await rotateOverlayTokenAction(overlayId);
      if (res.ok) {
        setMessage({ tone: "ok", text: "New URL generated. Update the Browser Source in OBS." });
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
            ← Dashboard
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold">Configure overlay</h1>
        </div>
        <div className="flex items-center gap-3">
          {dirty ? <Badge tone="warn">Unsaved changes</Badge> : <Badge tone="win">Saved</Badge>}
          <Button variant="ghost" onClick={() => { setConfig(saved.config); setName(saved.name); }} disabled={!dirty || pending}>
            Discard
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save & update OBS"}
          </Button>
        </div>
      </div>
      {message && (
        <p role="status" className={cx("text-sm", message.tone === "ok" ? "text-win" : "text-loss")}>
          {message.text}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Controls */}
        <div className="overflow-hidden rounded-xl border border-line bg-surface lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
          <Section title="Name">
            <Input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Overlay name" />
          </Section>

          <Section title="Theme">
            <div className="grid gap-2">
              {OVERLAY_THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setConfig((c) => applyThemeDefaults(c, t))}
                  className={cx(
                    "rounded-lg border p-3 text-left transition-colors",
                    config.theme === t ? "border-accent bg-accent/5" : "border-line-strong hover:border-faint",
                  )}
                >
                  <span className="font-display text-sm font-semibold">{OVERLAY_THEME_META[t].name}</span>
                  <span className="block text-xs text-muted">{OVERLAY_THEME_META[t].description}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Size preset">
            <Segmented<OverlayPresetId>
              value={config.preset}
              onChange={(v) => set("preset", v)}
              options={(Object.keys(OVERLAY_PRESETS) as OverlayPresetId[]).map((p) => ({ value: p, label: OVERLAY_PRESETS[p].label }))}
            />
            <p className="text-xs text-faint">
              OBS Browser Source: {preset.width} × {preset.height}. Any size works — the overlay scales to fit.
            </p>
          </Section>

          <Section title="Show">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {(Object.keys(OVERLAY_FIELDS) as OverlayFieldId[]).map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config.fields[f]}
                    onChange={(e) => setField(f, e.target.checked)}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {OVERLAY_FIELDS[f]}
                </label>
              ))}
            </div>
          </Section>

          <Section title="Text">
            <label className="block text-sm">
              <span className="mb-1.5 block">Title</span>
              <Input value={config.title} maxLength={24} onChange={(e) => set("title", e.target.value)} placeholder="SESSION" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block">Font</span>
              <select
                value={config.font}
                onChange={(e) => set("font", e.target.value as OverlayFontId)}
                className="h-10 w-full rounded-md border border-line-strong bg-surface-2 px-3 text-sm"
              >
                {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `var(--ovf-${f})` }}>
                    {OVERLAY_FONTS[f]}
                  </option>
                ))}
              </select>
            </label>
          </Section>

          <Section title="Colors">
            <ColorField label="Text" value={config.textColor} onChange={(v) => set("textColor", v)} />
            <ColorField label="Labels" value={config.mutedColor} onChange={(v) => set("mutedColor", v)} />
            <ColorField label="Accent" value={config.accentColor} onChange={(v) => set("accentColor", v)} />
            <ColorField label="Wins / positive" value={config.winColor} onChange={(v) => set("winColor", v)} />
            <ColorField label="Losses / negative" value={config.lossColor} onChange={(v) => set("lossColor", v)} />
          </Section>

          <Section title="Background">
            <ColorField label="Color" value={config.backgroundColor} onChange={(v) => set("backgroundColor", v)} />
            <Slider label="Opacity" value={config.backgroundOpacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set("backgroundOpacity", v)} />
            <Toggle label="Border" checked={config.borderEnabled} onChange={(v) => set("borderEnabled", v)} />
            {config.borderEnabled && (
              <>
                <ColorField label="Border color" value={config.borderColor} onChange={(v) => set("borderColor", v)} />
                <Slider label="Border width" value={config.borderWidth} min={1} max={8} step={1} format={(v) => `${v}px`} onChange={(v) => set("borderWidth", v)} />
              </>
            )}
            <Slider label="Corner radius" value={config.borderRadius} min={0} max={40} step={1} format={(v) => `${v}px`} onChange={(v) => set("borderRadius", v)} />
          </Section>

          <Section title="Layout">
            <Slider label="Scale" value={config.scale} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set("scale", v)} />
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Spacing</span>
              <Segmented
                value={config.spacing}
                onChange={(v) => set("spacing", v)}
                options={[
                  { value: "tight", label: "Tight" },
                  { value: "normal", label: "Normal" },
                  { value: "relaxed", label: "Relaxed" },
                ]}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Align</span>
              <Segmented
                value={config.align}
                onChange={(v) => set("align", v)}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Center" },
                  { value: "right", label: "Right" },
                ]}
              />
            </div>
            <Toggle label="Animate changes" checked={config.animations} onChange={(v) => set("animations", v)} />
          </Section>
        </div>

        {/* Preview */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <div className="rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">
                Live preview <span className="ml-2 font-mono tracking-normal text-faint normal-case">{preset.width} × {preset.height}</span>
              </h2>
              <div className="flex items-center gap-3">
                <Toggle label="Sample data" checked={useSample} onChange={setUseSample} />
                <Segmented<PreviewBg>
                  value={previewBg}
                  onChange={setPreviewBg}
                  options={[
                    { value: "gameplay", label: "Dark" },
                    { value: "light", label: "Light" },
                    { value: "checker", label: "Alpha" },
                  ]}
                />
              </div>
            </div>
            <div className="p-5">
              <div ref={ref} className="w-full">
                <div className={cx("overflow-hidden rounded-md ring-1 ring-line", PREVIEW_BG[previewBg])} style={{ width, height: previewHeight }}>
                  <OverlayView config={config} live={live} sizing={{ mode: "box", width, height: previewHeight }} />
                </div>
              </div>
              <p className="mt-3 text-xs text-faint">
                {useSample ? "Showing sample numbers." : "Showing your real session — it updates live as you play."} Unsaved changes only appear here.
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">OBS Browser Source URL</h2>
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="OBS Browser Source URL"
              className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 font-mono text-xs text-muted"
            />
            <div className="flex flex-wrap gap-2">
              <CopyButton value={url} label="Copy OBS URL" size="sm" />
              <a href={url} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                Open preview ↗
              </a>
            </div>
            <p className="text-xs text-faint">The URL never changes when you edit the design. Treat it like a password: anyone with it can view this overlay.</p>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {confirm === "rotate" ? (
                <>
                  <span className="self-center text-xs text-warn">The old URL stops working immediately.</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  <Button size="sm" variant="danger" onClick={rotate} disabled={pending}>Generate new URL</Button>
                </>
              ) : confirm === "delete" ? (
                <>
                  <span className="self-center text-xs text-warn">Delete this overlay permanently?</span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  <Button size="sm" variant="danger" onClick={remove} disabled={pending}>Delete</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>Regenerate URL</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>Delete overlay</Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
