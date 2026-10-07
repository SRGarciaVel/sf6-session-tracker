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
import { DEFAULT_CREATOR_MOTION } from "./motion";
import { appearanceFromConfig, presetAppearanceSchema } from "./presets";
import { CREATOR_THEME_IDS, FREE_THEME_IDS, THEME_REGISTRY } from "./themes";
import { DEFAULT_THEME_VARIANTS } from "./variants";

const FREE = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
    brandFlag: false,
  },
};
const CREATOR = {
  overlays: {
    advancedCustomization: true,
    premiumThemes: true,
    motionEffects: true,
    characterRotation: true,
    brandFlag: true,
  },
};
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

describe("Phase 4.5: premium themes (stored vs effective)", () => {
  const rankCard: OverlayConfig = {
    ...DEFAULT_OVERLAY_CONFIG,
    theme: "rank-card",
    preset: "detailed",
    variants: {
      ...DEFAULT_THEME_VARIANTS,
      "rank-card": { ...DEFAULT_THEME_VARIANTS["rank-card"], glow: "strong" },
    },
  };

  it("registry: Free themes are Free with all canvases; Creator themes fall back to a Free one", () => {
    for (const id of FREE_THEME_IDS) {
      expect(THEME_REGISTRY[id]).toMatchObject({ tier: "free", fallback: id });
      expect(THEME_REGISTRY[id].canvases).toEqual(["compact", "standard", "detailed"]);
    }
    expect(THEME_REGISTRY["rank-card"].fallback).toBe("competitive");
    expect(THEME_REGISTRY.broadcast.fallback).toBe("minimal");
    expect(THEME_REGISTRY.prestige.fallback).toBe("fighter");
    for (const id of CREATOR_THEME_IDS) {
      expect(THEME_REGISTRY[id].tier).toBe("creator");
      expect(FREE_THEME_IDS).toContain(THEME_REGISTRY[id].fallback);
    }
  });

  it("entitled ⇒ the premium theme and its variants render", () => {
    const eff = getEffectiveOverlayConfig(rankCard, CREATOR);
    expect(eff.theme).toBe("rank-card");
    expect(eff.variants?.["rank-card"].glow).toBe("strong");
  });

  it("not entitled ⇒ deterministic Free fallback, no variants, stored NOT mutated", () => {
    const snapshot = structuredClone(rankCard);
    const eff = getEffectiveOverlayConfig(rankCard, FREE);
    expect(eff.theme).toBe("competitive");
    expect(eff.variants).toBeUndefined();
    expect(eff.preset).toBe("detailed");
    expect(rankCard).toEqual(snapshot);
    expect(getEffectiveOverlayConfig({ ...rankCard, theme: "broadcast" }, FREE).theme).toBe(
      "minimal",
    );
    expect(getEffectiveOverlayConfig({ ...rankCard, theme: "prestige" }, FREE).theme).toBe(
      "fighter",
    );
  });

  it("entitled premium theme on an unsupported canvas ⇒ its first supported canvas", () => {
    const eff = getEffectiveOverlayConfig({ ...rankCard, preset: "compact" }, CREATOR);
    expect(eff.preset).toBe("standard");
  });

  it("Free themes ignore stored variants (identical to pre-4.5 output)", () => {
    const eff = getEffectiveOverlayConfig({ ...rankCard, theme: "fighter" }, CREATOR);
    expect(eff.variants).toBeUndefined();
    expect(eff.theme).toBe("fighter");
  });

  it("crafted Free save with a never-stored premium theme does not install it", () => {
    const merged = mergeOverlayConfigForSave(
      DEFAULT_OVERLAY_CONFIG,
      { ...DEFAULT_OVERLAY_CONFIG, theme: "prestige", variants: DEFAULT_THEME_VARIANTS },
      FREE,
    );
    expect(merged.theme).toBe(DEFAULT_OVERLAY_CONFIG.theme);
    expect(merged.variants).toBeUndefined();
  });

  it("Free save after downgrade keeps the stored premium theme and variants", () => {
    const merged = mergeOverlayConfigForSave(
      rankCard,
      { ...rankCard, title: "GG", variants: undefined },
      FREE,
    );
    expect(merged.title).toBe("GG");
    expect(merged.theme).toBe("rank-card");
    expect(merged.variants).toEqual(rankCard.variants);
    // …and cannot swap it for ANOTHER premium theme.
    expect(
      mergeOverlayConfigForSave(rankCard, { ...rankCard, theme: "prestige" }, FREE).theme,
    ).toBe("rank-card");
  });

  it("entitled save installs premium themes and normalizes the canvas", () => {
    const merged = mergeOverlayConfigForSave(
      DEFAULT_OVERLAY_CONFIG,
      { ...rankCard, preset: "compact" },
      CREATOR,
    );
    expect(merged.theme).toBe("rank-card");
    expect(merged.preset).toBe("standard");
    expect(merged.variants?.["rank-card"].glow).toBe("strong");
  });

  it("variants are strict: unknown keys / values are rejected; stored junk falls back to defaults", () => {
    const bad = (variants: unknown) =>
      overlayConfigSchema.safeParse({ ...rankCard, variants }).success;
    expect(bad(rankCard.variants)).toBe(true);
    expect(
      bad({
        ...DEFAULT_THEME_VARIANTS,
        prestige: { ...DEFAULT_THEME_VARIANTS.prestige, css: "x" },
      }),
    ).toBe(false);
    expect(
      bad({
        ...DEFAULT_THEME_VARIANTS,
        broadcast: { ...DEFAULT_THEME_VARIANTS.broadcast, accent: "url(x)" },
      }),
    ).toBe(false);
    expect(bad({ ...DEFAULT_THEME_VARIANTS, customCss: "body{}" })).toBe(false);
    const read = parseOverlayConfig({
      ...rankCard,
      variants: { "rank-card": { glow: "javascript:x" }, broadcast: "nope" },
    });
    expect(read.variants).toEqual({
      ...DEFAULT_THEME_VARIANTS,
      "rank-card": DEFAULT_THEME_VARIANTS["rank-card"],
    });
    expect(read.theme).toBe("rank-card");
  });

  it("unknown stored theme ⇒ defaults (never a crash or an unregistered theme)", () => {
    expect(parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, theme: "neon" }).theme).toBe(
      DEFAULT_OVERLAY_CONFIG.theme,
    );
  });
});

describe("Phase 5.0: Creator motion (overlays.motionEffects)", () => {
  const motion = {
    ...DEFAULT_CREATOR_MOTION,
    updateStyle: "impact" as const,
    intensity: "strong" as const,
  };
  const withMotion: OverlayConfig = {
    ...DEFAULT_OVERLAY_CONFIG,
    creator: { ...custom, motion },
  };
  const ALL = {
    overlays: {
      advancedCustomization: true,
      premiumThemes: true,
      motionEffects: true,
      characterRotation: true,
      brandFlag: true,
    },
  };
  const NONE = {
    overlays: {
      advancedCustomization: false,
      premiumThemes: false,
      motionEffects: false,
      characterRotation: false,
      brandFlag: false,
    },
  };
  const STYLE_ONLY = {
    overlays: {
      advancedCustomization: true,
      premiumThemes: true,
      motionEffects: false,
      characterRotation: false,
      brandFlag: false,
    },
  };
  const MOTION_ONLY = {
    overlays: {
      advancedCustomization: false,
      premiumThemes: false,
      motionEffects: true,
      characterRotation: true,
      brandFlag: true,
    },
  };

  it("entitled ⇒ motion renders; Free ⇒ effective config has no motion; stored untouched", () => {
    expect(getEffectiveOverlayConfig(withMotion, ALL).creator?.motion).toEqual(motion);
    const snapshot = structuredClone(withMotion);
    expect(getEffectiveOverlayConfig(withMotion, NONE).creator).toBeUndefined();
    expect(withMotion).toEqual(snapshot);
  });

  it("independent gates: style without motion, motion without style (neutral customization)", () => {
    const styleOnly = getEffectiveOverlayConfig(withMotion, STYLE_ONLY).creator;
    expect(styleOnly?.motion).toBeUndefined();
    expect(styleOnly?.secondaryAccent).toBe(custom.secondaryAccent);
    const motionOnly = getEffectiveOverlayConfig(withMotion, MOTION_ONLY).creator;
    expect(motionOnly).toEqual({ ...DEFAULT_CREATOR_CUSTOMIZATION, motion });
  });

  it("downgrade → Free saves a base edit → motion still stored → renewal restores it", () => {
    const freeEdit = { ...withMotion, title: "FREE", creator: undefined };
    const saved = mergeOverlayConfigForSave(withMotion, freeEdit, NONE);
    expect(saved.title).toBe("FREE");
    expect(saved.creator?.motion).toEqual(motion);
    expect(saved.creator?.secondaryAccent).toBe(custom.secondaryAccent);
    expect(getEffectiveOverlayConfig(saved, ALL).creator?.motion).toEqual(motion);
  });

  it("crafted Free request cannot add or change motion", () => {
    const crafted = {
      ...DEFAULT_OVERLAY_CONFIG,
      creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion },
    };
    expect(
      mergeOverlayConfigForSave(DEFAULT_OVERLAY_CONFIG, crafted, NONE).creator,
    ).toBeUndefined();
    const tampered = {
      ...withMotion,
      creator: { ...custom, motion: { ...motion, intensity: "subtle" as const } },
    };
    expect(mergeOverlayConfigForSave(withMotion, tampered, NONE).creator?.motion).toEqual(motion);
  });

  it("entitled save sets and clears motion; style-only owner keeps stored motion", () => {
    const off = { ...withMotion, creator: { ...custom } };
    expect(mergeOverlayConfigForSave(withMotion, off, ALL).creator?.motion).toBeUndefined();
    const changed = {
      ...withMotion,
      creator: { ...custom, motion: { ...motion, accentMotion: "sweep" as const } },
    };
    expect(mergeOverlayConfigForSave(withMotion, changed, STYLE_ONLY).creator?.motion).toEqual(
      motion,
    );
    expect(mergeOverlayConfigForSave(DEFAULT_OVERLAY_CONFIG, changed, MOTION_ONLY).creator).toEqual(
      {
        ...DEFAULT_CREATOR_CUSTOMIZATION,
        motion: changed.creator.motion,
      },
    );
  });

  it("stored config without motion reads exactly as before; junk motion is dropped alone", () => {
    expect(parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, creator: custom }).creator).toEqual(
      custom,
    );
    const junk = parseOverlayConfig({
      ...DEFAULT_OVERLAY_CONFIG,
      creator: { ...custom, motion: { updateStyle: "x" } },
    });
    expect(junk.creator).toEqual(custom);
  });

  it("presets carry motion with the rest of the appearance", () => {
    expect(appearanceFromConfig(withMotion).creator?.motion).toEqual(motion);
    expect(presetAppearanceSchema.safeParse(appearanceFromConfig(withMotion)).success).toBe(true);
  });
});
