import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig,
  type OverlayConfig,
} from "./config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  creatorCustomizationSchema,
  getEffectiveOverlayConfig,
  mergeOverlayConfigForSave,
  type CreatorCustomization,
} from "./creator";

const FREE = { overlays: { advancedCustomization: false } };
const CREATOR = { overlays: { advancedCustomization: true } };
const custom: CreatorCustomization = {
  secondaryAccent: "#ffb000",
  numberFont: "jetbrains-mono",
  numberScale: 1.15,
  show: { labels: false, units: true, characterName: false, decorations: true },
};
const withCreator: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG, creator: custom };

describe("effective overlay config", () => {
  it("free + no creator block ⇒ exactly the stored config (pre-Phase-4 output)", () => {
    expect(getEffectiveOverlayConfig(DEFAULT_OVERLAY_CONFIG, FREE)).toBe(DEFAULT_OVERLAY_CONFIG);
  });

  it("creator + customization ⇒ applied", () => {
    expect(getEffectiveOverlayConfig(withCreator, CREATOR).creator).toEqual(custom);
  });

  it("free + stored customization ⇒ ignored, stored config NOT mutated; creator again ⇒ back", () => {
    const snapshot = structuredClone(withCreator);
    const free = getEffectiveOverlayConfig(withCreator, FREE);
    expect(free.creator).toBeUndefined();
    expect({ ...free }).toEqual({ ...DEFAULT_OVERLAY_CONFIG }); // theme's own look
    expect(withCreator).toEqual(snapshot);
    expect(getEffectiveOverlayConfig(withCreator, CREATOR).creator).toEqual(custom);
  });
});

describe("save merge (server-side enforcement)", () => {
  it("entitled owner: saves, changes and resets the creator block", () => {
    const changed = { ...withCreator, creator: { ...custom, numberScale: 0.9 } };
    expect(mergeOverlayConfigForSave(withCreator, changed, CREATOR).creator?.numberScale).toBe(0.9);
    const reset = { ...DEFAULT_OVERLAY_CONFIG };
    expect(mergeOverlayConfigForSave(withCreator, reset, CREATOR).creator).toBeUndefined();
  });

  it("free owner: base options saved, creator block kept untouched (downgrade-safe)", () => {
    const freeEdit = {
      ...DEFAULT_OVERLAY_CONFIG,
      locale: "en" as const,
      theme: "fighter" as const,
    };
    const merged = mergeOverlayConfigForSave(withCreator, freeEdit, FREE);
    expect(merged.locale).toBe("en");
    expect(merged.theme).toBe("fighter");
    expect(merged.creator).toEqual(custom);
  });

  it("free owner: a crafted request can neither add nor change creator values", () => {
    const crafted = { ...DEFAULT_OVERLAY_CONFIG, creator: custom };
    expect(
      mergeOverlayConfigForSave(DEFAULT_OVERLAY_CONFIG, crafted, FREE).creator,
    ).toBeUndefined();
    const tampered = { ...withCreator, creator: { ...custom, secondaryAccent: "#000000" } };
    expect(mergeOverlayConfigForSave(withCreator, tampered, FREE).creator).toEqual(custom);
  });
});

describe("validation (typed, bounded, no free-form CSS)", () => {
  const parse = (creator: unknown) => creatorCustomizationSchema.safeParse(creator).success;
  it("accepts the defaults and a full customization", () => {
    expect(parse(DEFAULT_CREATOR_CUSTOMIZATION)).toBe(true);
    expect(parse(custom)).toBe(true);
  });
  it("rejects malformed colors and CSS/URL payloads", () => {
    for (const secondaryAccent of [
      "red",
      "#fff",
      "#ff00ff;background:url(x)",
      "url(javascript:alert(1))",
      "var(--x)",
      "#GGGGGG",
    ]) {
      expect(parse({ ...custom, secondaryAccent }), secondaryAccent).toBe(false);
    }
  });
  it("rejects out-of-range scale, unknown fonts and unknown keys", () => {
    expect(parse({ ...custom, numberScale: 0.84 })).toBe(false);
    expect(parse({ ...custom, numberScale: 1.26 })).toBe(false);
    expect(parse({ ...custom, numberFont: "Comic Sans" })).toBe(false);
    expect(parse({ ...custom, customCss: "body{}" })).toBe(false);
    expect(parse({ ...custom, show: { ...custom.show, everything: false } })).toBe(false);
  });
  it("the full overlay schema validates the creator block too", () => {
    expect(overlayConfigSchema.safeParse(withCreator).success).toBe(true);
    expect(
      overlayConfigSchema.safeParse({ ...withCreator, creator: { ...custom, numberScale: 9 } })
        .success,
    ).toBe(false);
  });
});

describe("lenient stored read", () => {
  it("old configs (no creator) read exactly as before", () => {
    expect(parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG })).toEqual(DEFAULT_OVERLAY_CONFIG);
  });
  it("a valid stored block is kept; a broken one is dropped without losing the overlay", () => {
    expect(
      parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, theme: "fighter", creator: custom }),
    ).toMatchObject({
      theme: "fighter",
      creator: custom,
    });
    const broken = parseOverlayConfig({
      ...DEFAULT_OVERLAY_CONFIG,
      theme: "fighter",
      creator: { secondaryAccent: "javascript:x" },
    });
    expect(broken.theme).toBe("fighter");
    expect(broken.creator).toBeUndefined();
  });
  it("partial stored block is completed with neutral defaults", () => {
    expect(
      parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, creator: { numberScale: 1.1 } }).creator,
    ).toEqual({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      numberScale: 1.1,
    });
  });
});
