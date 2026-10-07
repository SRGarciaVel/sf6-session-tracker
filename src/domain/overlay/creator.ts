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
import { brandFlagSchema, parseBrandFlag } from "./brand-flag";
import { characterRotationSchema, parseCharacterRotation } from "./rotation";
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
  /**
   * Character rotation & latest-match priority (Phase 5.2, rotation.ts). Optional: absent =
   * no rotation. Gated by `overlays.characterRotation` (independent of motion and
   * advancedCustomization).
   */
  characterRotation: characterRotationSchema.optional(),
  /** SST Brand Flag (Phase 5.3B, brand-flag.ts). Gated by `overlays.brandFlag` (independent). */
  brandFlag: brandFlagSchema.optional(),
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
  // Motion and rotation are parsed on their own: an unusable optional block is dropped (motion)
  // or defaulted field by field (rotation), never the whole customization.
  const motion = parseCreatorMotion(obj.motion);
  const characterRotation = parseCharacterRotation(obj.characterRotation);
  const brandFlag = parseBrandFlag(obj.brandFlag);
  const parsed = creatorCustomizationSchema.safeParse({
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    ...obj,
    show: { ...DEFAULT_CREATOR_CUSTOMIZATION.show, ...show },
    motion: undefined,
    characterRotation: undefined,
    brandFlag: undefined,
  });
  if (!parsed.success) return undefined;
  const out: CreatorCustomization = { ...parsed.data };
  delete out.motion;
  delete out.characterRotation;
  delete out.brandFlag;
  if (motion !== undefined) out.motion = motion;
  if (characterRotation !== undefined) out.characterRotation = characterRotation;
  if (brandFlag !== undefined) out.brandFlag = brandFlag;
  return out;
}

/** The Creator entitlements overlays need. */
export interface OverlayCustomizationEntitlement {
  overlays: {
    advancedCustomization: boolean;
    premiumThemes: boolean;
    motionEffects: boolean;
    characterRotation: boolean;
    brandFlag: boolean;
  };
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
  const { premiumThemes } = entitlements.overlays;
  const creator = effectiveCreator(stored.creator, entitlements);
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

/** Optional Creator blocks, each behind its own entitlement (independent of the others). */
const GATED_BLOCKS = [
  { key: "motion", entitlement: "motionEffects" },
  { key: "characterRotation", entitlement: "characterRotation" },
  { key: "brandFlag", entitlement: "brandFlag" },
] as const;

/**
 * The Creator block a renderer may use. Customization needs advancedCustomization; motion needs
 * motionEffects; rotation needs characterRotation (all independent). Without customization, a
 * kept block rides on neutral defaults, which render exactly like no customization. Same object
 * back when nothing is dropped.
 */
function effectiveCreator(
  stored: CreatorCustomization | undefined,
  entitlements: OverlayCustomizationEntitlement,
): CreatorCustomization | undefined {
  if (stored === undefined) return undefined;
  const ent = entitlements.overlays;
  const dropped = GATED_BLOCKS.filter((b) => stored[b.key] !== undefined && !ent[b.entitlement]);
  if (ent.advancedCustomization && dropped.length === 0) return stored;
  const base: CreatorCustomization = ent.advancedCustomization
    ? { ...stored }
    : { ...DEFAULT_CREATOR_CUSTOMIZATION };
  delete base.motion;
  delete base.characterRotation;
  delete base.brandFlag;
  let kept = false;
  for (const b of GATED_BLOCKS) {
    if (stored[b.key] !== undefined && ent[b.entitlement]) {
      kept = true;
      if (b.key === "motion") base.motion = stored.motion;
      else if (b.key === "characterRotation") base.characterRotation = stored.characterRotation;
      else base.brandFlag = stored.brandFlag;
    }
  }
  return ent.advancedCustomization || kept ? base : undefined;
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
  const { advancedCustomization, premiumThemes, motionEffects, characterRotation, brandFlag } =
    entitlements.overlays;
  // Customization, motion, rotation and the brand flag are merged independently: each comes from the request
  // only when the owner holds its entitlement, otherwise the stored value is kept untouched.
  const base = advancedCustomization ? incoming.creator : stored.creator;
  const motion = motionEffects ? incoming.creator?.motion : stored.creator?.motion;
  const rotation = characterRotation
    ? incoming.creator?.characterRotation
    : stored.creator?.characterRotation;
  const flag = brandFlag ? incoming.creator?.brandFlag : stored.creator?.brandFlag;
  let creator: CreatorCustomization | undefined;
  if (base !== undefined || motion !== undefined || rotation !== undefined || flag !== undefined) {
    creator = { ...(base ?? DEFAULT_CREATOR_CUSTOMIZATION) };
    delete creator.motion;
    delete creator.characterRotation;
    delete creator.brandFlag;
    if (motion !== undefined) creator.motion = motion;
    if (rotation !== undefined) creator.characterRotation = rotation;
    if (flag !== undefined) creator.brandFlag = flag;
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
