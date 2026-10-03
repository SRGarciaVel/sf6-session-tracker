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
import { OVERLAY_PRESETS, hexToRgba, type OverlayConfig } from "@/domain/overlay/config";
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
    "--ov-gap": GAP[config.spacing],
  };
}

/**
 * Re-mounts its span when the value changes so the CSS tick animation runs; the very first
 * render is static (no animation on page load / OBS refresh).
 */
function Animated({ value, className }: { value: string | number; className?: string }) {
  const [tracked, setTracked] = useState({ value, version: 0 });
  if (tracked.value !== value) setTracked({ value, version: tracked.version + 1 });
  const cls = ["ov-num", tracked.version > 0 ? "ov-changed" : "", className ?? ""].join(" ").trim();
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

const RESULT_LETTER: Record<MatchResult, string> = { win: "W", loss: "L", draw: "D" };

function RecentForm({ results, max = 8 }: { results: MatchResult[]; max?: number }) {
  if (results.length === 0) return null;
  return (
    <span className="ov-form">
      {results.slice(-max).map((r, i) => (
        <span key={`${i}-${r}`} className={`ov-form-chip ov-r-${r}`}>
          {RESULT_LETTER[r]}
        </span>
      ))}
    </span>
  );
}

interface ThemeProps {
  config: OverlayConfig;
  live: PlayerLiveState;
}

function ratingParts(live: PlayerLiveState) {
  const { rating } = live.session;
  return {
    label: rating.system === "mr" ? "MR" : "LP",
    value: formatInteger(rating.primary.current),
    delta: rating.primary.delta,
    rank: rating.rank ?? "—",
  };
}

/* ───────────────────────── Minimal ───────────────────────── */

function MinimalTheme({ config, live }: ThemeProps) {
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live);
  const items: Array<{ key: string; node: ReactNode }> = [];

  if (f.wins || f.losses) {
    items.push({
      key: "wl",
      node: (
        <span>
          {f.wins && (
            <>
              <Animated value={s.wins} />
              <span className="ov-unit ov-win">W</span>
            </>
          )}
          {f.wins && f.losses && " "}
          {f.losses && (
            <>
              <Animated value={s.losses} />
              <span className="ov-unit ov-loss">L</span>
            </>
          )}
        </span>
      ),
    });
  }
  if (f.winRate) items.push({ key: "wr", node: <Animated value={formatWinRate(s.winRate)} /> });
  if (f.totalGames)
    items.push({
      key: "tg",
      node: (
        <span>
          <Animated value={s.totalGames} />
          <span className="ov-unit ov-muted">G</span>
        </span>
      ),
    });
  if (f.rank) items.push({ key: "rank", node: <span>{r.rank}</span> });
  if (f.rating || f.ratingDelta) {
    items.push({
      key: "rating",
      node: (
        <span>
          {f.rating && (
            <>
              <Animated value={r.value} />
              <span className="ov-unit ov-muted"> {r.label}</span>
            </>
          )}
          {f.ratingDelta && (
            <Animated value={formatDelta(r.delta)} className={`ov-delta ${toneClass(r.delta)}`} />
          )}
        </span>
      ),
    });
  }
  if (f.winStreak && s.currentWinStreak >= 2) {
    items.push({
      key: "streak",
      node: (
        <span className="ov-accent">
          <Animated value={s.currentWinStreak} /> STREAK
        </span>
      ),
    });
  }
  if (f.bestStreak)
    items.push({
      key: "best",
      node: (
        <span>
          <span className="ov-muted">BEST </span>
          <Animated value={s.bestWinStreak} />
        </span>
      ),
    });
  if (f.recentForm)
    items.push({ key: "form", node: <RecentForm results={s.recentResults} max={5} /> });

  return (
    <div className="ov-panel ov-minimal ov-shadow">
      {items.map((item, i) => (
        <span key={item.key} style={{ display: "contents" }}>
          {i > 0 && <span className="ov-sep">•</span>}
          {item.node}
        </span>
      ))}
    </div>
  );
}

/* ─────────────────────── Competitive ─────────────────────── */

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ov-stat">
      <span className="ov-stat-label">{label}</span>
      <span className="ov-stat-value">{children}</span>
    </div>
  );
}

function CompetitiveTheme({ config, live }: ThemeProps) {
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live);
  const blocks: Array<{ key: string; node: ReactNode }> = [];

  if (f.wins)
    blocks.push({
      key: "w",
      node: (
        <Stat label="Wins">
          <Animated value={s.wins} className="ov-win" />
        </Stat>
      ),
    });
  if (f.losses)
    blocks.push({
      key: "l",
      node: (
        <Stat label="Losses">
          <Animated value={s.losses} className="ov-loss" />
        </Stat>
      ),
    });
  if (f.winRate)
    blocks.push({
      key: "wr",
      node: (
        <Stat label="Win rate">
          <Animated value={formatWinRate(s.winRate)} />
        </Stat>
      ),
    });
  if (f.totalGames)
    blocks.push({
      key: "tg",
      node: (
        <Stat label="Games">
          <Animated value={s.totalGames} />
        </Stat>
      ),
    });
  if (f.rating || f.ratingDelta) {
    blocks.push({
      key: "rating",
      node: (
        <Stat label={r.label}>
          {f.rating && <Animated value={r.value} />}
          {f.ratingDelta && (
            <Animated
              value={formatDelta(r.delta)}
              className={`ov-stat-sub ${toneClass(r.delta)}`}
            />
          )}
        </Stat>
      ),
    });
  }
  if (f.winStreak)
    blocks.push({
      key: "ws",
      node: (
        <Stat label="Streak">
          <Animated
            value={s.currentWinStreak}
            className={s.currentWinStreak >= 3 ? "ov-accent" : ""}
          />
        </Stat>
      ),
    });
  if (f.bestStreak)
    blocks.push({
      key: "bs",
      node: (
        <Stat label="Best">
          <Animated value={s.bestWinStreak} />
        </Stat>
      ),
    });

  const showHead = config.title.length > 0 || f.rank;
  return (
    <div className="ov-panel ov-competitive ov-shadow">
      {showHead && (
        <div className="ov-head">
          <span className="ov-title">{config.title}</span>
          {f.rank && <span className="ov-muted">{r.rank}</span>}
        </div>
      )}
      <div className="ov-row">
        {blocks.map((b, i) => (
          <span key={b.key} style={{ display: "contents" }}>
            {i > 0 && <span className="ov-divider" />}
            {b.node}
          </span>
        ))}
      </div>
      {f.recentForm && <RecentForm results={s.recentResults} max={10} />}
    </div>
  );
}

/* ───────────────────────── Fighter ───────────────────────── */

function FighterTheme({ config, live }: ThemeProps) {
  const s = live.session;
  const f = config.fields;
  const r = ratingParts(live);
  const showScore = f.wins || f.losses;

  return (
    <div className="ov-fighter ov-shadow">
      {(showScore || f.winRate) && (
        <div className="ov-f-block ov-f-main">
          <div className="ov-f-inner">
            {showScore && (
              <div className="ov-f-col">
                <span className="ov-f-label">{config.title || "Session"}</span>
                <span className="ov-f-big ov-f-score">
                  {f.wins && <Animated value={s.wins} className="ov-win" />}
                  {f.wins && f.losses && <span className="ov-f-dash">-</span>}
                  {f.losses && <Animated value={s.losses} className="ov-loss" />}
                </span>
              </div>
            )}
            {f.winRate && (
              <div className="ov-f-col">
                <span className="ov-f-label">Win rate</span>
                <span className="ov-f-mid">
                  <Animated value={formatWinRate(s.winRate)} />
                </span>
              </div>
            )}
            {f.totalGames && (
              <div className="ov-f-col">
                <span className="ov-f-label">Games</span>
                <span className="ov-f-mid">
                  <Animated value={s.totalGames} />
                </span>
              </div>
            )}
          </div>
        </div>
      )}
      {(f.rating || f.ratingDelta || f.rank) && (
        <div className="ov-f-block">
          <div className="ov-f-inner">
            <div className="ov-f-col">
              <span className="ov-f-label">{f.rank ? r.rank : r.label}</span>
              <span className="ov-f-mid">
                {f.rating && (
                  <>
                    <Animated value={r.value} /> <span className="ov-muted">{r.label}</span>{" "}
                  </>
                )}
                {f.ratingDelta && (
                  <Animated
                    value={formatDelta(r.delta)}
                    className={`ov-f-badge ${toneClass(r.delta)}`}
                  />
                )}
              </span>
            </div>
          </div>
        </div>
      )}
      {f.winStreak && s.currentWinStreak >= 2 && (
        <div className="ov-f-block ov-f-streak">
          <div className="ov-f-inner">
            <div className="ov-f-col">
              <span className="ov-f-label">Win streak</span>
              <span className="ov-f-mid">
                <Animated value={s.currentWinStreak} />
              </span>
            </div>
          </div>
        </div>
      )}
      {f.bestStreak && (
        <div className="ov-f-block">
          <div className="ov-f-inner">
            <div className="ov-f-col">
              <span className="ov-f-label">Best</span>
              <span className="ov-f-mid">
                <Animated value={s.bestWinStreak} />
              </span>
            </div>
          </div>
        </div>
      )}
      {f.recentForm && s.recentResults.length > 0 && (
        <div className="ov-f-block">
          <div className="ov-f-inner">
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

  // Canvas size changes (OBS source resize, preview resize).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
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

  return (
    <div
      ref={rootRef}
      className={className}
      style={overlayStyle(config, sizing, fit)}
      data-session-status={live.session.status}
    >
      {config.theme === "minimal" && <MinimalTheme config={config} live={live} />}
      {config.theme === "competitive" && <CompetitiveTheme config={config} live={live} />}
      {config.theme === "fighter" && <FighterTheme config={config} live={live} />}
    </div>
  );
}
