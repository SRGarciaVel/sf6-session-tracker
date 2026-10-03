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
import { getOverlayMessages } from "@/i18n/overlay-messages";
import type { PlayerLiveState } from "@/domain/overlay/state";
import { deltaTone, formatDelta, formatInteger, formatWinRate } from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";
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

/**
 * Re-mounts its span when the value changes so the CSS tick animation runs; the very first
 * render is static (no animation on page load / OBS refresh). `flash` tints the glow.
 */
function Animated({
  value,
  className,
  flash,
}: {
  value: string | number;
  className?: string;
  flash?: "win" | "loss";
}) {
  const [tracked, setTracked] = useState({ value, version: 0 });
  if (tracked.value !== value) setTracked({ value, version: tracked.version + 1 });
  const cls = [
    "ov-num",
    tracked.version > 0 ? "ov-changed" : "",
    tracked.version > 0 && flash ? `ov-flash-${flash}` : "",
    className ?? "",
  ]
    .join(" ")
    .trim();
  return (
    <span key={tracked.version} className={cls}>
      {value}
    </span>
  );
}

function toneClass(delta: number | null): string {
  const tone = deltaTone(delta);
  return tone === "positive" ? "ov-pos" : tone === "negative" ? "ov-neg" : "ov-neutral";
}

/** ▲ +24 / ▼ -18 — glyph + sign, so up/down never depends on color alone. */
function Delta({
  delta,
  locale,
  className,
}: {
  delta: number | null;
  locale: string;
  className: string;
}) {
  const tone = deltaTone(delta);
  return (
    <span className={`${className} ${toneClass(delta)}`}>
      {tone !== "neutral" && (
        <span className="ov-arrow" aria-hidden>
          {tone === "positive" ? "▲" : "▼"}
        </span>
      )}
      <Animated
        value={formatDelta(delta, locale)}
        flash={tone === "positive" ? "win" : tone === "negative" ? "loss" : undefined}
      />
    </span>
  );
}

function Ratio({ wins, losses }: { wins: number; losses: number }) {
  return (
    <span className="ov-ratio" aria-hidden>
      {wins + losses === 0 ? (
        <span className="ov-ratio-empty" />
      ) : (
        <>
          <span className="ov-ratio-w" style={{ flexGrow: wins }} />
          <span className="ov-ratio-l" style={{ flexGrow: losses }} />
        </>
      )}
    </span>
  );
}

const RESULT_KEY = { win: "resultWin", loss: "resultLoss", draw: "resultDraw" } as const;

function RecentForm({ results, max = 8 }: { results: MatchResult[]; max?: number }) {
  const t = useTranslations("Overlay");
  if (results.length === 0) return null;
  return (
    <span className="ov-form">
      {results.slice(-max).map((r, i) => (
        <span key={`${i}-${r}`} className={`ov-form-chip ov-r-${r}`}>
          {t(RESULT_KEY[r])}
        </span>
      ))}
    </span>
  );
}

interface ThemeProps {
  config: OverlayConfig;
  live: PlayerLiveState;
}

function ratingParts(live: PlayerLiveState, locale: string) {
  const { rating } = live.session;
  return {
    // MR / LP are official game terms: not translated.
    label: rating.system === "mr" ? "MR" : "LP",
    value: formatInteger(rating.primary.current, locale),
    delta: rating.primary.delta,
    rank: rating.rank ?? "—",
  };
}

/** Joins nodes with a separator element (no per-stat boxes). */
function joinWith(nodes: Array<{ key: string; node: ReactNode }>, sep: (key: string) => ReactNode) {
  return nodes.map((item, i) => (
    <span key={item.key} style={{ display: "contents" }}>
      {i > 0 && sep(item.key)}
      {item.node}
    </span>
  ));
}

/* ─────────────── Minimal — broadcast lower-third ─────────────── */

function MinimalTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const locale = config.locale;
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, locale);
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

function Cell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ov-cell ${className ?? ""}`}>
      <span className="ov-label">{label}</span>
      {children}
    </div>
  );
}

function CompetitiveTheme({ config, live }: ThemeProps) {
  const t = useTranslations("Overlay");
  const locale = config.locale;
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live, locale);
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
        <Cell label={r.label}>
          <span className="ov-mid">
            {f.rating && <Animated value={r.value} />}
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
  const r = ratingParts(live, locale);
  const showScore = f.wins || f.losses;

  return (
    <div className="ov-street ov-shadow">
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
              <span className="ov-st-label">{f.rank ? r.rank : r.label}</span>
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

export function OverlayView({ config, live, sizing }: OverlayViewProps) {
  const { rootRef, fit } = useFitToBox();
  const className = [
    "sf6-overlay",
    `ov-theme-${config.theme}`,
    `ov-align-${config.align}`,
    config.animations ? "ov-animate" : "",
  ].join(" ");

  // The overlay has its own language (config.locale), independent from the dashboard's.
  return (
    <NextIntlClientProvider locale={config.locale} messages={getOverlayMessages(config.locale)}>
      <div
        ref={rootRef}
        lang={config.locale}
        className={className}
        style={overlayStyle(config, sizing, fit)}
        data-session-status={live.session.status}
      >
        {config.theme === "minimal" && <MinimalTheme config={config} live={live} />}
        {config.theme === "competitive" && <CompetitiveTheme config={config} live={live} />}
        {config.theme === "fighter" && <FighterTheme config={config} live={live} />}
      </div>
    </NextIntlClientProvider>
  );
}
