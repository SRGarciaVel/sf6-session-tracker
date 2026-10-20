/**
 * Shared overlay render parts (used by the Free themes in OverlayView and the Creator themes in
 * creator-themes.tsx). Pure presentation: values arrive pre-computed from the server.
 */
import { BrandInterleaveLayer, useBrandInterleave } from "./brand-flag";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { RatingTransition, SessionOverlayConfig } from "@/domain/overlay/config";
import { pickRatingCharacter, type PlayerLiveState } from "@/domain/overlay/state";
import { deltaTone, formatDelta, formatInteger } from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";

/**
 * Re-mounts its span when the value changes so the CSS tick animation runs; the very first
 * render is static (no animation on page load / OBS refresh). `flash` tints the glow.
 */
export function Animated({
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
export function Delta({
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

export function Ratio({ wins, losses }: { wins: number; losses: number }) {
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

/**
 * Recent results chips. `brandSlot` makes the CHIPS the theme's designated secondary slot for the
 * integrated SST branding (Phase 5.3C, themes.ts `integratedBranding.slot: "recent-results"`):
 * while it's revealed the chips fade out and the official mark fades in over the same box
 * (absolute layer, inset 0) — same size, no re-measure. Themes whose slot is the whole segment
 * ("recent-results-segment") make that segment the host instead and leave this prop off.
 * Without integrated branding the markup is exactly as before. No results ⇒ no block, no slot.
 */
export function RecentForm({
  results,
  max = 8,
  brandSlot,
}: {
  results: MatchResult[];
  max?: number;
  brandSlot?: boolean;
}) {
  const t = useTranslations("Overlay");
  const il = useBrandInterleave();
  if (results.length === 0) return null;
  const slot = brandSlot === true && il !== null;
  return (
    <span
      className={slot ? "ov-form ov-il-host" : "ov-form"}
      data-il={slot ? (il.shown ? "shown" : "hidden") : undefined}
      data-il-anim={slot ? il.transition : undefined}
    >
      {results.slice(-max).map((r, i) => (
        <span
          key={`${i}-${r}`}
          className={`ov-form-chip ov-r-${r}`}
          aria-hidden={slot && il.shown ? true : undefined}
        >
          {t(RESULT_KEY[r])}
        </span>
      ))}
      {slot && <BrandInterleaveLayer />}
    </span>
  );
}

export interface ThemeProps {
  config: SessionOverlayConfig;
  live: PlayerLiveState;
  /**
   * Presentation view identifier (Phase 5.3A mixed modes). Titled themes already get it through
   * the presentation title; only Minimal (no title slot) renders it directly.
   */
  viewLabel?: string | null;
}

/**
 * Rating of ONE character: the overlay's pinned `ratingCharacterKey`, else the active character
 * (latest Ranked match). W/L stays global; this never mixes characters.
 */
export function ratingParts(live: PlayerLiveState, config: SessionOverlayConfig) {
  const c = pickRatingCharacter(live.session, config.ratingCharacterKey);
  const system = c?.current?.system ?? c?.ratingSystem ?? null;
  return {
    // MR / LP are official game terms: not translated.
    label: system === "mr" ? "MR" : system === "lp" ? "LP" : "",
    character: c?.characterName ?? "—",
    value: formatInteger(c?.current?.value ?? null, config.locale),
    delta: c?.delta ?? null,
    rank: c?.current?.rank ?? c?.initial?.rank ?? "—",
    /** Raw rank label (null = unknown) and system, for rank-aware Creator themes. */
    rankLabel: c?.current?.rank ?? c?.initial?.rank ?? null,
    system,
    /** Phase 5.5: the authoritative number and whose it is (for rating transitions). */
    rawValue: c?.current?.value ?? null,
    characterKey: c?.characterKey ?? null,
    locale: config.locale,
  };
}

/* ───────── Phase 5.5: rating transitions ───────── */

export interface RatingTransitionContextValue {
  /** Effective mode: "instant" whenever animations are off or reduced motion is preferred. */
  mode: RatingTransition;
  /** Count duration (ms). */
  durationMs: number;
  /** Session + player identity: a transition never spans two of them. */
  scope: string;
}

const RatingTransitionContext = createContext<RatingTransitionContextValue>({
  mode: "instant",
  durationMs: 0,
  scope: "",
});
export const RatingTransitionProvider = RatingTransitionContext.Provider;

/** Broadcast-friendly easing: fast start, gentle landing (monotonic: never overshoots). */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * The rating number of a Session theme. "instant" is exactly the pre-5.5 markup (`Animated`).
 * "count" / "fade" animate only between two authoritative values of the SAME session, player,
 * character and rating system; anything else (first render, identity change, unknown value)
 * shows the target directly.
 */
export function RatingValue({ parts }: { parts: ReturnType<typeof ratingParts> }) {
  const t = useContext(RatingTransitionContext);
  const identity = `${t.scope}|${parts.characterKey ?? ""}|${parts.system ?? ""}`;
  if (t.mode === "count" && t.durationMs > 0) {
    return (
      <CountingNumber
        target={parts.rawValue}
        formatted={parts.value}
        locale={parts.locale}
        identity={identity}
        durationMs={t.durationMs}
      />
    );
  }
  if (t.mode === "fade") {
    return <FadingNumber formatted={parts.value} identity={identity} />;
  }
  return <Animated value={parts.value} />;
}

interface CountState {
  identity: string;
  target: number | null;
  /** Number on screen right now. */
  value: number | null;
  /** Start of the running count (null = at rest). */
  from: number | null;
}

/**
 * Progressive count. State is adjusted DURING render when a new target arrives (no frame showing
 * the final value before the count), the frames run on requestAnimationFrame with a monotonic
 * clock (a throttled / resumed tab simply lands on the target), a newer target retargets from the
 * number currently on screen, and cleanup cancels the frame (no stale completion, no leak).
 */
function CountingNumber({
  target,
  formatted,
  locale,
  identity,
  durationMs,
}: {
  target: number | null;
  formatted: string;
  locale: string;
  identity: string;
  durationMs: number;
}) {
  const [s, setS] = useState<CountState>({ identity, target, value: target, from: null });
  if (s.identity !== identity || s.target !== target) {
    const animate =
      s.identity === identity && s.value !== null && target !== null && s.value !== target;
    setS({ identity, target, value: animate ? s.value : target, from: animate ? s.value : null });
  }

  const { from } = s;
  useEffect(() => {
    if (from === null || target === null) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function frame(now) {
      const p = Math.min(1, Math.max(0, (now - start) / durationMs));
      const value = p >= 1 ? target : Math.round(from + (target - from) * easeOutCubic(p));
      setS((prev) =>
        prev.target === target && prev.identity === identity
          ? { ...prev, value, from: p >= 1 ? null : prev.from }
          : prev,
      );
      if (p < 1) raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  }, [from, target, identity, durationMs]);

  if (s.from === null) return <span className="ov-num">{formatted}</span>;
  // Counting: the intermediate integers are hidden from assistive tech; the final value is not.
  return (
    <span className="ov-num ov-counting">
      <span aria-hidden="true">{formatInteger(s.value, locale)}</span>
      <span className="ov-sr">{formatted}</span>
    </span>
  );
}

/** Discreet fade-in of a new value of the same identity (no overlap: one number at a time). */
function FadingNumber({ formatted, identity }: { formatted: string; identity: string }) {
  const [s, setS] = useState({ formatted, identity, version: 0, fade: false });
  if (s.formatted !== formatted || s.identity !== identity) {
    setS({ formatted, identity, version: s.version + 1, fade: s.identity === identity });
  }
  return (
    <span key={s.version} className={s.fade ? "ov-num ov-rt-fade" : "ov-num"}>
      {formatted}
    </span>
  );
}

/** Joins nodes with a separator element (no per-stat boxes). */
export function joinWith(
  nodes: Array<{ key: string; node: ReactNode }>,
  sep: (key: string) => ReactNode,
) {
  return nodes.map((item, i) => (
    <span key={item.key} style={{ display: "contents" }}>
      {i > 0 && sep(item.key)}
      {item.node}
    </span>
  ));
}

export function Cell({
  label,
  children,
  className,
  labelClassName,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
}) {
  return (
    <div className={`ov-cell ${className ?? ""}`}>
      <span className={labelClassName ? `ov-label ${labelClassName}` : "ov-label"}>{label}</span>
      {children}
    </div>
  );
}
