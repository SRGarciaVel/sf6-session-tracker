/**
 * SST Brand Flag (Phase 5.3B, docs/creator-overlays.md): a compact broadcast-style tab with the
 * official SST mark, attached to the overlay's side. Creator Beta (`overlays.brandFlag`),
 * presentation only — it never touches statistics, rotation, priority or Creator Motion.
 *
 *   creator.brandFlag   strict config (literal sets only — no URLs, uploads, text or CSS)
 *
 * Timing model (one unambiguous definition):
 *   intervalSeconds  time between the START of two consecutive reveals (the period);
 *   visibleSeconds   how long each reveal stays out (always shorter than the period);
 *   the first reveal starts one full interval after the overlay appears.
 * "static-badge" is always visible and schedules nothing.
 */
import { z } from "zod";

export const BRAND_FLAG_MODES = ["timed-tab", "static-badge"] as const;
export const BRAND_FLAG_POSITIONS = ["left", "right"] as const;
export const BRAND_FLAG_INTERVALS = [30, 60, 120, 300] as const;
export const BRAND_FLAG_VISIBLE = [2, 3, 5] as const;
export const BRAND_FLAG_ANIMATIONS = ["slide", "fade", "instant"] as const;
/** Official assets only: the monogram, and the full lockup (monogram + "Session Stats Tracker"). */
export const BRAND_FLAG_LOGOS = ["monogram", "full"] as const;
export const BRAND_FLAG_COLORS = ["theme", "creator-accent"] as const;

export type BrandFlagMode = (typeof BRAND_FLAG_MODES)[number];
export type BrandFlagPosition = (typeof BRAND_FLAG_POSITIONS)[number];
export type BrandFlagInterval = (typeof BRAND_FLAG_INTERVALS)[number];
export type BrandFlagVisible = (typeof BRAND_FLAG_VISIBLE)[number];
export type BrandFlagAnimation = (typeof BRAND_FLAG_ANIMATIONS)[number];
export type BrandFlagLogo = (typeof BRAND_FLAG_LOGOS)[number];
export type BrandFlagColor = (typeof BRAND_FLAG_COLORS)[number];

export const brandFlagSchema = z.strictObject({
  enabled: z.boolean(),
  mode: z.enum(BRAND_FLAG_MODES),
  position: z.enum(BRAND_FLAG_POSITIONS),
  intervalSeconds: z.literal([...BRAND_FLAG_INTERVALS]),
  visibleSeconds: z.literal([...BRAND_FLAG_VISIBLE]),
  animation: z.enum(BRAND_FLAG_ANIMATIONS),
  logoVariant: z.enum(BRAND_FLAG_LOGOS),
  colorMode: z.enum(BRAND_FLAG_COLORS),
});
export type BrandFlag = z.infer<typeof brandFlagSchema>;

/** Off by default: every existing overlay renders exactly as before. */
export const DEFAULT_BRAND_FLAG: BrandFlag = {
  enabled: false,
  mode: "timed-tab",
  position: "right",
  intervalSeconds: 60,
  visibleSeconds: 3,
  animation: "slide",
  logoVariant: "monogram",
  colorMode: "theme",
};

/**
 * Lenient read of a stored block (old or partially corrupt JSON): each invalid field falls back
 * to its safe default; a non-object ⇒ undefined (no block). Writes use the strict schema.
 */
export function parseBrandFlag(raw: unknown): BrandFlag | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const shape = brandFlagSchema.shape;
  const pick = <K extends keyof BrandFlag>(key: K): BrandFlag[K] => {
    const parsed = shape[key].safeParse(obj[key]);
    return parsed.success ? (parsed.data as BrandFlag[K]) : DEFAULT_BRAND_FLAG[key];
  };
  return {
    enabled: pick("enabled"),
    mode: pick("mode"),
    position: pick("position"),
    intervalSeconds: pick("intervalSeconds"),
    visibleSeconds: pick("visibleSeconds"),
    animation: pick("animation"),
    logoVariant: pick("logoVariant"),
    colorMode: pick("colorMode"),
  };
}

/* ───────── schedule (pure) ───────── */

export type BrandFlagPhase = "hidden" | "shown";

/**
 * How long the current phase lasts before the next one (ms), or null when nothing is scheduled
 * (static badge, disabled). `firstReveal` = no reveal has happened yet in this schedule.
 *   hidden → shown after: intervalSeconds (first) or intervalSeconds − visibleSeconds (later),
 *            so reveals START every intervalSeconds;
 *   shown  → hidden after visibleSeconds.
 */
export function brandFlagDelayMs(
  config: Pick<BrandFlag, "enabled" | "mode" | "intervalSeconds" | "visibleSeconds">,
  phase: BrandFlagPhase,
  firstReveal: boolean,
): number | null {
  if (!config.enabled || config.mode !== "timed-tab") return null;
  if (phase === "shown") return config.visibleSeconds * 1000;
  const hidden = firstReveal
    ? config.intervalSeconds
    : config.intervalSeconds - config.visibleSeconds;
  return hidden * 1000;
}

/** The animation actually rendered: animations off or reduced motion ⇒ instant. */
export function effectiveBrandAnimation(
  animation: BrandFlagAnimation,
  opts: { animations: boolean; reducedMotion: boolean },
): BrandFlagAnimation {
  return !opts.animations || opts.reducedMotion ? "instant" : animation;
}
