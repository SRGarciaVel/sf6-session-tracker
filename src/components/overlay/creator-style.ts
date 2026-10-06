/**
 * Renderer hooks for Creator Beta customization (domain/overlay/creator.ts). Receives the
 * EFFECTIVE config's `creator` block: undefined for non-entitled owners, so the Free render is
 * untouched. Only non-neutral values emit classes/variables; every CSS rule they enable lives
 * under `.ov-c-*` in overlay.css (CEF-safe: plain custom properties, no :has/color-mix).
 */
import type { CreatorCustomization } from "@/domain/overlay/creator";

export function creatorClassNames(creator: CreatorCustomization | undefined): string[] {
  if (!creator) return [];
  const cls: string[] = [];
  if (creator.secondaryAccent) cls.push("ov-c-secondary");
  if (creator.numberFont) cls.push("ov-c-numfont");
  if (creator.numberScale !== 1) cls.push("ov-c-numscale");
  if (!creator.show.labels) cls.push("ov-c-hide-labels");
  if (!creator.show.units) cls.push("ov-c-hide-units");
  if (!creator.show.characterName) cls.push("ov-c-hide-char");
  if (!creator.show.decorations) cls.push("ov-c-hide-deco");
  return cls;
}

export function creatorCssVars(
  creator: CreatorCustomization | undefined,
): Record<`--${string}`, string> {
  if (!creator) return {};
  const vars: Record<`--${string}`, string> = {};
  // Values are schema-validated (#rrggbb, enum, bounded number): no free-form CSS reaches here.
  if (creator.secondaryAccent) vars["--ov-secondary"] = creator.secondaryAccent;
  if (creator.numberFont) vars["--ov-num-font"] = `var(--ovf-${creator.numberFont})`;
  if (creator.numberScale !== 1) vars["--ov-num-scale"] = String(creator.numberScale);
  return vars;
}
