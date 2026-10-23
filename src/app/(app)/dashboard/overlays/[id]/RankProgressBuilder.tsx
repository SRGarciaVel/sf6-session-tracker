"use client";

/**
 * Rank Progress builder (Phase 5.4B). Simpler than the Session builder, on purpose:
 *
 *   header   name · save state · Discard · Save (same save rules / dirty rule as Session)
 *   left     Content (character, goal, language) · Display (toggles) · Appearance (style,
 *            font, colors, background, border, animations)
 *   right    live preview (real renderer, live data or an LP / MR sample) + OBS output
 *
 * Free: no Creator tab, no presets. The goal options depend on the selected character's CURRENT
 * rating system; the stored goal is never rewritten when that system changes (the renderer
 * normalizes it, domain/sf6/rank-progress.ts effectiveRankGoal).
 */
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { Button, Input, cx } from "@/components/ui/primitives";
import { OVERLAY_FONTS, type OverlayFontId } from "@/domain/overlay/config";
import {
  DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  RANK_PROGRESS_CANVASES,
  RANK_PROGRESS_STYLES,
  type RankProgressOverlayConfig,
} from "@/domain/overlay/rank-progress";
import {
  pickRatingCharacter,
  sampleLiveState,
  type PlayerLiveState,
  type SampleRank,
} from "@/domain/overlay/state";
import { goalsForSystem, type RankProgressGoal } from "@/domain/sf6/rank-progress";
import { LOCALES, type Locale } from "@/i18n/locale";
import { saveOverlayAction } from "../../actions";
import { useLiveDashboard } from "../../_components/LiveDashboard";
import { isDirty } from "./builder-state";
import { ColorField, Group, Segmented, Slider, Toggle, selectClass } from "./controls";
import { ObsOutput } from "./ObsOutput";

type SaveState = "saved" | "unsaved" | "saving" | "failed";
type Snapshot = { name: string; config: RankProgressOverlayConfig };
type RankUpdate = (fn: (c: RankProgressOverlayConfig) => RankProgressOverlayConfig) => void;

const STATUS_CLASS: Record<SaveState, string> = {
  saved: "border-win/50 text-win",
  unsaved: "border-warn/60 text-warn",
  saving: "border-line-strong text-muted",
  failed: "border-loss/60 text-loss",
};

/**
 * Preview samples (official SF6 rank names shown as data; values on the documented ladders).
 * Phase 5.4C samples carry an authoritative position and a FRESH sample cutoff (2196 MR).
 */
export const RANK_PROGRESS_SAMPLES = {
  lp: { rank: "Diamond 3", system: "lp", value: 21_950 },
  mr: { rank: "High Master", system: "mr", value: 1_642 },
  ultimate: { rank: "Ultimate Master", system: "mr", value: 2_134 },
  legendChase: { rank: "Ultimate Master", system: "mr", value: 2_189, position: 530 },
  legendBoundary: { rank: "Ultimate Master", system: "mr", value: 2_196, position: 505 },
  legend: { rank: "Legend", system: "mr", value: 2_241, position: 327 },
} as const satisfies Record<string, SampleRank & { position?: number }>;
type PreviewSource = "live" | keyof typeof RANK_PROGRESS_SAMPLES;
const SAMPLE_CUTOFF_MR = 2_196;

/** Preview-only live state for a sample (cutoff observed "now" so it is fresh). */
export function rankProgressSampleState(source: Exclude<PreviewSource, "live">): PlayerLiveState {
  const sample = RANK_PROGRESS_SAMPLES[source];
  const base = sampleLiveState(sample);
  if (!("position" in sample)) return base;
  const now = new Date().toISOString();
  return {
    ...base,
    generatedAt: now,
    legendCutoff: {
      cutoffMr: SAMPLE_CUTOFF_MR,
      observedAt: now,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
    },
    session: {
      ...base.session,
      characters: base.session.characters.map((c) => ({
        ...c,
        leaderboardPosition: sample.position,
      })),
    },
  };
}
type PreviewBg = "checker" | "dark" | "light";

const PREVIEW_BG: Record<PreviewBg, string> = {
  dark: "bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]",
  light: "bg-[linear-gradient(135deg,#d9dde6,#a7b0c2)]",
  checker: "bg-[repeating-conic-gradient(#2a2e38_0%_25%,#1c1f27_0%_50%)] bg-[length:20px_20px]",
};

export function RankProgressOverlayBuilder({
  overlayId,
  initialName,
  initialConfig,
  url,
}: {
  overlayId: string;
  initialName: string;
  initialConfig: RankProgressOverlayConfig;
  url: string;
}) {
  const router = useRouter();
  const t = useTranslations("Builder");
  const tc = useTranslations("Common");
  const { state } = useLiveDashboard();

  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState<Snapshot>({ name: initialName, config: initialConfig });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [saving, startSave] = useTransition();

  const dirty = isDirty(saved, { name, config });
  const saveState: SaveState = saving
    ? "saving"
    : saveError
      ? "failed"
      : dirty
        ? "unsaved"
        : "saved";

  const update: RankUpdate = (fn) => {
    setConfig((c) => fn(c));
    setSaveError(null);
    setNotice(null);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startSave(async () => {
      const snapshot = { name, config };
      const res = await saveOverlayAction(overlayId, snapshot).catch(() => ({
        ok: false as const,
        error: t("saveNetworkError"),
      }));
      if (res.ok) {
        setSaved(snapshot);
        setSaveError(null);
        setNotice({ tone: "ok", text: t("savedMessage") });
      } else {
        setSaveError(res.error);
      }
    });

  const discard = () => {
    setConfig(saved.config);
    setName(saved.name);
    setSaveError(null);
  };

  const saveButton = (testId: string) => (
    <Button variant="primary" onClick={save} disabled={!dirty || saving} data-testid={testId}>
      {saving ? t("saving") : t("save")}
    </Button>
  );

  const canvas = RANK_PROGRESS_CANVASES[config.style];

  return (
    <div className="space-y-4 pb-20 lg:pb-0" data-testid="rank-progress-builder">
      <header className="z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:sticky lg:top-[3.625rem]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href="/dashboard"
              onClick={(e) => {
                if (!dirty) return;
                e.preventDefault();
                setLeaving(true);
              }}
              className="sst-link sst-link--quiet text-sm"
            >
              <Icon name="arrow-left" className="sst-link-icon" />
              <span>{tc("backToDashboard")}</span>
            </Link>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="font-display text-xl font-bold sm:text-2xl">{t("title")}</h1>
              <span className="hud-tag whitespace-nowrap" data-testid="overlay-kind-tag">
                {t("rankProgress.kindName")}
              </span>
              <Input
                value={name}
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaveError(null);
                }}
                aria-label={t("nameAria")}
                className="h-8 w-full max-w-64 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              data-testid="save-state"
              data-state={saveState}
              className={cx(
                "border px-2 py-1 font-display text-[0.7rem] font-semibold tracking-[0.12em] whitespace-nowrap uppercase",
                STATUS_CLASS[saveState],
              )}
            >
              {saveState === "saved" ? `✓ ${t("status.saved")}` : t(`status.${saveState}`)}
            </span>
            <Button variant="ghost" onClick={discard} disabled={!dirty || saving}>
              {t("discard")}
            </Button>
            <span className="hidden lg:inline-flex">{saveButton("save-button")}</span>
          </div>
        </div>
        {saveError && (
          <p role="alert" className="mt-2 text-sm text-loss">
            {t("saveFailed", { reason: saveError })}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className={cx("mt-2 text-sm", notice.tone === "ok" ? "text-win" : "text-loss")}
          >
            {notice.text}
          </p>
        )}
        {leaving && (
          <div
            role="alertdialog"
            aria-labelledby="leave-title"
            className="mt-2 flex flex-wrap items-center gap-2"
          >
            <span id="leave-title" className="text-sm text-warn">
              {t("leaveWarning")}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLeaving(false)} autoFocus>
              {t("leaveStay")}
            </Button>
            <Button size="sm" variant="danger" onClick={() => router.push("/dashboard")}>
              {t("leaveDiscard")}
            </Button>
          </div>
        )}
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div
          className="min-w-0 space-y-4 lg:sticky lg:top-[9.5rem] lg:order-2"
          data-testid="preview-column"
        >
          <RankProgressPreview config={config} liveState={state.live} />
          <ObsOutput overlayId={overlayId} url={url} canvas={canvas} onMessage={setNotice} />
        </div>

        <div
          className="hud-panel min-w-0 space-y-6 px-4 py-5 sm:px-5 lg:order-1"
          data-testid="editor"
        >
          <ContentSection
            config={config}
            update={update}
            liveState={state.live}
            characters={state.live.session.characters}
          />
          <DisplaySection config={config} update={update} />
          <AppearanceSection config={config} update={update} />
        </div>
      </div>

      {(dirty || saveState === "failed") && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line-strong bg-bg/95 px-4 py-3 backdrop-blur-sm lg:hidden"
          data-testid="mobile-save-bar"
        >
          <span className="text-sm text-warn">{t(`status.${saveState}`)}</span>
          {saveButton("save-button-mobile")}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Content ───────────────────────── */

function ContentSection({
  config,
  update,
  liveState,
  characters,
}: {
  config: RankProgressOverlayConfig;
  update: RankUpdate;
  liveState: PlayerLiveState;
  characters: ReadonlyArray<{ characterKey: string; characterName: string }>;
}) {
  const t = useTranslations("Builder");
  const tr = useTranslations("Builder.rankProgress");
  const tc = useTranslations("Common");
  // The goal options follow the selected character's CURRENT system (LP default when unknown).
  const selected = pickRatingCharacter(liveState.session, config.characterKey);
  const system = selected?.current?.system ?? selected?.ratingSystem ?? "lp";
  const goals = goalsForSystem(system);
  const normalized = !goals.includes(config.goal);
  return (
    <section className="space-y-5" aria-labelledby="rp-content">
      <h2 id="rp-content" className="hud-heading">
        {tr("sections.content")}
      </h2>
      <label className="block text-sm">
        <span className="mb-1.5 block">{tr("character")}</span>
        <select
          value={config.characterKey ?? ""}
          onChange={(e) => {
            const key = e.target.value || null;
            update((c) => ({ ...c, characterKey: key }));
          }}
          className={selectClass}
          data-testid="rp-character"
          aria-describedby="rp-character-hint"
        >
          <option value="">{tr("characterAuto")}</option>
          {characters.map((c) => (
            <option key={c.characterKey} value={c.characterKey}>
              {c.characterName}
            </option>
          ))}
        </select>
        <span id="rp-character-hint" className="mt-1 block text-xs text-faint">
          {tr("characterHint")}
        </span>
      </label>

      <div className="space-y-1.5 text-sm" data-testid="rp-goal" data-system={system}>
        <span className="block">{tr("goal")}</span>
        <Segmented<RankProgressGoal>
          value={normalized ? "auto" : config.goal}
          onChange={(goal) => update((c) => ({ ...c, goal }))}
          options={goals.map((g) => ({
            value: g,
            label: g === "master" ? tr("goals.master") : tr(`goals.auto.${system}`),
          }))}
        />
        <p className="text-xs text-faint">
          {normalized ? tr("goalNormalized") : tr(`goalHint.${system}`)}
        </p>
      </div>

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
    </section>
  );
}

/* ───────────────────────── Display ───────────────────────── */

function DisplaySection({
  config,
  update,
}: {
  config: RankProgressOverlayConfig;
  update: RankUpdate;
}) {
  const tr = useTranslations("Builder.rankProgress");
  return (
    <section className="space-y-3 border-t border-line pt-5" aria-labelledby="rp-display">
      <h2 id="rp-display" className="hud-heading">
        {tr("sections.display")}
      </h2>
      <Toggle
        label={tr("showCharacterName")}
        checked={config.showCharacterName}
        onChange={(v) => update((c) => ({ ...c, showCharacterName: v }))}
      />
      <Toggle
        label={tr("showRemaining")}
        checked={config.showRemaining}
        onChange={(v) => update((c) => ({ ...c, showRemaining: v }))}
      />
      <Toggle
        label={tr("showSessionDelta")}
        checked={config.showSessionDelta}
        onChange={(v) => update((c) => ({ ...c, showSessionDelta: v }))}
      />
      <p className="text-xs text-faint">{tr("sessionDeltaHint")}</p>
    </section>
  );
}

/* ───────────────────────── Appearance ───────────────────────── */

type ColorKey = "textColor" | "mutedColor" | "accentColor" | "backgroundColor" | "borderColor";

function AppearanceSection({
  config,
  update,
}: {
  config: RankProgressOverlayConfig;
  update: RankUpdate;
}) {
  const t = useTranslations("Builder");
  const tr = useTranslations("Builder.rankProgress");
  const color = (key: ColorKey, label: string) => (
    <ColorField
      label={label}
      value={config[key]}
      resetTo={DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG[key]}
      onChange={(v) => update((c) => ({ ...c, [key]: v }))}
    />
  );
  return (
    <section className="space-y-5 border-t border-line pt-5" aria-labelledby="rp-appearance">
      <h2 id="rp-appearance" className="hud-heading">
        {tr("sections.appearance")}
      </h2>
      <div className="space-y-2 text-sm">
        <span className="block">{tr("style")}</span>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tr("style")}>
          {RANK_PROGRESS_STYLES.map((style) => {
            const canvas = RANK_PROGRESS_CANVASES[style];
            const active = config.style === style;
            return (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update((c) => ({ ...c, style }))}
                data-testid={`rp-style-${style}`}
                className={cx(
                  "border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-cyan",
                  active
                    ? "border-cyan bg-cyan/8"
                    : "border-line-strong hover:border-line-strong/80",
                )}
              >
                <span className="block font-display text-sm font-semibold tracking-[0.05em] uppercase">
                  {tr(`styles.${style}.name`)}
                </span>
                <span className="block text-xs text-muted">
                  {tr(`styles.${style}.description`)}
                </span>
                <span className="mt-1 block font-mono text-xs text-faint">
                  {`${canvas.width}×${canvas.height}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

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
            data-testid="rp-font"
          >
            {(Object.keys(OVERLAY_FONTS) as OverlayFontId[]).map((f) => (
              <option key={f} value={f} style={{ fontFamily: `var(--ovf-${f})` }}>
                {OVERLAY_FONTS[f]}
              </option>
            ))}
          </select>
        </label>
      </Group>

      <Group title={t("colorsCore")}>
        {color("textColor", t("colorText"))}
        {color("mutedColor", t("colorLabels"))}
        {color("accentColor", t("colorAccent"))}
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

      <Toggle
        label={t("animate")}
        checked={config.animations}
        onChange={(v) => update((c) => ({ ...c, animations: v }))}
      />
    </section>
  );
}

/* ───────────────────────── Preview ───────────────────────── */

function usePaneWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Live data has a rating to show for this config (else the preview starts on a sample). */
function hasLiveRating(live: PlayerLiveState, config: RankProgressOverlayConfig): boolean {
  return pickRatingCharacter(live.session, config.characterKey)?.current != null;
}

/** Preview only (never saved, never sent): live data or an LP / MR sample. */
function RankProgressPreview({
  config,
  liveState,
}: {
  config: RankProgressOverlayConfig;
  liveState: PlayerLiveState;
}) {
  const t = useTranslations("Builder");
  const tr = useTranslations("Builder.rankProgress");
  const [source, setSource] = useState<PreviewSource>(() =>
    hasLiveRating(liveState, config) ? "live" : "lp",
  );
  const [bg, setBg] = useState<PreviewBg>("dark");
  const { ref, width } = usePaneWidth();
  const canvas = RANK_PROGRESS_CANVASES[config.style];
  // Never upscale past the real canvas: the preview shows the OBS size or smaller.
  const scale = Math.min(1, width / canvas.width);
  const boxWidth = Math.round(canvas.width * scale);
  const boxHeight = Math.round(canvas.height * scale);
  const live = source === "live" ? liveState : rankProgressSampleState(source);

  return (
    <section aria-labelledby="preview-title" className="hud-panel" data-testid="preview-pane">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 id="preview-title" className="hud-heading mr-auto">
          {t("previewTitle")}
        </h2>
        <Segmented<PreviewBg>
          value={bg}
          onChange={setBg}
          options={[
            { value: "checker", label: t("bgAlpha") },
            { value: "dark", label: t("bgDark") },
            { value: "light", label: t("bgLight") },
          ]}
        />
      </div>
      <div className="p-4">
        <div ref={ref} className="w-full">
          <div
            className={cx("relative mx-auto overflow-hidden", PREVIEW_BG[bg])}
            style={{ width: boxWidth, height: boxHeight }}
            data-testid="overlay-preview"
          >
            <OverlayView
              config={config}
              live={live}
              sizing={{ mode: "box", width: boxWidth, height: boxHeight }}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          {t("canvasHint", { width: canvas.width, height: canvas.height })}
        </p>
        <label className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <span>{tr("previewData")}</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as PreviewSource)}
            className="h-8 border border-line-strong bg-surface-2 px-2 text-sm focus:border-cyan focus:outline-none"
            data-testid="rp-preview-source"
          >
            <option value="live">{tr("samples.live")}</option>
            <option value="lp">{tr("samples.lp")}</option>
            <option value="mr">{tr("samples.mr")}</option>
            <option value="ultimate">{tr("samples.ultimate")}</option>
            <option value="legendChase">{tr("samples.legendChase")}</option>
            <option value="legendBoundary">{tr("samples.legendBoundary")}</option>
            <option value="legend">{tr("samples.legend")}</option>
          </select>
        </label>
      </div>
    </section>
  );
}
