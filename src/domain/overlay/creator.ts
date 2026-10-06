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
 *  - STORED config keeps `creator` forever (downgrade never deletes); the EFFECTIVE config used
 *    by every renderer (dashboard preview and OBS) drops it unless the owner is entitled.
 */
import { z } from "zod";
import { FONT_IDS } from "./fonts";

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
  const parsed = creatorCustomizationSchema.safeParse({
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    ...obj,
    show: { ...DEFAULT_CREATOR_CUSTOMIZATION.show, ...show },
  });
  return parsed.success ? parsed.data : undefined;
}

/** The only Creator entitlement overlays need. */
export interface OverlayCustomizationEntitlement {
  overlays: { advancedCustomization: boolean };
}

/**
 * EFFECTIVE config for rendering (dashboard preview, OBS page, /state, SSE). Pure: never
 * mutates the stored config. Not entitled ⇒ the Creator block is ignored and the theme's own
 * look (the Free fallback) is rendered; the stored block is kept for when access returns.
 */
export function getEffectiveOverlayConfig<C extends { creator?: CreatorCustomization }>(
  stored: C,
  entitlements: OverlayCustomizationEntitlement,
): C {
  if (entitlements.overlays.advancedCustomization || stored.creator === undefined) return stored;
  const base = { ...stored };
  delete base.creator;
  return base;
}

/**
 * Config to PERSIST when the owner saves. Base options are always taken from the request.
 * The Creator block is taken from the request only if the owner is entitled; otherwise the
 * previously stored block is kept untouched (a Free save can neither add, change nor delete
 * it — downgrade never deletes, and crafted requests can't unlock anything).
 */
export function mergeOverlayConfigForSave<C extends { creator?: CreatorCustomization }>(
  stored: C,
  incoming: C,
  entitlements: OverlayCustomizationEntitlement,
): C {
  const creator = entitlements.overlays.advancedCustomization ? incoming.creator : stored.creator;
  const merged = { ...incoming };
  delete merged.creator;
  return creator === undefined ? merged : { ...merged, creator };
}
