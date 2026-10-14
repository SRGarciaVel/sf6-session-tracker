"use client";

/**
 * SST Brand Flag runtime (Phase 5.3B). The schedule lives in domain/overlay/brand-flag.ts; this
 * file only runs it and draws the tab.
 *
 *   useBrandFlag  one setTimeout chain at most (hidden → shown → hidden …). Independent of the
 *                 live data: snapshots, matches, rotation and Creator Motion never restart it. A
 *                 schedule change (enable, mode, interval, visible time) restarts it from
 *                 "hidden"; unmount clears it. A static badge schedules nothing.
 *                 `revealSignal` (builder preview only) triggers one reveal through the SAME
 *                 controller — there is no second animation implementation.
 *   (5.3C)        the integrated presentation shares this controller: OverlayView provides its
 *                 state (BrandInterleaveProvider) to the theme's designated slot, which draws
 *                 BrandInterleaveLayer over its own box — no side slot, nothing re-measured.
 *   BrandSlot     the reserved, static space beside the panel and the tab inside it. The tab
 *                 slides out from behind the panel's edge with transform/opacity only (the
 *                 slot clips it while it's retracted), so nothing is ever re-measured.
 *
 * The mark is the OFFICIAL SST geometry (components/brand): the monogram, or the official
 * lockup composition (monogram + divider + "Session Stats Tracker"), in its monochrome form
 * (letters only, in the overlay's text colour — always legible on the panel background).
 */
import { createContext, useContext, useEffect, useState } from "react";
import { Monogram } from "@/components/brand/BrandMark";
import { LETTERS, LOCKUP_LAYOUT, SLANT_TRANSFORM, VIEWBOX_ATTR } from "@/components/brand/geometry";
import { BRAND_FULL_NAME } from "@/components/brand/names";
import {
  brandFlagDelayMs,
  isTimedBrandMode,
  type BrandFlag,
  type BrandFlagAnimation,
  type BrandFlagPhase,
} from "@/domain/overlay/brand-flag";

interface FlagState {
  /** Identity of the schedule this state belongs to (config edits restart it). */
  key: string;
  phase: BrandFlagPhase;
  /** No reveal has happened yet in this schedule (the first one waits a full interval). */
  first: boolean;
  /** Bumps on every phase change (restarts the single timer). */
  seq: number;
  /** Last preview reveal request handled. */
  signal: number;
}

const scheduleKey = (flag: BrandFlag | undefined) =>
  flag?.enabled ? `${flag.mode}|${flag.intervalSeconds}|${flag.visibleSeconds}` : "off";

/** Whether the tab is out right now; null when the flag isn't enabled. */
export function useBrandFlag(
  flag: BrandFlag | undefined,
  revealSignal = 0,
): { shown: boolean } | null {
  const key = scheduleKey(flag);
  const [state, setState] = useState<FlagState>({
    key,
    phase: "hidden",
    first: true,
    seq: 0,
    signal: revealSignal,
  });

  // Adjusting state during render (no effect loop): a new schedule starts hidden; a preview
  // reveal request shows the tab now and continues the normal cycle afterwards.
  let current = state;
  if (current.key !== key) {
    current = { key, phase: "hidden", first: true, seq: current.seq + 1, signal: current.signal };
  }
  if (current.signal !== revealSignal) {
    const timed = flag?.enabled === true && isTimedBrandMode(flag.mode);
    current = timed
      ? { ...current, phase: "shown", first: false, seq: current.seq + 1, signal: revealSignal }
      : { ...current, signal: revealSignal };
  }
  if (current !== state) setState(current);

  const delay = flag ? brandFlagDelayMs(flag, current.phase, current.first) : null;
  const seq = current.seq;
  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(
      () =>
        setState((s) =>
          s.seq !== seq
            ? s
            : s.phase === "hidden"
              ? { ...s, phase: "shown", first: false, seq: s.seq + 1 }
              : { ...s, phase: "hidden", seq: s.seq + 1 },
        ),
      delay,
    );
    return () => clearTimeout(id);
  }, [delay, seq]);

  if (!flag?.enabled) return null;
  if (flag.mode === "static-badge") return { shown: true };
  return { shown: current.phase === "shown" };
}

/** The official mark, as the flag shows it (monochrome: letters in `currentColor`). */
function FlagLogo({ variant }: { variant: BrandFlag["logoVariant"] }) {
  if (variant === "monogram") return <Monogram tone="mono" className="ov-brand-mark" />;
  return (
    <span className="ov-brand-lockup">
      <Monogram tone="mono" className="ov-brand-mark" />
      <span className="ov-brand-divider" />
      <span className="ov-brand-words">
        {BRAND_FULL_NAME.split(" ").map((w) => (
          <span key={w}>{w}</span>
        ))}
      </span>
    </span>
  );
}

export function BrandSlot({
  flag,
  shown,
  animation,
}: {
  flag: BrandFlag;
  shown: boolean;
  animation: BrandFlagAnimation;
}) {
  return (
    <div
      className="ov-brand-slot"
      data-logo={flag.logoVariant}
      data-color={flag.colorMode}
      aria-hidden={shown ? undefined : true}
    >
      <div
        className="ov-brand-flag"
        data-state={shown ? "shown" : "hidden"}
        data-anim={animation}
        role={shown ? "img" : undefined}
        aria-label={shown ? "SST" : undefined}
      >
        <FlagLogo variant={flag.logoVariant} />
      </div>
    </div>
  );
}

/* ───────── Integrated presentation (Phase 5.3C) ───────── */

/**
 * State of the integrated ("content-interleave") presentation, provided by OverlayView and read
 * by the theme's designated slot. null = not in integrated mode (the slot renders exactly as
 * before — no extra element, attribute or style).
 */
export interface BrandInterleaveState {
  shown: boolean;
  logo: BrandFlag["logoVariant"];
  colorMode: BrandFlag["colorMode"];
  transition: "fade" | "instant";
}

const BrandInterleaveContext = createContext<BrandInterleaveState | null>(null);
export const BrandInterleaveProvider = BrandInterleaveContext.Provider;
export const useBrandInterleave = () => useContext(BrandInterleaveContext);

/** Official monogram as one vector that fits any box (letters only, `currentColor`). */
function FitMonogram() {
  return (
    <svg
      viewBox={VIEWBOX_ATTR}
      preserveAspectRatio="xMidYMid meet"
      className="ov-il-logo"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={SLANT_TRANSFORM} fill="currentColor">
        <path d={LETTERS.s1} />
        <path d={LETTERS.s2} />
        <path d={LETTERS.t} />
      </g>
    </svg>
  );
}

/**
 * Official lockup (monogram + divider + "Session Stats Tracker", the composition of
 * public/brand/sst-lockup.svg) as one vector that fits any box. Integrated branding is
 * monogram-only today: this renders only for a theme whose capability declares "full"
 * (themes.ts integratedBranding) — none does, since no secondary slot reaches the readability
 * floor. Kept so a future official asset/slot can be enabled from the registry alone.
 */
function FitLockup() {
  const { width, height, mark, divider, words } = LOCKUP_LAYOUT;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="ov-il-logo"
      aria-hidden="true"
      focusable="false"
    >
      <svg x={mark.x} y={mark.y} width={mark.width} height={mark.height} viewBox={VIEWBOX_ATTR}>
        <g transform={SLANT_TRANSFORM} fill="currentColor">
          <path d={LETTERS.s1} />
          <path d={LETTERS.s2} />
          <path d={LETTERS.t} />
        </g>
      </svg>
      <rect {...divider} fill="currentColor" opacity={0.35} />
      <g
        fill="currentColor"
        className="ov-il-words"
        fontSize={words.fontSize}
        fontWeight={words.fontWeight}
        letterSpacing={words.letterSpacing}
      >
        {BRAND_FULL_NAME.toUpperCase()
          .split(" ")
          .map((w, i) => (
            <text key={w} x={words.x} y={words.baselines[i]}>
              {w}
            </text>
          ))}
      </g>
    </svg>
  );
}

/**
 * Attributes that turn an element into the theme's designated slot host (the element keeps its
 * own size; its children fade out while the brand layer covers the same box). null ⇒ none.
 */
export function brandHostAttrs(il: BrandInterleaveState | null) {
  if (!il) return null;
  return { "data-il": il.shown ? "shown" : "hidden", "data-il-anim": il.transition } as const;
}

/**
 * The brand layer of a theme's designated slot. Absolutely positioned over the slot's own box
 * (inset 0), so the slot keeps the size of its normal content and nothing is re-measured. The
 * logo was already resolved against the theme's capability (OverlayView, integratedLogo).
 */
export function BrandInterleaveLayer() {
  const il = useBrandInterleave();
  if (!il) return null;
  return (
    <span
      className="ov-il-brand"
      data-color={il.colorMode}
      role={il.shown ? "img" : undefined}
      aria-label={il.shown ? "SST" : undefined}
      aria-hidden={il.shown ? undefined : true}
    >
      {il.logo === "full" ? <FitLockup /> : <FitMonogram />}
    </span>
  );
}
