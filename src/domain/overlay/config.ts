/**
 * Overlay configuration model. Persisted as JSON in `overlay.config`; validated on every write
 * and tolerant on read (missing keys fall back to defaults so old configs keep working).
 *
 * Phase 5.4A/B: the config is discriminated by `kind` (./kind.ts): the Session Stats overlay
 * ("session"; configs stored before 5.4A have no `kind` and read as it) and the Rank Progress
 * overlay ("rank-progress", ./rank-progress.ts). Each kind has its own schema and parser.
 */
import { z } from "zod";
import { CHARACTER_KEY_PATTERN } from "@/domain/sf6/rating";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locale";
import { creatorCustomizationSchema, parseCreatorCustomization } from "./creator";
import { storedOverlayKind, type CreatableOverlayKind } from "./kind";
import {
  DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  RANK_PROGRESS_CANVASES,
  parseRankProgressOverlayConfig,
  rankProgressOverlayConfigSchema,
  type RankProgressOverlayConfig,
  type RankProgressStyle,
} from "./rank-progress";
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

/** The Session Stats overlay config (every overlay before Phase 5.4A). */
export const sessionOverlayConfigSchema = z.object({
  /**
   * Phase 5.4A discriminant. Optional on INPUT (legacy configs and older editors send none) and
   * always "session" on output. Any other value is rejected: a session config can never claim to
   * be another kind. Same config version: adding the discriminant needs no migration.
   */
  kind: z.literal("session").default("session"),
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

export type SessionOverlayConfig = z.infer<typeof sessionOverlayConfigSchema>;

export type { RankProgressOverlayConfig } from "./rank-progress";

/** Every overlay config, discriminated by `kind` (narrow on `config.kind`). */
export type OverlayConfig = SessionOverlayConfig | RankProgressOverlayConfig;

/** The config if it is a Session Stats one, else null (for Session-only callers: presets…). */
export function sessionConfigOf(config: OverlayConfig): SessionOverlayConfig | null {
  return config.kind === "session" ? config : null;
}

/**
 * Strict schema of a config sent by an editor, any kind. Rank Progress requires its literal kind;
 * a body without `kind` is a (legacy) Session config. A config never validates as another kind's.
 */
export const overlayConfigSchema = z.union([
  rankProgressOverlayConfigSchema,
  sessionOverlayConfigSchema,
]);

export const DEFAULT_SESSION_OVERLAY_CONFIG: SessionOverlayConfig = {
  kind: "session",
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

/** Historical name, kept to avoid churn: the default overlay IS the default Session overlay. */
export const DEFAULT_OVERLAY_CONFIG = DEFAULT_SESSION_OVERLAY_CONFIG;

/** Default config of a new overlay of `kind` (only creatable kinds have one). */
export function defaultOverlayConfigForKind(kind: CreatableOverlayKind): OverlayConfig {
  switch (kind) {
    case "session":
      return DEFAULT_SESSION_OVERLAY_CONFIG;
    case "rank-progress":
      return DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG;
  }
}

export interface OverlayThemeMeta {
  id: OverlayThemeId;
  /** Applied when the streamer switches to this theme in the builder. */
  defaults: Partial<SessionOverlayConfig>;
}

/** HUD palettes shared by every theme (cyan / magenta on deep navy). */
const HUD_PALETTE = {
  textColor: "#f4f6ff",
  mutedColor: "#a3acd0",
  winColor: "#29f0a8",
  lossColor: "#ff3b72",
} as const satisfies Partial<SessionOverlayConfig>;

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

export function applyThemeDefaults(
  config: SessionOverlayConfig,
  theme: OverlayThemeId,
): SessionOverlayConfig {
  return { ...config, ...OVERLAY_THEME_META[theme].defaults, theme };
}

/**
 * The single public parser of stored configs (lenient read). The kind decides the parser:
 *   no kind / "session"  ⇒ the Session parser (legacy rows need no migration or backfill);
 *   "rank-progress"      ⇒ the Rank Progress parser (an unusable one ⇒ the Rank Progress
 *                          default: a row never changes kind on read);
 *   unknown / non-object ⇒ the safe Session default, as before (never read as Rank Progress).
 * Reading never writes: rows keep their stored JSON until the owner saves.
 */
export function parseOverlayConfig(raw: unknown): OverlayConfig {
  switch (storedOverlayKind(raw)) {
    case "session":
      // storedOverlayKind() only answers a kind for a plain (non-array) object.
      return parseSessionOverlayConfig(raw as Record<string, unknown>);
    case "rank-progress":
      return parseRankProgressOverlayConfig(raw as Record<string, unknown>);
    default:
      return DEFAULT_SESSION_OVERLAY_CONFIG;
  }
}

/** Lenient Session read: merge stored JSON with defaults; fall back to defaults if unusable. */
function parseSessionOverlayConfig(obj: Record<string, unknown>): SessionOverlayConfig {
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
    kind: "session",
    version: 1,
    fields: { ...DEFAULT_OVERLAY_CONFIG.fields, ...storedFields },
    creator: undefined,
    variants: undefined,
  };
  const parsed = sessionOverlayConfigSchema.safeParse(merged);
  const base: SessionOverlayConfig = parsed.success ? parsed.data : DEFAULT_SESSION_OVERLAY_CONFIG;
  return {
    ...base,
    ...(creator === undefined ? {} : { creator }),
    ...(variants === undefined ? {} : { variants }),
  };
}

/**
 * What an overlay card shows about an overlay, per kind (Phase 5.4A): callers no longer assume
 * every config has Session theme fields. Session: canvas, language, theme. Rank Progress: canvas,
 * language, style.
 */
export interface OverlayReadout {
  kind: OverlayConfig["kind"];
  canvas: { width: number; height: number };
  locale: OverlayConfig["locale"];
  /** Session theme; null for kinds without Session themes. */
  theme: OverlayThemeId | null;
  /** Rank Progress style; null for kinds without one. */
  style: RankProgressStyle | null;
}

export function overlayReadout(config: OverlayConfig): OverlayReadout {
  switch (config.kind) {
    case "session":
      return {
        kind: config.kind,
        canvas: OVERLAY_PRESETS[config.preset],
        locale: config.locale,
        theme: config.theme,
        style: null,
      };
    case "rank-progress":
      return {
        kind: config.kind,
        canvas: RANK_PROGRESS_CANVASES[config.style],
        locale: config.locale,
        theme: null,
        style: config.style,
      };
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
