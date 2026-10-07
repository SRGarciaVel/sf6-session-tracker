"use client";

/**
 * Pure overlay renderer: (config, live state) → markup. Shared by the OBS Browser Source and the
 * dashboard preview. No data fetching, no stats math — values come pre-computed from the server.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { OVERLAY_PRESETS, hexToRgba, type OverlayConfig } from "@/domain/overlay/config";
import { creatorClassNames, creatorCssVars } from "./creator-style";
import { getOverlayMessages } from "@/i18n/overlay-messages";
import {
  pickRatingCharacter,
  resolveOverlayStats,
  type OverlayStats,
  type PlayerLiveState,
} from "@/domain/overlay/state";
import { motionProfile, type OverlaySummary } from "@/domain/overlay/motion";
import { MotionFx, MotionProvider, useOverlayUpdate, usePrefersReducedMotion } from "./motion";
import { formatWinRate } from "@/domain/format";
import { BroadcastTheme, PrestigeTheme, RankCardTheme } from "./creator-themes";
import {
  Animated,
  Cell,
  Delta,
  Ratio,
  RecentForm,
  joinWith,
  ratingParts,
  type ThemeProps,
} from "./parts";
import "./overlay.css";

/** Base font-size (px) per preset at 1× scale, chosen to fill the preset canvas. */
const PRESET_BASE_PX = { compact: 22, standard: 24, detailed: 24 } as const;
const GAP = { tight: "0.55em", normal: "0.95em", relaxed: "1.5em" } as const;

export type OverlaySizing =
  /** OBS: fill the viewport; font scales with the Browser Source width/height. */
  | { mode: "viewport" }
  /** Preview: explicit box in CSS px. */
  | { mode: "box"; width: number; height: number };

type CssVars = CSSProperties & Record<`--${string}`, string>;

export function overlayStyle(config: OverlayConfig, sizing: OverlaySizing, fit = 1): CssVars {
  const preset = OVERLAY_PRESETS[config.preset];
  const base = PRESET_BASE_PX[config.preset] * config.scale * fit;
  const fontSize =
    sizing.mode === "viewport"
      ? `calc(min(100vw / ${preset.width}, 100vh / ${preset.height}) * ${base})`
      : `${(Math.min(sizing.width / preset.width, sizing.height / preset.height) * base).toFixed(3)}px`;

  return {
    fontSize,
    "--ov-font": `var(--ovf-${config.font})`,
    "--ov-text": config.textColor,
    "--ov-muted": config.mutedColor,
    "--ov-accent": config.accentColor,
    "--ov-win": config.winColor,
    "--ov-loss": config.lossColor,
    "--ov-bg": hexToRgba(config.backgroundColor, config.backgroundOpacity),
    "--ov-border":
      config.borderEnabled && config.borderWidth > 0
        ? `${config.borderWidth / 16}em solid ${config.borderColor}`
        : "0 solid transparent",
    "--ov-radius": `${config.borderRadius / 16}em`,
    // HUD notch when the streamer keeps square corners; real radius otherwise.
    "--ov-notch": config.borderRadius === 0 ? "0.55em" : "0px",
    "--ov-gap": GAP[config.spacing],
  };
}

/* ─────────────── Minimal — broadcast lower-third ─────────────── */

function MinimalTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const locale = config.locale;
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);
  const items: Array<{ key: string; node: ReactNode }> = [];

  if (f.wins || f.losses) {
    items.push({
      key: "wl",
      node: (
        <span className="ov-min-wl">
          {f.wins && (
            <>
              <Animated value={s.wins} className="ov-win" flash="win" />
              <span className="ov-unit">{t("unitWin")}</span>
            </>
          )}
          {f.wins && f.losses && " "}
          {f.losses && (
            <>
              <Animated value={s.losses} className="ov-loss" flash="loss" />
              <span className="ov-unit">{t("unitLoss")}</span>
            </>
          )}
        </span>
      ),
    });
  }
  if (f.winRate)
    items.push({ key: "wr", node: <Animated value={formatWinRate(s.winRate, locale)} /> });
  if (f.totalGames)
    items.push({
      key: "tg",
      node: (
        <span>
          <Animated value={s.totalGames} />
          <span className="ov-unit"> {t("unitGames")}</span>
        </span>
      ),
    });
  if (f.rank)
    items.push({ key: "rank", node: <span className="ov-accent ov-upper">{r.rank}</span> });
  if (f.rating || f.ratingDelta) {
    items.push({
      key: "rating",
      node: (
        <span className="ov-delta">
          <span className="ov-unit ov-upper ov-char">{r.character}</span>
          {f.rating && (
            <>
              <Animated value={r.value} />
              <span className="ov-unit">{r.label}</span>
            </>
          )}
          {f.ratingDelta && <Delta delta={r.delta} locale={locale} className="ov-delta" />}
        </span>
      ),
    });
  }
  if (f.winStreak && s.currentWinStreak >= 2) {
    items.push({
      key: "streak",
      node: (
        <span className="ov-accent ov-upper">
          {t.rich("minimalStreak", { n: () => <Animated value={s.currentWinStreak} /> })}
        </span>
      ),
    });
  }
  if (f.bestStreak)
    items.push({
      key: "best",
      node: (
        <span className="ov-upper ov-muted">
          {t.rich("minimalBest", { n: () => <Animated value={s.bestWinStreak} /> })}
        </span>
      ),
    });
  if (f.recentForm)
    items.push({ key: "form", node: <RecentForm results={s.recentResults} max={5} /> });

  return (
    <div className="ov-panel ov-minimal ov-shadow">
      <MotionFx />
      <span className="ov-min-bar" aria-hidden />
      <span className="ov-min-items">
        {joinWith(items, (k) => (
          <span className="ov-min-sep" aria-hidden key={`sep-${k}`} />
        ))}
      </span>
    </div>
  );
}

/* ─────────────── Competitive — scoreboard ─────────────── */

function CompetitiveTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const locale = config.locale;
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);
  const groups: Array<{ key: string; node: ReactNode }> = [];

  if (f.wins || f.losses) {
    groups.push({
      key: "score",
      node: (
        <div className="ov-comp-score">
          {f.wins && (
            <Cell label={t("wins")}>
              <span className="ov-big">
                <Animated value={s.wins} className="ov-win" flash="win" />
              </span>
            </Cell>
          )}
          {f.wins && f.losses && <span className="ov-comp-vs">/</span>}
          {f.losses && (
            <Cell label={t("losses")}>
              <span className="ov-big">
                <Animated value={s.losses} className="ov-loss" flash="loss" />
              </span>
            </Cell>
          )}
        </div>
      ),
    });
  }
  if (f.winRate)
    groups.push({
      key: "wr",
      node: (
        <Cell label={t("winRate")}>
          <span className="ov-mid">
            <Animated value={formatWinRate(s.winRate, locale)} />
          </span>
          <Ratio wins={s.wins} losses={s.losses} />
        </Cell>
      ),
    });
  if (f.totalGames)
    groups.push({
      key: "tg",
      node: (
        <Cell label={t("games")}>
          <span className="ov-mid">
            <Animated value={s.totalGames} />
          </span>
        </Cell>
      ),
    });
  if (f.rating || f.ratingDelta)
    groups.push({
      key: "rating",
      node: (
        <Cell label={r.character} labelClassName="ov-char">
          <span className="ov-mid">
            {f.rating && (
              <>
                <Animated value={r.value} />
                <span className="ov-unit">{r.label}</span>
              </>
            )}
            {f.ratingDelta && <Delta delta={r.delta} locale={locale} className="ov-delta" />}
          </span>
        </Cell>
      ),
    });
  if (f.winStreak)
    groups.push({
      key: "ws",
      node: (
        <Cell label={t("streak")}>
          <span className={`ov-mid ${s.currentWinStreak >= 3 ? "ov-accent" : ""}`}>
            <Animated value={s.currentWinStreak} />
          </span>
        </Cell>
      ),
    });
  if (f.bestStreak)
    groups.push({
      key: "bs",
      node: (
        <Cell label={t("best")}>
          <span className="ov-mid">
            <Animated value={s.bestWinStreak} />
          </span>
        </Cell>
      ),
    });

  const showTop = config.showTitle || f.rank;
  return (
    <div className="ov-panel ov-comp ov-shadow">
      <MotionFx />
      {showTop && (
        <div className="ov-comp-top">
          {config.showTitle && <span className="ov-comp-tag">{config.title || t("session")}</span>}
          <span className="ov-comp-rule" aria-hidden />
          {f.rank && <span className="ov-comp-rank">{r.rank}</span>}
        </div>
      )}
      <div className="ov-comp-main">
        {joinWith(groups, (k) => (
          <span className="ov-div" aria-hidden key={`div-${k}`} />
        ))}
      </div>
      {f.recentForm && <RecentForm results={s.recentResults} max={10} />}
    </div>
  );
}

/* ─────────────── Street — expressive fighting-game HUD ─────────────── */

function FighterTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const locale = config.locale;
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, config);
  const showScore = f.wins || f.losses;

  return (
    <div className="ov-street ov-shadow">
      <MotionFx />
      <span className="ov-st-slash" aria-hidden />
      {(showScore || f.winRate || f.totalGames) && (
        <div className="ov-st-block ov-st-main">
          <div className="ov-st-inner">
            {showScore && (
              <div className="ov-st-col">
                {config.showTitle && (
                  <span className="ov-st-label ov-st-title">{config.title || t("session")}</span>
                )}
                <span className="ov-st-big">
                  {f.wins && <Animated value={s.wins} className="ov-win" flash="win" />}
                  {f.wins && f.losses && <span className="ov-st-dash">-</span>}
                  {f.losses && <Animated value={s.losses} className="ov-loss" flash="loss" />}
                </span>
              </div>
            )}
            {f.winRate && (
              <div className="ov-st-col">
                <span className="ov-st-label">{t("winRate")}</span>
                <span className="ov-st-mid">
                  <Animated value={formatWinRate(s.winRate, locale)} />
                </span>
                <Ratio wins={s.wins} losses={s.losses} />
              </div>
            )}
            {f.totalGames && (
              <div className="ov-st-col">
                <span className="ov-st-label">{t("games")}</span>
                <span className="ov-st-mid">
                  <Animated value={s.totalGames} />
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {(f.rating || f.ratingDelta || f.rank) && (
        <div className="ov-st-block">
          <div className="ov-st-inner">
            <div className="ov-st-col">
              <span className="ov-st-label">
                <span className="ov-char">
                  {r.character}
                  {f.rank ? " · " : ""}
                </span>
                {f.rank ? r.rank : null}
              </span>
              <span className="ov-st-mid">
                {f.rating && (
                  <>
                    <Animated value={r.value} /> <span className="ov-muted">{r.label}</span>
                  </>
                )}
                {f.ratingDelta && <Delta delta={r.delta} locale={locale} className="ov-st-badge" />}
              </span>
            </div>
          </div>
        </div>
      )}
      {f.winStreak && s.currentWinStreak >= 2 && (
        <div className="ov-st-block ov-st-hot">
          <div className="ov-st-inner">
            <div className="ov-st-col">
              <span className="ov-st-label">{t("winStreak")}</span>
              <span className="ov-st-mid">
                <Animated value={s.currentWinStreak} />
              </span>
            </div>
          </div>
        </div>
      )}
      {f.bestStreak && (
        <div className="ov-st-block">
          <div className="ov-st-inner">
            <div className="ov-st-col">
              <span className="ov-st-label">{t("best")}</span>
              <span className="ov-st-mid">
                <Animated value={s.bestWinStreak} />
              </span>
            </div>
          </div>
        </div>
      )}
      {f.recentForm && s.recentResults.length > 0 && (
        <div className="ov-st-block">
          <div className="ov-st-inner">
            <RecentForm results={s.recentResults} max={6} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Root ───────────────────────── */

export interface OverlayViewProps {
  config: OverlayConfig;
  live: PlayerLiveState;
  sizing: OverlaySizing;
}

/**
 * Auto-fit: if the content is wider/taller than the canvas (narrow OBS source, many fields, big
 * scale), shrink the root font-size until it fits. Everything is em-based, so content size is
 * proportional to the font-size and one measurement is enough.
 */
function useFitToBox() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef(1);
  /** Adjustments in the current frame (see the convergence guard below). */
  const burstRef = useRef(0);
  const [fit, setFit] = useState(1);

  const measure = useCallback(() => {
    const root = rootRef.current;
    const content = root?.firstElementChild as HTMLElement | null | undefined;
    if (!root || !content) return;
    const cs = getComputedStyle(root);
    const availW = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // Natural (fit = 1) size of the content, derived from its current size.
    const w = content.scrollWidth / fitRef.current;
    const h = content.scrollHeight / fitRef.current;
    if (w <= 0 || h <= 0 || availW <= 0 || availH <= 0) return;
    const next = Math.max(0.2, Math.floor(Math.min(1, availW / w, availH / h) * 1000) / 1000);
    if (Math.abs(next - fitRef.current) > 0.004) {
      // Convergence guard: at very small canvases, borders and glyphs snap to whole pixels, so
      // size is not exactly proportional to the font-size and the estimate can ping-pong. After
      // a few adjustments in one frame only shrinking is allowed, and never more than a hard
      // cap per frame (a long run of tiny shrinks must not exceed React's nested-update limit);
      // the next frame (ResizeObserver / render) resumes from the current value.
      burstRef.current += 1;
      if (burstRef.current === 1 && typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
          burstRef.current = 0;
        });
      }
      if (burstRef.current > 4 && (next > fitRef.current || burstRef.current > 8)) return;
      fitRef.current = next;
      setFit(next);
    }
  }, []);

  // Content (fields, values, theme) may change on any render: re-measure. The threshold guard
  // above makes this converge after at most one extra render.
  useLayoutEffect(() => {
    measure();
  });

  // Canvas size changes (OBS source resize, preview resize) and content size changes that
  // happen without a React render (web font finishing loading → wider text, e.g. longer labels).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    void fonts?.ready.then(measure);
    fonts?.addEventListener("loadingdone", measure);
    return () => {
      ro.disconnect();
      fonts?.removeEventListener("loadingdone", measure);
    };
  }, [measure]);

  return { rootRef, fit };
}

/** Data-only summary for update detection (never config: edits must not "play" an update). */
function overlaySummary(
  live: PlayerLiveState,
  config: OverlayConfig,
  stats: OverlayStats,
): OverlaySummary {
  const c = pickRatingCharacter(live.session, config.ratingCharacterKey);
  return {
    sessionId: live.session.sessionId,
    // The statistics being shown (scope + their counters): switching scope is a new baseline.
    scope: stats.scope,
    character: c?.characterKey ?? null,
    totalGames: stats.totalGames,
    wins: stats.wins,
    losses: stats.losses,
    rating: c?.current?.value ?? null,
    rank: c?.current?.rank ?? null,
    streak: stats.currentWinStreak,
  };
}

/**
 * The live state themes render: session counters replaced by the projected statistics
 * (resolveOverlayStats). Themes keep reading `live.session.*` and never decide scope themselves.
 */
function withDisplayedStats(live: PlayerLiveState, stats: OverlayStats): PlayerLiveState {
  if (stats.scope === "session") return live;
  return {
    ...live,
    session: {
      ...live.session,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      totalGames: stats.totalGames,
      winRate: stats.winRate,
      currentWinStreak: stats.currentWinStreak,
      currentLossStreak: stats.currentLossStreak,
      bestWinStreak: stats.bestWinStreak,
      recentResults: stats.recentResults,
    },
  };
}

export function OverlayView({ config, live, sizing }: OverlayViewProps) {
  const { rootRef, fit } = useFitToBox();
  // Creator motion (Phase 5.0): only an entitled owner's EFFECTIVE config carries `motion`;
  // Free, animations off and reduced motion all resolve to no profile (nothing extra renders).
  const reducedMotion = usePrefersReducedMotion();
  const profile = motionProfile(config.creator?.motion, {
    animations: config.animations,
    reducedMotion,
  });
  // Phase 5.1: the ONE projection of the statistics this overlay shows (session or character).
  const stats = resolveOverlayStats(live.session, config);
  const shown = withDisplayedStats(live, stats);
  const update = useOverlayUpdate(
    overlaySummary(live, config, stats),
    profile?.clearAfterMs ?? null,
  );
  const motionAttrs = profile
    ? {
        "data-motion-style": profile.style,
        "data-motion-intensity": profile.intensity,
        "data-accent-motion": profile.accent,
        "data-rank-motion": profile.rank,
        "data-result-emphasis": profile.resultEmphasis ? "on" : "off",
        ...(update
          ? {
              "data-update": update.result ?? "update",
              "data-update-cycle": String(update.seq % 2),
              "data-rating-changed": update.ratingChanged || update.rankChanged ? "yes" : "no",
            }
          : {}),
      }
    : {};
  const className = [
    "sf6-overlay",
    `ov-theme-${config.theme}`,
    `ov-align-${config.align}`,
    config.animations ? "ov-animate" : "",
    // Creator Beta customization: present only in an entitled owner's EFFECTIVE config.
    ...creatorClassNames(config.creator),
  ].join(" ");

  // The overlay has its own language (config.locale), independent from the dashboard's.
  return (
    <NextIntlClientProvider locale={config.locale} messages={getOverlayMessages(config.locale)}>
      <div
        ref={rootRef}
        lang={config.locale}
        className={className}
        style={{
          ...overlayStyle(config, sizing, fit),
          ...creatorCssVars(config.creator),
          ...profile?.vars,
        }}
        data-session-status={live.session.status}
        {...motionAttrs}
      >
        <MotionProvider value={{ update, sweep: profile?.accent === "sweep" }}>
          {config.theme === "minimal" && <MinimalTheme config={config} live={shown} />}
          {config.theme === "competitive" && <CompetitiveTheme config={config} live={shown} />}
          {config.theme === "fighter" && <FighterTheme config={config} live={shown} />}
          {/* Creator themes: only reachable via an entitled owner's EFFECTIVE config. */}
          {config.theme === "rank-card" && <RankCardTheme config={config} live={shown} />}
          {config.theme === "broadcast" && <BroadcastTheme config={config} live={shown} />}
          {config.theme === "prestige" && <PrestigeTheme config={config} live={shown} />}
        </MotionProvider>
      </div>
    </NextIntlClientProvider>
  );
}
