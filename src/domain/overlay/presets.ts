/**
 * Creator presets (Phase 4.5, docs/creator-presets.md): saved, reusable overlay APPEARANCE.
 *
 * A preset holds only how an overlay looks — theme, canvas, colors, typography, frame, layout,
 * which stats are visible (booleans), the Creator block and theme variants. Never data: no
 * session/W-L/rating/rank/streak values, no player, CFN, token, title text, language or rating
 * character, and never the plan. The schema is strict (unknown keys rejected) and bounded.
 */
import { z } from "zod";
import { overlayConfigSchema, type OverlayConfig } from "./config";

export const PRESET_NAME_MAX = 40;
/** Technical safety limit per account (not a commercial policy). */
export const PRESETS_PER_ACCOUNT_MAX = 20;
/** Serialized appearance is ~1.5 KB; anything near this is not a real preset. */
export const PRESET_CONFIG_MAX_BYTES = 8192;

export const presetAppearanceSchema = overlayConfigSchema
  .pick({
    theme: true,
    preset: true,
    fields: true,
    showTitle: true,
    font: true,
    textColor: true,
    mutedColor: true,
    accentColor: true,
    winColor: true,
    lossColor: true,
    backgroundColor: true,
    backgroundOpacity: true,
    borderEnabled: true,
    borderColor: true,
    borderWidth: true,
    borderRadius: true,
    scale: true,
    spacing: true,
    align: true,
    animations: true,
    creator: true,
    variants: true,
  })
  .strict();
export type PresetAppearance = z.infer<typeof presetAppearanceSchema>;

export const presetNameSchema = z.string().trim().min(1).max(PRESET_NAME_MAX);

/** The appearance part of an overlay config (what "save as preset" stores). */
export function appearanceFromConfig(config: OverlayConfig): PresetAppearance {
  const {
    theme,
    preset,
    fields,
    showTitle,
    font,
    textColor,
    mutedColor,
    accentColor,
    winColor,
    lossColor,
    backgroundColor,
    backgroundOpacity,
    borderEnabled,
    borderColor,
    borderWidth,
    borderRadius,
    scale,
    spacing,
    align,
    animations,
    creator,
    variants,
  } = config;
  return {
    theme,
    preset,
    fields,
    showTitle,
    font,
    textColor,
    mutedColor,
    accentColor,
    winColor,
    lossColor,
    backgroundColor,
    backgroundOpacity,
    borderEnabled,
    borderColor,
    borderWidth,
    borderRadius,
    scale,
    spacing,
    align,
    animations,
    ...(creator === undefined ? {} : { creator }),
    ...(variants === undefined ? {} : { variants }),
  };
}

/**
 * Overlay config after applying a preset: appearance from the preset, everything else (title,
 * language, rating character) from the overlay. A preset without a Creator block / variants
 * removes them (it is a complete look). The result still goes through the owner's save rules.
 */
export function applyPresetToConfig(
  config: OverlayConfig,
  preset: PresetAppearance,
): OverlayConfig {
  const base = { ...config };
  delete base.creator;
  delete base.variants;
  return { ...base, ...preset };
}

/** Lenient read of a stored preset; unusable ⇒ null (listed as broken, never applied). */
export function parsePresetAppearance(raw: unknown): PresetAppearance | null {
  const parsed = presetAppearanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
