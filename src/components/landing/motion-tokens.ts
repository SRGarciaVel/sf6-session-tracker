/** Shared motion language for the landing (Phase 4.7). Durations in seconds (Motion). */
export const EASE_SNAP = [0.2, 0.8, 0.2, 1] as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  /** HUD value changes, chip states. */
  fast: 0.22,
  /** Stage swaps (theme, step). */
  normal: 0.45,
  /** Headline reveals. */
  slow: 0.7,
} as const;

/** Product UI enters with depth (scale + translate), never a plain fade-up. */
export const STAGE_SWAP = {
  initial: { opacity: 0, scale: 0.94, y: 18 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 1.03, y: -12 },
  transition: { duration: DURATION.normal, ease: EASE_OUT },
} as const;

/** A step is "active" while it crosses this band around the viewport centre. */
export const ACTIVE_BAND_ROOT_MARGIN = "-45% 0px -45% 0px";
