/**
 * Overlay configuration model. Persisted as JSON in `overlay.config`; validated on every write
 * and tolerant on read (missing keys fall back to defaults so old configs keep working).
 */
import { z } from "zod";

export const OVERLAY_THEMES = ["minimal", "competitive", "fighter"] as const;
export type OverlayThemeId = (typeof OVERLAY_THEMES)[number];

export const OVERLAY_PRESETS = {
  compact: { label: "Compact", width: 600, height: 120 },
  standard: { label: "Standard", width: 800, height: 180 },
  detailed: { label: "Detailed", width: 900, height: 240 },
} as const;
export type OverlayPresetId = keyof typeof OVERLAY_PRESETS;
const PRESET_IDS = Object.keys(OVERLAY_PRESETS) as [OverlayPresetId, ...OverlayPresetId[]];

export const OVERLAY_FONTS = {
  "chakra-petch": "Chakra Petch",
  rajdhani: "Rajdhani",
  oswald: "Oswald",
  "bebas-neue": "Bebas Neue",
  inter: "Inter",
  "jetbrains-mono": "JetBrains Mono",
} as const;
export type OverlayFontId = keyof typeof OVERLAY_FONTS;
const FONT_IDS = Object.keys(OVERLAY_FONTS) as [OverlayFontId, ...OverlayFontId[]];

export const OVERLAY_FIELDS = {
  wins: "Wins",
  losses: "Losses",
  winRate: "Win rate",
  rating: "MR / LP",
  ratingDelta: "MR / LP change",
  rank: "Rank",
  winStreak: "Win streak",
  bestStreak: "Best streak",
  totalGames: "Total games",
  recentForm: "Recent form",
} as const;
export type OverlayFieldId = keyof typeof OVERLAY_FIELDS;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color");

const fieldsSchema = z.object({
  wins: z.boolean(),
  losses: z.boolean(),
  winRate: z.boolean(),
  rating: z.boolean(),
  ratingDelta: z.boolean(),
  rank: z.boolean(),
  winStreak: z.boolean(),
  bestStreak: z.boolean(),
  totalGames: z.boolean(),
  recentForm: z.boolean(),
}) satisfies z.ZodType<Record<OverlayFieldId, boolean>>;

export const overlayConfigSchema = z.object({
  version: z.literal(1),
  theme: z.enum(OVERLAY_THEMES),
  preset: z.enum(PRESET_IDS),
  fields: fieldsSchema,
  title: z.string().trim().max(24),
  font: z.enum(FONT_IDS),
  textColor: hexColor,
  mutedColor: hexColor,
  accentColor: hexColor,
  winColor: hexColor,
  lossColor: hexColor,
  backgroundColor: hexColor,
  backgroundOpacity: z.number().min(0).max(1),
  borderEnabled: z.boolean(),
  borderColor: hexColor,
  borderWidth: z.number().int().min(0).max(8),
  borderRadius: z.number().int().min(0).max(40),
  scale: z.number().min(0.5).max(2),
  spacing: z.enum(["tight", "normal", "relaxed"]),
  align: z.enum(["left", "center", "right"]),
  animations: z.boolean(),
});

export type OverlayConfig = z.infer<typeof overlayConfigSchema>;

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  version: 1,
  theme: "competitive",
  preset: "standard",
  fields: {
    wins: true,
    losses: true,
    winRate: true,
    rating: true,
    ratingDelta: true,
    rank: false,
    winStreak: true,
    bestStreak: false,
    totalGames: false,
    recentForm: false,
  },
  title: "SESSION",
  font: "chakra-petch",
  textColor: "#f4f5f7",
  mutedColor: "#9aa0ad",
  accentColor: "#ffb020",
  winColor: "#3ddc84",
  lossColor: "#ff4d5e",
  backgroundColor: "#0b0c10",
  backgroundOpacity: 0.72,
  borderEnabled: false,
  borderColor: "#ffb020",
  borderWidth: 2,
  borderRadius: 10,
  scale: 1,
  spacing: "normal",
  align: "left",
  animations: true,
};

export interface OverlayThemeMeta {
  id: OverlayThemeId;
  name: string;
  description: string;
  /** Applied when the streamer switches to this theme in the builder. */
  defaults: Partial<OverlayConfig>;
}

export const OVERLAY_THEME_META: Record<OverlayThemeId, OverlayThemeMeta> = {
  minimal: {
    id: "minimal",
    name: "Minimal",
    description: "One compact line. Stays out of the way of gameplay.",
    defaults: {
      preset: "compact",
      font: "inter",
      backgroundOpacity: 0,
      borderEnabled: false,
      borderRadius: 6,
    },
  },
  competitive: {
    id: "competitive",
    name: "Competitive",
    description: "Labelled stat blocks with a clear hierarchy.",
    defaults: {
      preset: "standard",
      font: "chakra-petch",
      backgroundOpacity: 0.72,
      borderRadius: 10,
    },
  },
  fighter: {
    id: "fighter",
    name: "Fighter",
    description: "Slanted panels and bold type, inspired by fighting-game HUDs.",
    defaults: {
      preset: "standard",
      font: "bebas-neue",
      accentColor: "#ff3d5a",
      backgroundColor: "#111216",
      backgroundOpacity: 0.85,
      borderRadius: 0,
    },
  },
};

export function applyThemeDefaults(config: OverlayConfig, theme: OverlayThemeId): OverlayConfig {
  return { ...config, ...OVERLAY_THEME_META[theme].defaults, theme };
}

/** Lenient read: merge stored JSON with defaults; fall back to defaults if it is unusable. */
export function parseOverlayConfig(raw: unknown): OverlayConfig {
  if (raw === null || typeof raw !== "object") return DEFAULT_OVERLAY_CONFIG;
  const obj = raw as Record<string, unknown>;
  const storedFields =
    obj.fields !== null && typeof obj.fields === "object" ? (obj.fields as object) : {};
  const merged = {
    ...DEFAULT_OVERLAY_CONFIG,
    ...obj,
    version: 1,
    fields: { ...DEFAULT_OVERLAY_CONFIG.fields, ...storedFields },
  };
  const parsed = overlayConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_OVERLAY_CONFIG;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
