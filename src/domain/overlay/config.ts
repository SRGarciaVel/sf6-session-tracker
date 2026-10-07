/**
 * Overlay configuration model. Persisted as JSON in `overlay.config`; validated on every write
 * and tolerant on read (missing keys fall back to defaults so old configs keep working).
 */
import { z } from "zod";
import { CHARACTER_KEY_PATTERN } from "@/domain/sf6/rating";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locale";
import { creatorCustomizationSchema, parseCreatorCustomization } from "./creator";
import { FONT_IDS } from "./fonts";
import { THEME_IDS, type OverlayCanvasId, type ThemeId } from "./themes";
import { parseThemeVariants, themeVariantsSchema } from "./variants";

/** Every theme (Free + Creator); tiers, canvases and fallbacks live in ./themes.ts. */
export const OVERLAY_THEMES = THEME_IDS;
export type OverlayThemeId = ThemeId;

export const OVERLAY_PRESETS = {
  compact: { width: 600, height: 120 },
  standard: { width: 800, height: 180 },
  detailed: { width: 900, height: 240 },
} as const satisfies Record<OverlayCanvasId, { width: number; height: number }>;
export type OverlayPresetId = keyof typeof OVERLAY_PRESETS;
const PRESET_IDS = Object.keys(OVERLAY_PRESETS) as [OverlayPresetId, ...OverlayPresetId[]];

export { OVERLAY_FONTS, type OverlayFontId } from "./fonts";

export const STATS_SCOPES = ["session", "character"] as const;
export type StatsScope = (typeof STATS_SCOPES)[number];

export const OVERLAY_FIELDS = [
  "wins",
  "losses",
  "winRate",
  "rating",
  "ratingDelta",
  "rank",
  "winStreak",
  "bestStreak",
  "totalGames",
  "recentForm",
] as const;
export type OverlayFieldId = (typeof OVERLAY_FIELDS)[number];

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
  /** Custom title; "" = localized default ("Session" / "Sesión"). */
  title: z.string().trim().max(24),
  showTitle: z.boolean(),
  /** Overlay language, independent from the streamer's dashboard language. */
  locale: z.enum(LOCALES),
  /**
   * Character whose rating the overlay shows. null = the active character (latest Ranked match);
   * a key (e.g. "aki") pins it. W/L stays global either way.
   */
  ratingCharacterKey: z.string().regex(CHARACTER_KEY_PATTERN).max(40).nullable(),
  /**
   * Phase 5.1 (Free): which statistics the overlay shows. "session" = the whole session
   * (default, historical behaviour); "character" = the character selected above (same one as
   * the rating). Configs saved before 5.1 have none and read as "session".
   */
  statsScope: z.enum(STATS_SCOPES),
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
  /**
   * Creator Beta customization (domain/overlay/creator.ts). Optional and default-safe: old
   * configs have none. Stored even when the owner is not entitled; renderers use
   * getEffectiveOverlayConfig(), which ignores it then.
   */
  creator: creatorCustomizationSchema.optional(),
  /**
   * Creator theme variants (domain/overlay/variants.ts), kept per theme. Optional; only read by
   * Creator themes, and only when the owner is entitled to premium themes.
   */
  variants: themeVariantsSchema.optional(),
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
  title: "",
  showTitle: true,
  locale: DEFAULT_LOCALE,
  ratingCharacterKey: null,
  statsScope: "session",
  font: "barlow-condensed",
  textColor: "#f4f6ff",
  mutedColor: "#a3acd0",
  accentColor: "#2fe0ff",
  winColor: "#29f0a8",
  lossColor: "#ff3b72",
  backgroundColor: "#070a16",
  backgroundOpacity: 0.82,
  borderEnabled: false,
  borderColor: "#2fe0ff",
  borderWidth: 2,
  borderRadius: 0,
  scale: 1,
  spacing: "normal",
  align: "left",
  animations: true,
};

export interface OverlayThemeMeta {
  id: OverlayThemeId;
  /** Applied when the streamer switches to this theme in the builder. */
  defaults: Partial<OverlayConfig>;
}

/** HUD palettes shared by every theme (cyan / magenta on deep navy). */
const HUD_PALETTE = {
  textColor: "#f4f6ff",
  mutedColor: "#a3acd0",
  winColor: "#29f0a8",
  lossColor: "#ff3b72",
} as const satisfies Partial<OverlayConfig>;

export const OVERLAY_THEME_META: Record<OverlayThemeId, OverlayThemeMeta> = {
  minimal: {
    id: "minimal",
    defaults: {
      ...HUD_PALETTE,
      preset: "compact",
      font: "barlow-condensed",
      accentColor: "#2fe0ff",
      backgroundColor: "#070a16",
      backgroundOpacity: 0,
      borderEnabled: false,
      borderRadius: 0,
    },
  },
  competitive: {
    id: "competitive",
    defaults: {
      ...HUD_PALETTE,
      preset: "standard",
      font: "barlow-condensed",
      accentColor: "#2fe0ff",
      backgroundColor: "#070a16",
      backgroundOpacity: 0.82,
      borderRadius: 0,
    },
  },
  fighter: {
    id: "fighter",
    defaults: {
      ...HUD_PALETTE,
      preset: "standard",
      font: "bebas-neue",
      accentColor: "#ff2e93",
      backgroundColor: "#0a0b1c",
      backgroundOpacity: 0.88,
      borderRadius: 0,
    },
  },
  // Creator themes (Phase 4.5). Defaults are Free options; they only pick a starting look.
  "rank-card": {
    id: "rank-card",
    defaults: {
      ...HUD_PALETTE,
      preset: "standard",
      font: "chakra-petch",
      accentColor: "#2fe0ff",
      backgroundColor: "#090c1c",
      backgroundOpacity: 0.9,
      borderRadius: 0,
    },
  },
  broadcast: {
    id: "broadcast",
    defaults: {
      ...HUD_PALETTE,
      preset: "standard",
      font: "barlow",
      accentColor: "#2fe0ff",
      backgroundColor: "#0b0f1e",
      backgroundOpacity: 0.94,
      borderEnabled: false,
      borderRadius: 0,
    },
  },
  prestige: {
    id: "prestige",
    defaults: {
      ...HUD_PALETTE,
      preset: "detailed",
      font: "oswald",
      accentColor: "#f5c451",
      backgroundColor: "#0a0816",
      backgroundOpacity: 0.9,
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
  // Configs saved before i18n had no `locale` and stored the default title literally.
  const legacy = obj.locale === undefined;
  // The Creator block is parsed on its own: an unusable block is dropped, never the overlay.
  const creator = parseCreatorCustomization(obj.creator);
  const variants = parseThemeVariants(obj.variants);
  const merged = {
    ...DEFAULT_OVERLAY_CONFIG,
    ...obj,
    ...(legacy && obj.title === "SESSION" ? { title: "" } : {}),
    version: 1,
    fields: { ...DEFAULT_OVERLAY_CONFIG.fields, ...storedFields },
    creator: undefined,
    variants: undefined,
  };
  const parsed = overlayConfigSchema.safeParse(merged);
  const base: OverlayConfig = parsed.success ? parsed.data : DEFAULT_OVERLAY_CONFIG;
  return {
    ...base,
    ...(creator === undefined ? {} : { creator }),
    ...(variants === undefined ? {} : { variants }),
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
