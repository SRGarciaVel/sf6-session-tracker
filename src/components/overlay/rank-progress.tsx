/**
 * Rank Progress overlay renderer (Phase 5.4B). Pure presentation of resolveRankProgressView():
 * no ladder thresholds, no progress math, no delta math here — only formatting and markup.
 * Two Free styles (Broadcast, Compact); SST shapes and text only (no official rank artwork).
 */
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { formatInteger } from "@/domain/format";
import { hexToRgba } from "@/domain/overlay/config";
import {
  RANK_PROGRESS_CANVASES,
  resolveRankProgressView,
  type RankProgressOverlayConfig,
  type RankProgressView,
} from "@/domain/overlay/rank-progress";
import type { LiveSessionState } from "@/domain/overlay/state";
import type { RatingSystemId } from "@/domain/sf6/rank-progress";
import { Animated, Delta } from "./parts";
import type { OverlaySizing } from "./OverlayView";
import "./rank-progress.css";

/** Base font-size (px) per style at its canvas size (everything inside is em-based). */
const STYLE_BASE_PX = { broadcast: 20, compact: 20 } as const;

/** Result colors of the session change (fixed HUD tokens; not a Rank Progress option). */
const HUD_POSITIVE = "#29f0a8";
const HUD_NEGATIVE = "#ff3b72";

type CssVars = CSSProperties & Record<`--${string}`, string>;

export function rankProgressStyle(
  config: RankProgressOverlayConfig,
  sizing: OverlaySizing,
  fit = 1,
): CssVars {
  const canvas = RANK_PROGRESS_CANVASES[config.style];
  const base = STYLE_BASE_PX[config.style] * fit;
  const fontSize =
    sizing.mode === "viewport"
      ? `calc(min(100vw / ${canvas.width}, 100vh / ${canvas.height}) * ${base})`
      : `${(Math.min(sizing.width / canvas.width, sizing.height / canvas.height) * base).toFixed(3)}px`;
  return {
    fontSize,
    "--ov-font": `var(--ovf-${config.font})`,
    "--ov-text": config.textColor,
    "--ov-muted": config.mutedColor,
    "--ov-accent": config.accentColor,
    "--ov-win": HUD_POSITIVE,
    "--ov-loss": HUD_NEGATIVE,
    "--ov-bg": hexToRgba(config.backgroundColor, config.backgroundOpacity),
    "--ov-border":
      config.borderEnabled && config.borderWidth > 0
        ? `${config.borderWidth / 16}em solid ${config.borderColor}`
        : "0 solid transparent",
    "--ov-radius": `${config.borderRadius / 16}em`,
    "--ov-notch": config.borderRadius === 0 ? "0.55em" : "0px",
  };
}

export function rankProgressRootClass(config: RankProgressOverlayConfig): string {
  return [
    "sf6-overlay",
    "ov-kind-rank-progress",
    "ov-align-left",
    config.animations ? "ov-animate" : "",
  ]
    .join(" ")
    .trim();
}

/** MR / LP are official game terms: not translated. */
const unit = (system: RatingSystemId) => (system === "mr" ? "MR" : "LP");

export function RankProgressPanel({
  config,
  session,
}: {
  config: RankProgressOverlayConfig;
  session: LiveSessionState;
}) {
  const view = resolveRankProgressView(session, config);
  return <RankProgressCard config={config} view={view} />;
}

function RankProgressCard({
  config,
  view,
}: {
  config: RankProgressOverlayConfig;
  view: RankProgressView;
}) {
  const t = useTranslations("RankProgress");
  const locale = config.locale;
  const { state } = view;
  const num = (n: number) => formatInteger(n, locale);
  const character =
    config.showCharacterName && view.characterName ? (
      <span className="ov-rp-char">{view.characterName}</span>
    ) : null;

  const heading =
    state.kind === "progress" || state.kind === "goal-reached"
      ? t(`goal.${state.goal}`)
      : t("title");

  const delta = view.sessionDelta ? (
    <span className="ov-rp-delta" data-testid="rp-session-delta">
      <span className="ov-rp-delta-label">{t("session")}</span>
      <Delta delta={view.sessionDelta.value} locale={locale} className="ov-delta" />
      <span className="ov-unit">{unit(view.sessionDelta.system)}</span>
    </span>
  ) : null;

  let body;
  switch (state.kind) {
    case "no-rating":
      body = (
        <div className="ov-rp-main">
          <span className="ov-rp-empty" data-testid="rp-no-rating">
            {t("noRating")}
          </span>
        </div>
      );
      break;
    case "ultimate-master":
      body = (
        <>
          <div className="ov-rp-main">
            <span className="ov-rp-rank">{state.current.label}</span>
            <span className="ov-rp-value">
              <Animated value={num(state.current.value)} />
              <span className="ov-unit">{unit(state.system)}</span>
            </span>
          </div>
          <div className="ov-rp-foot">
            <span className="ov-rp-legend" data-testid="rp-legend-requirement">
              <span className="ov-rp-legend-name">{t("legend")}</span>
              <span className="ov-rp-legend-req">{t("legendRequirement")}</span>
            </span>
            {delta}
          </div>
        </>
      );
      break;
    case "goal-reached":
      body = (
        <>
          <div className="ov-rp-main">
            <span className="ov-rp-rank">{state.current.label}</span>
            <span className="ov-rp-value">
              <Animated value={num(state.current.value)} />
              <span className="ov-unit">{unit(state.system)}</span>
            </span>
          </div>
          <div className="ov-rp-foot">
            <span className="ov-rp-target ov-accent" data-testid="rp-goal-reached">
              {t("reached")}
            </span>
            {delta}
          </div>
        </>
      );
      break;
    case "progress": {
      const u = unit(state.system);
      body = (
        <>
          <div className="ov-rp-main">
            <span className="ov-rp-rank">{state.current.label}</span>
            <span className="ov-rp-value">
              <Animated value={num(state.current.value)} />
              <span className="ov-unit">{u}</span>
            </span>
          </div>
          <div
            className="ov-rp-bar"
            role="progressbar"
            aria-valuemin={state.start.value}
            aria-valuemax={state.target.value}
            aria-valuenow={state.current.value}
            aria-label={t("progressLabel", { target: state.target.label })}
            aria-valuetext={t("progressValue", {
              current: num(state.current.value),
              target: num(state.target.value),
              unit: u,
            })}
            data-testid="rp-bar"
          >
            {/* scaleX of an already-clamped [0, 1] fraction: never a negative or >100% width. */}
            <span className="ov-rp-fill" style={{ transform: `scaleX(${state.progress})` }} />
          </div>
          <div className="ov-rp-foot">
            <span className="ov-rp-target" data-testid="rp-target">
              {config.showRemaining
                ? t("remaining", {
                    remaining: num(state.remaining),
                    unit: u,
                    target: state.target.label,
                  })
                : t("target", { target: state.target.label })}
            </span>
            {delta}
          </div>
        </>
      );
      break;
    }
  }

  return (
    <div
      className={`ov-panel ov-rp ov-rp-${config.style} ov-shadow`}
      data-rp-state={state.kind}
      data-testid="rank-progress"
    >
      <span className="ov-rp-edge" aria-hidden />
      <div className="ov-rp-head">
        <span className="ov-rp-heading">{heading}</span>
        {character}
      </div>
      {body}
    </div>
  );
}
