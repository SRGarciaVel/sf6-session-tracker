/**
 * Creator presets (Phase 4.5, docs/creator-presets.md): saved, reusable overlay APPEARANCE.
 *
 * A preset holds only how an overlay looks — theme, canvas, colors, typography, frame, layout,
 * which stats are visible (booleans), the Creator block and theme variants. Never data: no
 * session/W-L/rating/rank/streak values, no player, CFN, token, title text, language or rating
 * character, and never the plan. The schema is strict (unknown keys rejected) and bounded.
 *
 * Phase 5.4A: presets are SESSION overlay presets. A preset carries the kind it was saved from;
 * legacy presets (no kind) are Session presets. A preset only applies to an overlay of the same
 * kind — never across kinds (no migration: the kind lives in the preset JSON).
 */
import { z } from "zod";
import { sessionOverlayConfigSchema, type SessionOverlayConfig } from "./config";
import type { OverlayKind } from "./kind";

export const PRESET_NAME_MAX = 40;
/** Technical safety limit per account (not a commercial policy). */
export const PRESETS_PER_ACCOUNT_MAX = 20;
/** Serialized appearance is ~1.5 KB; anything near this is not a real preset. */
export const PRESET_CONFIG_MAX_BYTES = 8192;

export const presetAppearanceSchema = sessionOverlayConfigSchema
  .pick({
    // Optional: presets saved before Phase 5.4A have no kind (⇒ "session").
    kind: true,
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
export function appearanceFromConfig(config: SessionOverlayConfig): PresetAppearance {
  const {
    kind,
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
    kind,
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
  config: SessionOverlayConfig,
  preset: PresetAppearance,
): SessionOverlayConfig {
  const base = { ...config };
  delete base.creator;
  delete base.variants;
  // The overlay's kind always wins (callers check compatibility first: presetAppliesTo).
  return { ...base, ...preset, kind: config.kind };
}

/** Kind a preset was saved from: legacy presets (no kind) are Session presets. */
export function presetKindOf(preset: PresetAppearance): OverlayKind {
  return preset.kind ?? "session";
}

/** A preset applies only to an overlay of the same (known) kind. */
export function presetAppliesTo(
  preset: PresetAppearance,
  overlayKind: OverlayKind | null,
): boolean {
  return overlayKind !== null && presetKindOf(preset) === overlayKind;
}

/** Lenient read of a stored preset; unusable ⇒ null (listed as broken, never applied). */
export function parsePresetAppearance(raw: unknown): PresetAppearance | null {
  const parsed = presetAppearanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
