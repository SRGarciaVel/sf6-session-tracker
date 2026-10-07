/**
 * Creator motion & broadcast effects (Phase 5.0, docs/creator-overlays.md).
 *
 *   creator.motion        strict enums/booleans — no durations, CSS or free-form values
 *   overlays.motionEffects the entitlement (independent of advancedCustomization)
 *   detectOverlayChange   pure: consecutive live summaries → one update event (or none)
 *   motionProfile         pure: motion config + reduced-motion → what to render (or nothing)
 *
 * Free behaviour is untouched: without the entitlement the effective config has no `motion`,
 * so the renderer adds no attribute, element or animation beyond today's number ticks.
 */
import { z } from "zod";

export const UPDATE_STYLES = ["snappy", "smooth", "impact"] as const;
export const MOTION_INTENSITIES = ["subtle", "normal", "strong"] as const;
export const ACCENT_MOTIONS = ["static", "pulse", "sweep"] as const;
export const RANK_MOTIONS = ["none", "subtle", "emphasized"] as const;

export const creatorMotionSchema = z.strictObject({
  updateStyle: z.enum(UPDATE_STYLES),
  intensity: z.enum(MOTION_INTENSITIES),
  resultEmphasis: z.boolean(),
  accentMotion: z.enum(ACCENT_MOTIONS),
  rankMotion: z.enum(RANK_MOTIONS),
});
export type CreatorMotion = z.infer<typeof creatorMotionSchema>;

/** A considered starting point (used when the streamer first opens the Movement group). */
export const DEFAULT_CREATOR_MOTION: CreatorMotion = {
  updateStyle: "snappy",
  intensity: "normal",
  resultEmphasis: true,
  accentMotion: "pulse",
  rankMotion: "subtle",
};

/** Lenient read: defaults for missing keys; anything invalid ⇒ undefined (dropped, never the overlay). */
export function parseCreatorMotion(raw: unknown): CreatorMotion | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const parsed = creatorMotionSchema.safeParse({ ...DEFAULT_CREATOR_MOTION, ...(raw as object) });
  return parsed.success ? parsed.data : undefined;
}

/* ───────── tokens (the only place durations / magnitudes live) ───────── */

export const MOTION_TOKENS = {
  /** Total length of the one-shot effect per style (ms) and its easing. */
  style: {
    snappy: { duration: 260, tick: 160, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    smooth: { duration: 520, tick: 360, ease: "cubic-bezier(0.33, 1, 0.68, 1)" },
    impact: { duration: 620, tick: 220, ease: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
  },
  /** Magnitudes in em (scale with the overlay) per intensity. */
  intensity: {
    subtle: { scale: 1.03, shift: 0.08, glow: 0.25, sweep: 0.22 },
    normal: { scale: 1.07, shift: 0.16, glow: 0.45, sweep: 0.36 },
    strong: { scale: 1.12, shift: 0.26, glow: 0.7, sweep: 0.5 },
  },
  /** Rank emblem response multiplier. */
  rank: { none: 0, subtle: 1, emphasized: 1.8 },
} as const;

export interface MotionProfile {
  style: CreatorMotion["updateStyle"];
  intensity: CreatorMotion["intensity"];
  resultEmphasis: boolean;
  accent: CreatorMotion["accentMotion"];
  rank: CreatorMotion["rankMotion"];
  /** CSS custom properties (fixed token values only). */
  vars: Record<`--${string}`, string>;
  /** When the one-shot effect is over (the renderer clears the update state after this). */
  clearAfterMs: number;
}

/**
 * What the renderer applies. null ⇒ nothing: no motion block (Free / not entitled),
 * overlay animations switched off, or the viewer prefers reduced motion (data still updates).
 */
export function motionProfile(
  motion: CreatorMotion | undefined,
  opts: { animations: boolean; reducedMotion: boolean },
): MotionProfile | null {
  if (!motion || !opts.animations || opts.reducedMotion) return null;
  const style = MOTION_TOKENS.style[motion.updateStyle];
  const mag = MOTION_TOKENS.intensity[motion.intensity];
  const rank = MOTION_TOKENS.rank[motion.rankMotion];
  return {
    style: motion.updateStyle,
    intensity: motion.intensity,
    resultEmphasis: motion.resultEmphasis,
    accent: motion.accentMotion,
    rank: motion.rankMotion,
    vars: {
      "--ovm-dur": `${style.duration}ms`,
      "--ovm-tick": `${style.tick}ms`,
      "--ovm-ease": style.ease,
      "--ovm-scale": String(mag.scale),
      "--ovm-shift": `${mag.shift}em`,
      "--ovm-glow": `${mag.glow}em`,
      "--ovm-sweep": String(mag.sweep),
      "--ovm-rank-scale": String(1 + (mag.scale - 1) * rank),
    },
    clearAfterMs: style.duration + 400,
  };
}

/* ───────── change detection ───────── */

/** The authoritative fields an update is derived from (already in the live state). */
export interface OverlaySummary {
  sessionId: string | null;
  /** Statistics shown (Phase 5.1): switching session ↔ character is a config edit, not a match. */
  scope: "session" | "character";
  /**
   * Phase 5.2. "fixed": the displayed character comes from the config (pinned or active) and the
   * counters are the DISPLAYED ones (session or character scope) — the 5.0/5.1 semantics.
   * "rotation": the displayed character is presentation state that changes on its own, so the
   * counters are the authoritative GLOBAL session counters (they never depend on which character
   * is on screen) and a match is detected from them alone. Switching mode is a config edit.
   */
  mode: "fixed" | "rotation";
  /** Character whose rating is shown (changing it — a config edit or a rotation — is not an update). */
  character: string | null;
  totalGames: number;
  wins: number;
  losses: number;
  rating: number | null;
  rank: string | null;
  streak: number;
}

export type UpdateResult = "win" | "loss" | "draw";

export interface OverlayUpdate {
  /** Stable identity of this update: the same data never produces a second event. */
  key: string;
  /** Present only when a match was completed (games grew within the same session). */
  result: UpdateResult | null;
  ratingChanged: boolean;
  rankChanged: boolean;
  streakChanged: boolean;
}

export function summaryKey(s: OverlaySummary): string {
  return [
    s.sessionId ?? "-",
    s.scope,
    s.mode,
    s.character ?? "-",
    s.totalGames,
    s.wins,
    s.losses,
    s.rating ?? "-",
    s.rank ?? "-",
    s.streak,
  ].join("|");
}

/**
 * True when `next` is an OLDER snapshot than the baseline: same (non-null) session, same
 * comparison basis (scope + mode, and the displayed character in fixed mode — rotation counters
 * are global, so there it doesn't matter) and fewer games. Such a snapshot must never become the baseline — otherwise the current snapshot
 * arriving again would look like a new match and replay its effect. A different session or
 * displayed character is a genuine new baseline, never "stale".
 */
export function isStaleSummary(baseline: OverlaySummary, next: OverlaySummary): boolean {
  return (
    baseline.sessionId !== null &&
    baseline.sessionId === next.sessionId &&
    baseline.scope === next.scope &&
    baseline.mode === next.mode &&
    // Rotation counters are global (Phase 5.2): the character on screen doesn't affect whether
    // two snapshots are comparable. In fixed mode a different character is a new baseline.
    (next.mode === "rotation" || baseline.character === next.character) &&
    next.totalGames < baseline.totalGames
  );
}

/**
 * One update event for a meaningful data change, or null.
 *  - no previous summary (first render), identical data, a different session, a different
 *    displayed character (config edit) or a rewind (fewer games) ⇒ null: the overlay just shows
 *    the new state, nothing plays;
 *  - games grew ⇒ a match completed: win if wins grew, loss if losses grew, else draw
 *    (only counters the backend already provides — never inferred from colour or MR alone);
 *  - same games but rating/rank changed (e.g. a profile refresh) ⇒ an update with result null
 *    (no result emphasis).
 *
 * Rotation mode (Phase 5.2) separates match detection from character selection:
 *  - the displayed character changed WITHOUT new games ⇒ a rotation step: null (no result,
 *    rank or match effect — only the rotation transition plays);
 *  - it changed WITH new games ⇒ a real match moved the overlay to that match's character
 *    (latest-match priority): the result comes from the global counters; rating/rank flags stay
 *    false because the two summaries describe different characters (never compared);
 *  - same character ⇒ exactly the fixed-mode rules (on global counters).
 */
export function detectOverlayChange(
  prev: OverlaySummary | null,
  next: OverlaySummary,
): OverlayUpdate | null {
  if (!prev) return null;
  if (
    prev.sessionId !== next.sessionId ||
    prev.scope !== next.scope ||
    prev.mode !== next.mode ||
    next.totalGames < prev.totalGames
  ) {
    return null;
  }
  const matchCompleted = next.totalGames > prev.totalGames;
  const sameCharacter = prev.character === next.character;
  if (!sameCharacter && (next.mode === "fixed" || !matchCompleted)) return null;
  const ratingChanged = sameCharacter && prev.rating !== next.rating;
  const rankChanged = sameCharacter && prev.rank !== next.rank;
  const streakChanged = sameCharacter && prev.streak !== next.streak;
  if (!matchCompleted && !ratingChanged && !rankChanged) return null;
  const result: UpdateResult | null = !matchCompleted
    ? null
    : next.wins > prev.wins
      ? "win"
      : next.losses > prev.losses
        ? "loss"
        : "draw";
  return { key: summaryKey(next), result, ratingChanged, rankChanged, streakChanged };
}
