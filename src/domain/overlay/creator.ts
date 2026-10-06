/**
 * Creator Beta — advanced overlay customization (RFC 0001 Phase 4, docs/creator-overlays.md).
 *
 * Creator-module candidate: everything Creator-specific about overlays lives here (schema,
 * effective-config rule, save merge) plus the renderer hooks in components/overlay/creator-style.ts
 * and the builder section. Core only needs the `creator` slot in the config and
 * `getEffectiveOverlayConfig()`.
 *
 * Rules:
 *  - Every option that existed before Phase 4 stays Free (fonts, 7 colors, opacity, border,
 *    scale, spacing, alignment, animations, 10 stat toggles, title, rating character).
 *  - Creator options are NEW, typed and bounded: no free-form CSS, HTML or URLs.
 *  - STORED config keeps `creator`, `variants` and a Creator `theme` forever (downgrade never
 *    deletes); the EFFECTIVE config used by every renderer (dashboard preview and OBS) drops or
 *    falls back unless the owner is entitled (Phase 4.5: premium themes, themes.ts).
 */
import { z } from "zod";
import { FONT_IDS } from "./fonts";
import { creatorMotionSchema, parseCreatorMotion } from "./motion";
import {
  THEME_REGISTRY,
  isCreatorTheme,
  supportedCanvas,
  type OverlayCanvasId,
  type ThemeId,
} from "./themes";
import type { ThemeVariants } from "./variants";

export const NUMBER_SCALE_MIN = 0.85;
export const NUMBER_SCALE_MAX = 1.25;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color");

export const creatorCustomizationSchema = z.strictObject({
  /**
   * Second brand color: replaces the fixed HUD magenta (Street theme) and becomes the partner
   * color of every accent gradient. null = the theme's own look.
   */
  secondaryAccent: hexColor.nullable(),
  /** Font for numbers only (labels keep the base font). null = same as the base font. */
  numberFont: z.enum(FONT_IDS).nullable(),
  /** Size of the numbers relative to the labels (bounded so OBS canvases never overflow). */
  numberScale: z.number().min(NUMBER_SCALE_MIN).max(NUMBER_SCALE_MAX),
  /** Visual elements (not stats: stat visibility is the Free `fields` option). */
  show: z.strictObject({
    labels: z.boolean(),
    units: z.boolean(),
    characterName: z.boolean(),
    decorations: z.boolean(),
  }),
  /**
   * Creator motion (Phase 5.0, motion.ts). Optional: absent = no premium motion. Gated by
   * `overlays.motionEffects` (independent of advancedCustomization).
   */
  motion: creatorMotionSchema.optional(),
});

export type CreatorCustomization = z.infer<typeof creatorCustomizationSchema>;

/** Neutral values: identical rendering to an overlay without Creator customization. */
export const DEFAULT_CREATOR_CUSTOMIZATION: CreatorCustomization = {
  secondaryAccent: null,
  numberFont: null,
  numberScale: 1,
  show: { labels: true, units: true, characterName: true, decorations: true },
};

/** Lenient read of a stored block: defaults for missing keys; unusable ⇒ undefined (dropped). */
export function parseCreatorCustomization(raw: unknown): CreatorCustomization | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const show = obj.show !== null && typeof obj.show === "object" ? (obj.show as object) : {};
  // Motion is parsed on its own: an unusable motion block is dropped, never the customization.
  const motion = parseCreatorMotion(obj.motion);
  const parsed = creatorCustomizationSchema.safeParse({
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    ...obj,
    show: { ...DEFAULT_CREATOR_CUSTOMIZATION.show, ...show },
    motion: undefined,
  });
  if (!parsed.success) return undefined;
  return motion === undefined ? parsed.data : { ...parsed.data, motion };
}

/** The Creator entitlements overlays need. */
export interface OverlayCustomizationEntitlement {
  overlays: { advancedCustomization: boolean; premiumThemes: boolean; motionEffects: boolean };
}

/** Fields of the overlay config this module reads (structural: avoids a cycle with config.ts). */
interface CreatorAwareConfig {
  theme: ThemeId;
  preset: OverlayCanvasId;
  creator?: CreatorCustomization;
  variants?: ThemeVariants;
}

/**
 * EFFECTIVE config for rendering (dashboard preview, OBS page, /state, SSE). Pure: never
 * mutates the stored config. Not entitled ⇒
 *  - the Creator block is ignored (the theme's own look renders);
 *  - a Creator theme renders as its registered Free fallback, without variants.
 * Stored values are kept for when access returns. An entitled Creator theme always gets a
 * canvas it supports (deterministic; the builder only offers those anyway).
 */
export function getEffectiveOverlayConfig<C extends CreatorAwareConfig>(
  stored: C,
  entitlements: OverlayCustomizationEntitlement,
): C {
  const { advancedCustomization, premiumThemes, motionEffects } = entitlements.overlays;
  const creator = effectiveCreator(stored.creator, advancedCustomization, motionEffects);
  const premium = isCreatorTheme(stored.theme);
  const fallback = premium && !premiumThemes;
  const preset =
    premium && premiumThemes ? supportedCanvas(stored.theme, stored.preset) : stored.preset;
  const dropVariants = stored.variants !== undefined && (!premiumThemes || !premium);
  if (creator === stored.creator && !fallback && !dropVariants && preset === stored.preset) {
    return stored;
  }

  const effective = { ...stored, preset };
  if (creator === undefined) delete effective.creator;
  else effective.creator = creator;
  if (dropVariants) delete effective.variants;
  if (fallback) effective.theme = THEME_REGISTRY[stored.theme].fallback;
  return effective;
}

/**
 * The Creator block a renderer may use. Customization needs advancedCustomization; motion needs
 * motionEffects (independent). Without customization, motion rides on neutral defaults, which
 * render exactly like no customization. Same object back when nothing is dropped.
 */
function effectiveCreator(
  stored: CreatorCustomization | undefined,
  advancedCustomization: boolean,
  motionEffects: boolean,
): CreatorCustomization | undefined {
  if (stored === undefined) return undefined;
  const keepMotion = motionEffects && stored.motion !== undefined;
  if (advancedCustomization) {
    if (keepMotion || stored.motion === undefined) return stored;
    const withoutMotion = { ...stored };
    delete withoutMotion.motion;
    return withoutMotion;
  }
  return keepMotion ? { ...DEFAULT_CREATOR_CUSTOMIZATION, motion: stored.motion } : undefined;
}

/**
 * Config to PERSIST when the owner saves. Free options are always taken from the request.
 * Creator values are taken from the request only if the owner is entitled; otherwise:
 *  - the Creator block and the theme variants keep their stored values (a Free save can neither
 *    add, change nor delete them — downgrade never deletes, crafted requests unlock nothing);
 *  - a Creator theme is accepted only if it is already the stored theme (the editor sending
 *    back what it loaded). A Creator theme that was never stored keeps the stored theme. An
 *    explicit switch to a Free theme is a Free choice and is saved.
 * An entitled save normalizes the canvas to one the Creator theme supports.
 */
export function mergeOverlayConfigForSave<C extends CreatorAwareConfig>(
  stored: C,
  incoming: C,
  entitlements: OverlayCustomizationEntitlement,
): C {
  const { advancedCustomization, premiumThemes, motionEffects } = entitlements.overlays;
  // Customization and motion are merged independently: each comes from the request only when
  // the owner holds its entitlement, otherwise the stored value is kept untouched.
  const base = advancedCustomization ? incoming.creator : stored.creator;
  const motion = motionEffects ? incoming.creator?.motion : stored.creator?.motion;
  let creator: CreatorCustomization | undefined;
  if (base !== undefined) {
    creator = { ...base };
    delete creator.motion;
    if (motion !== undefined) creator.motion = motion;
  } else if (motion !== undefined) {
    creator = { ...DEFAULT_CREATOR_CUSTOMIZATION, motion };
  }
  const variants = premiumThemes ? (incoming.variants ?? stored.variants) : stored.variants;
  let theme = incoming.theme;
  if (isCreatorTheme(theme) && !premiumThemes && theme !== stored.theme) theme = stored.theme;
  const preset =
    isCreatorTheme(theme) && premiumThemes
      ? supportedCanvas(theme, incoming.preset)
      : incoming.preset;

  const merged = { ...incoming, theme, preset };
  delete merged.creator;
  delete merged.variants;
  return {
    ...merged,
    ...(creator === undefined ? {} : { creator }),
    ...(variants === undefined ? {} : { variants }),
  };
}
