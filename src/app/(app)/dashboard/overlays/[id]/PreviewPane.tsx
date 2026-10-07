"use client";

/**
 * Live preview (Phase 4.9): the real overlay renderer fed with the EFFECTIVE config (what OBS
 * will show for this owner) and either sample or live session data.
 *
 * Preview-only state — zoom, background, sample data, sample rank — lives here and never
 * touches the overlay config. The canvas selector is the one saved setting in the toolbar
 * (it is the OBS Browser Source size), so it's labelled as such.
 */
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { OverlayView } from "@/components/overlay/OverlayView";
import { usePrefersReducedMotion } from "@/components/overlay/motion";
import { Button, cx } from "@/components/ui/primitives";
import { OVERLAY_PRESETS, type OverlayConfig, type OverlayPresetId } from "@/domain/overlay/config";
import {
  SAMPLE_CHARACTER_KEYS,
  sampleMultiCharacterState,
  type SampleCharacterKey,
} from "@/domain/overlay/sample-session";
import type { PlayerLiveState, SampleRank } from "@/domain/overlay/state";
import {
  SIMULATION_LEAD_MS,
  simulationState,
  type SimulatedResult,
  type SimulationPhase,
} from "@/domain/overlay/preview-simulation";
import { THEME_REGISTRY } from "@/domain/overlay/themes";
import { ZOOM_STEPS, stepZoom, type PreviewZoom } from "./builder-state";
import { Segmented, Toggle } from "./controls";

type PreviewBg = "checker" | "dark" | "light";

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

/** Names and records for the sample-character picker (computed once from the engine sample). */
const SAMPLE_CHARACTERS = (() => {
  const session = sampleMultiCharacterState().session;
  return SAMPLE_CHARACTER_KEYS.map(
    (k) => session.characters.find((c) => c.characterKey === k) ?? null,
  ).filter((c) => c !== null);
})();

const PREVIEW_BG: Record<PreviewBg, string> = {
  dark: "bg-[radial-gradient(ellipse_at_30%_20%,#3b2a4d_0%,#141824_45%,#0a0b0e_100%)]",
  light: "bg-[linear-gradient(135deg,#d9dde6,#a7b0c2)]",
  checker: "bg-[repeating-conic-gradient(#2a2e38_0%_25%,#1c1f27_0%_50%)] bg-[length:20px_20px]",
};

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

export function PreviewPane({
  config,
  liveState,
  onCanvasChange,
}: {
  /** EFFECTIVE config (owner entitlements applied) — exactly what OBS renders. */
  config: OverlayConfig;
  liveState: PlayerLiveState;
  onCanvasChange: (canvas: OverlayPresetId) => void;
}) {
  const t = useTranslations("Builder");
  const [bg, setBg] = useState<PreviewBg>("dark");
  const [zoom, setZoom] = useState<PreviewZoom>(null);
  const [useSample, setUseSample] = useState(liveState.session.totalGames === 0);
  const [sampleRank, setSampleRank] = useState(4); // Master
  // Preview-only: which sample character is "active" (multi-character sample, Phase 5.1).
  const [sampleCharacter, setSampleCharacter] = useState<SampleCharacterKey>("ryu");
  // "Play update": local before → after simulation (never touches config, session or API).
  const [simResult, setSimResult] = useState<SimulatedResult>("win");
  const [sim, setSim] = useState<{
    result: SimulatedResult;
    phase: SimulationPhase;
    run: number;
  } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const { ref, width } = usePaneWidth();

  useEffect(() => {
    if (!sim || sim.phase !== "before") return;
    const id = setTimeout(
      () => setSim((s) => (s && s.run === sim.run ? { ...s, phase: "after" } : s)),
      SIMULATION_LEAD_MS,
    );
    return () => clearTimeout(id);
  }, [sim]);

  const play = () =>
    setSim((s) => ({
      result: simResult,
      // Reduced motion: jump straight to the final values.
      phase: reducedMotion ? "after" : "before",
      run: (s?.run ?? 0) + 1,
    }));

  const theme = THEME_REGISTRY[config.theme];
  const sampleCharacters = SAMPLE_CHARACTERS;
  const canvas = OVERLAY_PRESETS[config.preset];
  const fitScale = width / canvas.width;
  const scale = zoom ?? fitScale;
  const boxWidth = Math.round(canvas.width * scale);
  const boxHeight = Math.round(canvas.height * scale);
  const live = sim
    ? simulationState(sim.result, sim.phase)
    : useSample
      ? sampleMultiCharacterState(
          sampleCharacter,
          theme.rankAware ? SAMPLE_RANKS[sampleRank] : undefined,
        )
      : liveState;

  return (
    <section aria-labelledby="preview-title" className="hud-panel" data-testid="preview-pane">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
        <h2 id="preview-title" className="hud-heading mr-auto">
          {t("previewTitle")}
        </h2>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <span>{t("canvas")}</span>
          <select
            value={config.preset}
            onChange={(e) => onCanvasChange(e.target.value as OverlayPresetId)}
            className="h-8 border border-line-strong bg-surface-2 px-2 font-mono text-xs text-text focus:border-cyan focus:outline-none"
            aria-describedby="canvas-hint"
            data-testid="canvas-select"
          >
            {(Object.keys(OVERLAY_PRESETS) as OverlayPresetId[]).map((p) => (
              // The theme declares its canvases (registry); others can't be picked.
              <option key={p} value={p} disabled={!theme.canvases.includes(p)}>
                {`${t(`presets.${p}`)} · ${OVERLAY_PRESETS[p].width}×${OVERLAY_PRESETS[p].height}`}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center" role="group" aria-label={t("zoom")}>
          <button
            type="button"
            onClick={() => setZoom((z) => stepZoom(z, fitScale, -1))}
            disabled={scale <= ZOOM_STEPS[0] + 0.001}
            aria-label={t("zoomOut")}
            className="grid size-8 place-items-center border border-line-strong text-muted hover:text-text focus-visible:border-cyan focus-visible:outline-none disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(null)}
            aria-pressed={zoom === null}
            title={t("zoomFit")}
            className={cx(
              "h-8 min-w-14 border-y border-line-strong px-2 font-mono text-xs focus-visible:border-cyan focus-visible:outline-none",
              zoom === null ? "text-cyan" : "text-text",
            )}
            data-testid="zoom-value"
          >
            {zoom === null ? t("zoomFit") : `${Math.round(scale * 100)}%`}
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => stepZoom(z, fitScale, 1))}
            disabled={scale >= (ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1.5) - 0.001}
            aria-label={t("zoomIn")}
            className="grid size-8 place-items-center border border-line-strong text-muted hover:text-text focus-visible:border-cyan focus-visible:outline-none disabled:opacity-40"
          >
            +
          </button>
        </div>
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
          <div className={cx("relative", zoom !== null && "overflow-auto")}>
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
        </div>
        <p id="canvas-hint" className="mt-2 text-xs text-faint">
          {t("canvasHint", { width: canvas.width, height: canvas.height })}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
          <Toggle
            label={t("sampleData")}
            checked={useSample}
            onChange={(v) => {
              setUseSample(v);
              setSim(null);
            }}
          />
          {useSample && !sim && (
            <label className="flex items-center gap-2 text-sm">
              <span>{t("sampleCharacter")}</span>
              <select
                value={sampleCharacter}
                onChange={(e) => setSampleCharacter(e.target.value as SampleCharacterKey)}
                className="h-8 border border-line-strong bg-surface-2 px-2 text-sm focus:border-cyan focus:outline-none"
                data-testid="sample-character"
              >
                {sampleCharacters.map((c) => (
                  <option key={c.characterKey} value={c.characterKey}>
                    {`${c.characterName} · ${c.wins}-${c.losses}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {useSample && !sim && theme.rankAware && (
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
          <span className="text-xs text-faint">
            {sim ? t("simulation.active") : useSample ? t("previewSample") : t("previewLive")}
          </span>
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"
          role="group"
          aria-label={t("simulation.label")}
          data-testid="preview-simulation"
        >
          <Segmented<SimulatedResult>
            value={simResult}
            onChange={setSimResult}
            options={[
              { value: "win", label: t("simulation.win") },
              { value: "loss", label: t("simulation.loss") },
            ]}
          />
          <Button size="sm" variant="secondary" onClick={play} data-testid="play-update">
            {`▶ ${t("simulation.play")}`}
          </Button>
          {sim && (
            <Button size="sm" variant="ghost" onClick={() => setSim(null)}>
              {t("simulation.exit")}
            </Button>
          )}
          <span className="text-xs text-faint" aria-live="polite" data-testid="simulation-status">
            {sim?.phase === "after" ? t(`simulation.done.${sim.result}`) : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
