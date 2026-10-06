/**
 * Overlay theme registry (explicit, typed; no plugin framework). The ONE place that says which
 * themes exist, which plan tier they need, which canvases they support and what a non-entitled
 * owner sees instead (deterministic fallback, always a Free theme).
 *
 * Free themes (minimal, competitive, fighter) are unchanged and stay Free forever (RFC 0001
 * §11.2). Creator themes are NEW (Phase 4.5, docs/creator-overlays.md).
 */
export const OVERLAY_PRESET_IDS = ["compact", "standard", "detailed"] as const;
export type OverlayCanvasId = (typeof OVERLAY_PRESET_IDS)[number];

export const FREE_THEME_IDS = ["minimal", "competitive", "fighter"] as const;
export const CREATOR_THEME_IDS = ["rank-card", "broadcast", "prestige"] as const;
export const THEME_IDS = [...FREE_THEME_IDS, ...CREATOR_THEME_IDS] as const;

export type FreeThemeId = (typeof FREE_THEME_IDS)[number];
export type CreatorThemeId = (typeof CREATOR_THEME_IDS)[number];
export type ThemeId = FreeThemeId | CreatorThemeId;

export interface ThemeDefinition {
  id: ThemeId;
  tier: "free" | "creator";
  /** Canvases the composition is designed for (the builder offers only these). */
  canvases: readonly OverlayCanvasId[];
  /** What renders when the owner is not entitled to this theme. Free themes: themselves. */
  fallback: FreeThemeId;
  /** Uses the rank to modulate its look (domain/sf6/rank-prestige.ts). */
  rankAware: boolean;
  /** Draws the SST rank emblem (Creator motion: rank reaction has something to animate). */
  rankEmblem: boolean;
}

const ALL_CANVASES = OVERLAY_PRESET_IDS;

export const THEME_REGISTRY: Readonly<Record<ThemeId, ThemeDefinition>> = {
  minimal: {
    id: "minimal",
    tier: "free",
    canvases: ALL_CANVASES,
    fallback: "minimal",
    rankAware: false,
    rankEmblem: false,
  },
  competitive: {
    id: "competitive",
    tier: "free",
    canvases: ALL_CANVASES,
    fallback: "competitive",
    rankAware: false,
    rankEmblem: false,
  },
  fighter: {
    id: "fighter",
    tier: "free",
    canvases: ALL_CANVASES,
    fallback: "fighter",
    rankAware: false,
    rankEmblem: false,
  },
  // Rank card: rank + rating led; closest Free composition is the scoreboard.
  "rank-card": {
    id: "rank-card",
    tier: "creator",
    canvases: ["standard", "detailed"],
    fallback: "competitive",
    rankAware: true,
    rankEmblem: true,
  },
  // Broadcast lower-third: flat and sober; closest Free look is the single-line minimal bar.
  broadcast: {
    id: "broadcast",
    tier: "creator",
    canvases: ALL_CANVASES,
    fallback: "minimal",
    rankAware: false,
    rankEmblem: false,
  },
  // Prestige: ornamental, high-tier; closest Free look is the expressive Street theme.
  prestige: {
    id: "prestige",
    tier: "creator",
    canvases: ["standard", "detailed"],
    fallback: "fighter",
    rankAware: true,
    rankEmblem: true,
  },
};

export function isCreatorTheme(id: ThemeId): id is CreatorThemeId {
  return THEME_REGISTRY[id].tier === "creator";
}

/** A canvas the theme supports: the requested one if possible, else its first canvas. */
export function supportedCanvas(theme: ThemeId, canvas: OverlayCanvasId): OverlayCanvasId {
  const canvases = THEME_REGISTRY[theme].canvases;
  return canvases.includes(canvas) ? canvas : (canvases[0] ?? "standard");
}
