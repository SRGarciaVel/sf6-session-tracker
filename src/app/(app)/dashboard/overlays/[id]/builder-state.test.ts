import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_FIELDS,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_THEME_VARIANTS } from "@/domain/overlay/variants";
import {
  EDITOR_TABS,
  FIELD_GROUPS,
  canonicalJson,
  isDirty,
  patchCreator,
  setAllFields,
  stepZoom,
  themeDefault,
} from "./builder-state";

const base: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG };
const snap = (config: OverlayConfig, name = "Overlay") => ({ name, config });

describe("dirty state", () => {
  it("is false initially and ignores key order and undefined members", () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as OverlayConfig;
    expect(isDirty(snap(base), snap(reordered))).toBe(false);
    expect(isDirty(snap(base), snap({ ...base, creator: undefined }))).toBe(false);
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("is true after an edit (config or name) and false again after saving that state", () => {
    const edited = { ...base, title: "RANKED" };
    expect(isDirty(snap(base), snap(edited))).toBe(true);
    expect(isDirty(snap(base), snap(base, "Renamed"))).toBe(true);
    // "save" = the saved snapshot becomes the current state
    expect(isDirty(snap(edited), snap(edited))).toBe(false);
  });
});

describe("Free save safety (stored Creator state survives base edits)", () => {
  it("base edits never drop a stored premium theme, variants or Creator block", () => {
    const stored: OverlayConfig = {
      ...applyThemeDefaults(base, "rank-card"),
      variants: DEFAULT_THEME_VARIANTS,
      creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, numberScale: 1.2 },
    };
    const edits: Array<(c: OverlayConfig) => OverlayConfig> = [
      (c) => ({ ...c, title: "GG" }),
      (c) => ({ ...c, locale: "en" }),
      (c) => ({ ...c, textColor: "#ffffff" }),
      (c) => setAllFields(c, false),
    ];
    for (const edit of edits) {
      const next = edit(stored);
      expect(next.theme).toBe("rank-card");
      expect(next.variants).toEqual(stored.variants);
      expect(next.creator).toEqual(stored.creator);
    }
  });
});

describe("helpers", () => {
  it("stat groups cover every field exactly once", () => {
    const all = FIELD_GROUPS.flatMap((g) => g.fields);
    expect([...all].sort()).toEqual([...OVERLAY_FIELDS].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("show/hide all only touch stat toggles", () => {
    const hidden = setAllFields(base, false);
    expect(Object.values(hidden.fields).every((v) => !v)).toBe(true);
    expect({ ...hidden, fields: base.fields }).toEqual(base);
  });

  it("colour reset uses the theme's own defaults (existing resolver)", () => {
    const fighter = applyThemeDefaults(base, "fighter");
    expect(themeDefault({ ...fighter, accentColor: "#123456" }, "accentColor")).toBe(
      fighter.accentColor,
    );
    expect(themeDefault(base, "textColor")).toBe(base.textColor);
  });

  it("first Creator edit creates the block with neutral defaults", () => {
    expect(patchCreator(base, { numberScale: 1.1 }).creator).toEqual({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      numberScale: 1.1,
    });
  });

  it("zoom steps from fit to fixed levels and back", () => {
    expect(stepZoom(null, 0.8, 1)).toBe(1);
    expect(stepZoom(null, 0.8, -1)).toBe(0.75);
    expect(stepZoom(1.5, 1, 1)).toBe(1.5);
    expect(stepZoom(0.5, 1, -1)).toBe(0.5);
  });

  it("tabs", () => {
    expect(EDITOR_TABS).toEqual(["appearance", "content", "style", "creator"]);
  });
});
