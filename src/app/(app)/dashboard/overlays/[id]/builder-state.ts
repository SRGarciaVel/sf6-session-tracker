/**
 * Pure builder state helpers (Phase 4.9). One canonical editable config lives in OverlayBuilder;
 * everything here is derived from it. Preview-only state (zoom, background, sample data) never
 * touches the config.
 */
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_FIELDS,
  OVERLAY_THEME_META,
  type OverlayConfig,
  type OverlayFieldId,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION, type CreatorCustomization } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION, type CreatorMotion } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION, type CharacterRotation } from "@/domain/overlay/rotation";
import { DEFAULT_BRAND_FLAG, type BrandFlag } from "@/domain/overlay/brand-flag";

/** JSON with sorted keys and without `undefined` members: key order never makes a config "dirty". */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface EditorSnapshot {
  name: string;
  config: OverlayConfig;
}

/** Differs from what is stored? Compares the STORED-shape config (never the effective one). */
export function isDirty(saved: EditorSnapshot, current: EditorSnapshot): boolean {
  return (
    saved.name !== current.name || canonicalJson(saved.config) !== canonicalJson(current.config)
  );
}

/** Stat toggles grouped as the streamer thinks about them (every OVERLAY_FIELDS id, once). */
export const FIELD_GROUPS: ReadonlyArray<{ id: "session" | "rating"; fields: OverlayFieldId[] }> = [
  {
    id: "session",
    fields: ["wins", "losses", "winRate", "totalGames", "winStreak", "bestStreak", "recentForm"],
  },
  { id: "rating", fields: ["rating", "ratingDelta", "rank"] },
];

export function setAllFields(config: OverlayConfig, on: boolean): OverlayConfig {
  const fields = { ...config.fields };
  for (const f of OVERLAY_FIELDS) fields[f] = on;
  return { ...config, fields };
}

/** Style keys a single "reset" can restore from the current theme's defaults. */
export type ResettableKey =
  | "textColor"
  | "mutedColor"
  | "accentColor"
  | "winColor"
  | "lossColor"
  | "backgroundColor"
  | "borderColor";

/** The theme's own value for a style key (existing resolver: theme meta → global defaults). */
export function themeDefault<K extends ResettableKey>(
  config: OverlayConfig,
  key: K,
): OverlayConfig[K] {
  const fromTheme = OVERLAY_THEME_META[config.theme].defaults[key];
  return (fromTheme ?? DEFAULT_OVERLAY_CONFIG[key]) as OverlayConfig[K];
}

/** Patch the optional Creator block, creating it with neutral defaults when first touched. */
export function patchCreator(
  config: OverlayConfig,
  patch: Partial<CreatorCustomization>,
): OverlayConfig {
  return { ...config, creator: { ...(config.creator ?? DEFAULT_CREATOR_CUSTOMIZATION), ...patch } };
}

/** Turn Creator motion on (with the considered defaults) or off (removes only the motion block). */
export function setMotionEnabled(config: OverlayConfig, on: boolean): OverlayConfig {
  if (on) return patchCreator(config, { motion: config.creator?.motion ?? DEFAULT_CREATOR_MOTION });
  if (!config.creator?.motion) return config;
  const creator = { ...config.creator };
  delete creator.motion;
  return { ...config, creator };
}

export function patchMotion(config: OverlayConfig, patch: Partial<CreatorMotion>): OverlayConfig {
  return patchCreator(config, {
    motion: { ...(config.creator?.motion ?? DEFAULT_CREATOR_MOTION), ...patch },
  });
}

/**
 * Character rotation (Phase 5.2): patch the block, creating it from the defaults. Turning it off
 * keeps every preference (enabled: false), so turning it back on restores them.
 */
export function patchRotation(
  config: OverlayConfig,
  patch: Partial<CharacterRotation>,
): OverlayConfig {
  return patchCreator(config, {
    characterRotation: {
      ...(config.creator?.characterRotation ?? DEFAULT_CHARACTER_ROTATION),
      ...patch,
    },
  });
}

/** SST Brand Flag (Phase 5.3B): patch the block, creating it from the defaults. */
export function patchBrandFlag(config: OverlayConfig, patch: Partial<BrandFlag>): OverlayConfig {
  return patchCreator(config, {
    brandFlag: { ...(config.creator?.brandFlag ?? DEFAULT_BRAND_FLAG), ...patch },
  });
}

/** Preview zoom: null = fit the pane; numbers = fraction of the real canvas size. */
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5] as const;
export type PreviewZoom = null | (typeof ZOOM_STEPS)[number];

export function stepZoom(current: PreviewZoom, fitScale: number, direction: 1 | -1): PreviewZoom {
  const from = current ?? fitScale;
  if (direction > 0)
    return ZOOM_STEPS.find((z) => z > from + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 1;
  return [...ZOOM_STEPS].reverse().find((z) => z < from - 0.001) ?? ZOOM_STEPS[0] ?? 0.5;
}

export const EDITOR_TABS = ["appearance", "content", "style", "creator"] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];
