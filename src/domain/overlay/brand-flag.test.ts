import { describe, expect, it } from "vitest";
import {
  BRAND_FLAG_ANIMATIONS,
  BRAND_FLAG_COLORS,
  BRAND_FLAG_INTERVALS,
  BRAND_FLAG_LOGOS,
  BRAND_FLAG_MODES,
  BRAND_FLAG_POSITIONS,
  BRAND_FLAG_VISIBLE,
  DEFAULT_BRAND_FLAG,
  brandFlagDelayMs,
  brandFlagSchema,
  effectiveBrandAnimation,
  fullLockupLegible,
  fullLockupWordPx,
  integratedLogo,
  integratedSupportsFullLogo,
  interleaveTransition,
  isTimedBrandMode,
  parseBrandFlag,
  usesBrandSideSlot,
  type BrandFlag,
} from "./brand-flag";
import {
  OVERLAY_THEMES,
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig as parseAnyOverlayConfig,
  sessionConfigOf,
  type SessionOverlayConfig,
} from "./config";
import { THEME_REGISTRY } from "./themes";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  getEffectiveOverlayConfig,
  mergeOverlayConfigForSave,
  parseCreatorCustomization,
} from "./creator";
import { PLAN_ENTITLEMENTS } from "@/domain/entitlements/plans";
import { presetAppearanceSchema } from "./presets";

/** Session tests: parse and narrow (Phase 5.4B: the public parser returns any overlay kind). */
function parseOverlayConfig(raw: unknown): SessionOverlayConfig {
  const config = sessionConfigOf(parseAnyOverlayConfig(raw));
  if (!config) throw new Error("expected a Session config");
  return config;
}

const ON: BrandFlag = { ...DEFAULT_BRAND_FLAG, enabled: true };
const withFlag = (flag: BrandFlag = ON): SessionOverlayConfig => ({
  ...DEFAULT_OVERLAY_CONFIG,
  creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, brandFlag: flag },
});
const ent = (over: Partial<Record<string, boolean>> = {}) => ({
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
    brandFlag: false,
    ...over,
  },
});

describe("config (1–12)", () => {
  it("1. defaults: off, periodic tab on the right every 60 s for 3 s, slide, monogram, theme", () => {
    expect(DEFAULT_BRAND_FLAG).toEqual({
      enabled: false,
      mode: "timed-tab",
      position: "right",
      intervalSeconds: 60,
      visibleSeconds: 3,
      animation: "slide",
      logoVariant: "monogram",
      colorMode: "theme",
    });
  });

  it("2/4. strict writes: only the literal sets, no extra keys (no URLs, text, CSS)", () => {
    for (const bad of [
      { intervalSeconds: 45 },
      { visibleSeconds: 4 },
      { mode: "banner" },
      { position: "top" },
      { animation: "bounce" },
      { logoVariant: "custom" },
      { colorMode: "#ff0000" },
      { logoUrl: "https://example.com/logo.png" },
      { enabled: "yes" },
    ]) {
      expect(brandFlagSchema.safeParse({ ...ON, ...bad }).success).toBe(false);
    }
    expect(
      overlayConfigSchema.safeParse(withFlag({ ...ON, intervalSeconds: 45 as 30 })).success,
    ).toBe(false);
  });

  it("6–12. every option of every set is accepted", () => {
    const sets: Array<[keyof BrandFlag, readonly unknown[]]> = [
      ["mode", BRAND_FLAG_MODES],
      ["position", BRAND_FLAG_POSITIONS],
      ["intervalSeconds", BRAND_FLAG_INTERVALS],
      ["visibleSeconds", BRAND_FLAG_VISIBLE],
      ["animation", BRAND_FLAG_ANIMATIONS],
      ["logoVariant", BRAND_FLAG_LOGOS],
      ["colorMode", BRAND_FLAG_COLORS],
    ];
    for (const [key, values] of sets) {
      for (const v of values)
        expect(brandFlagSchema.safeParse({ ...ON, [key]: v }).success).toBe(true);
    }
    expect(BRAND_FLAG_INTERVALS).toEqual([30, 60, 120, 300]);
    expect(BRAND_FLAG_VISIBLE).toEqual([2, 3, 5]);
    expect(BRAND_FLAG_LOGOS).toEqual(["monogram", "full"]);
  });

  it("3/4. lenient reads: invalid fields fall back to safe defaults; junk ⇒ no block", () => {
    expect(
      parseBrandFlag({ enabled: true, intervalSeconds: 45, position: "top", logoUrl: "x" }),
    ).toEqual(ON);
    expect(parseBrandFlag("on")).toBeUndefined();
    expect(parseBrandFlag(null)).toBeUndefined();
    expect(parseBrandFlag([])).toBeUndefined();
  });

  it("5. old configurations (no block / Creator without it) parse unchanged; the Creator block survives a bad flag", () => {
    expect(parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG }).creator).toBeUndefined();
    const creator = parseCreatorCustomization({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      secondaryAccent: "#ff00aa",
    });
    expect(creator && "brandFlag" in creator).toBe(false);
    const withBad = parseCreatorCustomization({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      secondaryAccent: "#ff00aa",
      brandFlag: { enabled: true, mode: "banner" },
    });
    expect(withBad).toMatchObject({ secondaryAccent: "#ff00aa", brandFlag: ON });
  });
});

describe("schedule (timer semantics)", () => {
  it("intervalSeconds is the time between reveal STARTS; the first reveal waits a full interval", () => {
    const c = { ...ON, intervalSeconds: 60 as const, visibleSeconds: 3 as const };
    expect(brandFlagDelayMs(c, "hidden", true)).toBe(60_000);
    expect(brandFlagDelayMs(c, "shown", false)).toBe(3_000);
    expect(brandFlagDelayMs(c, "hidden", false)).toBe(57_000); // 3 visible + 57 hidden = 60
  });

  it("static badge and disabled flag schedule nothing", () => {
    expect(brandFlagDelayMs({ ...ON, mode: "static-badge" }, "hidden", true)).toBeNull();
    expect(brandFlagDelayMs(DEFAULT_BRAND_FLAG, "hidden", true)).toBeNull();
  });

  it("every interval is longer than every visible time (a hidden phase always exists)", () => {
    for (const i of BRAND_FLAG_INTERVALS)
      for (const v of BRAND_FLAG_VISIBLE) expect(i).toBeGreaterThan(v);
  });

  it("animations off / reduced motion ⇒ instant", () => {
    expect(effectiveBrandAnimation("slide", { animations: false, reducedMotion: false })).toBe(
      "instant",
    );
    expect(effectiveBrandAnimation("fade", { animations: true, reducedMotion: true })).toBe(
      "instant",
    );
    expect(effectiveBrandAnimation("fade", { animations: true, reducedMotion: false })).toBe(
      "fade",
    );
  });
});

describe("entitlements: stored vs effective (41–49)", () => {
  it("41–42. Creator Beta has it; Free doesn't; independent of motion and rotation", () => {
    expect(PLAN_ENTITLEMENTS.creator_beta.overlays.brandFlag).toBe(true);
    expect(PLAN_ENTITLEMENTS.free.overlays.brandFlag).toBe(false);
    expect(
      getEffectiveOverlayConfig(withFlag(), ent({ brandFlag: true })).creator?.brandFlag,
    ).toEqual(ON);
    // Motion + rotation without brandFlag ⇒ no flag.
    expect(
      getEffectiveOverlayConfig(withFlag(), ent({ motionEffects: true, characterRotation: true }))
        .creator?.brandFlag,
    ).toBeUndefined();
  });

  it("43/47. a forged Free request can neither add, change nor remove it (stored kept)", () => {
    const plain = { ...DEFAULT_OVERLAY_CONFIG };
    expect(mergeOverlayConfigForSave(plain, withFlag(), ent()).creator).toBeUndefined();
    const stored = withFlag({ ...ON, position: "left" });
    const forged = withFlag({ ...ON, mode: "static-badge" });
    expect(mergeOverlayConfigForSave(stored, forged, ent()).creator?.brandFlag).toEqual(
      stored.creator?.brandFlag,
    );
    const edit: SessionOverlayConfig = { ...stored, title: "FREE", creator: undefined };
    const merged = mergeOverlayConfigForSave<SessionOverlayConfig>(stored, edit, ent());
    expect(merged).toMatchObject({
      title: "FREE",
      creator: { brandFlag: stored.creator?.brandFlag },
    });
  });

  it("44–46/48. downgrade: effective (public payload) has no flag, stored keeps it; renewal restores", () => {
    const stored = withFlag({ ...ON, logoVariant: "full" });
    expect(getEffectiveOverlayConfig(stored, ent()).creator?.brandFlag).toBeUndefined();
    expect(stored.creator?.brandFlag?.logoVariant).toBe("full");
    expect(getEffectiveOverlayConfig(stored, ent({ brandFlag: true })).creator?.brandFlag).toEqual(
      stored.creator?.brandFlag,
    );
  });

  it("Creator saves take the request's flag", () => {
    const incoming = withFlag({ ...ON, intervalSeconds: 300 });
    expect(
      mergeOverlayConfigForSave(withFlag(), incoming, ent({ brandFlag: true })).creator?.brandFlag
        ?.intervalSeconds,
    ).toBe(300);
  });

  it("49. presets carry the flag inside the Creator block (statsScope still out)", () => {
    const parsed = presetAppearanceSchema.safeParse({
      ...Object.fromEntries(
        Object.keys(presetAppearanceSchema.shape).map((k) => [
          k,
          (DEFAULT_OVERLAY_CONFIG as Record<string, unknown>)[k],
        ]),
      ),
      creator: withFlag({ ...ON, position: "left" }).creator,
    });
    expect(parsed.success && parsed.data.creator?.brandFlag?.position).toBe("left");
    expect(Object.keys(presetAppearanceSchema.shape)).not.toContain("statsScope");
  });
});

describe("Phase 5.3C: integrated presentation (content-interleave)", () => {
  const IL: BrandFlag = {
    ...ON,
    mode: "content-interleave",
    animation: "fade",
    logoVariant: "full",
  };

  it("is a third presentation of the same block; strict writes accept it", () => {
    expect(BRAND_FLAG_MODES).toEqual(["timed-tab", "content-interleave", "static-badge"]);
    expect(brandFlagSchema.safeParse(IL).success).toBe(true);
    expect(brandFlagSchema.safeParse({ ...IL, mode: "interleave" }).success).toBe(false);
  });

  it("13. a stored Phase 5.3B config reads unchanged (timed-tab = side tab)", () => {
    const old = { ...DEFAULT_BRAND_FLAG, enabled: true, mode: "timed-tab", position: "left" };
    expect(parseBrandFlag(old)).toEqual(old);
    expect(usesBrandSideSlot("timed-tab")).toBe(true);
    expect(usesBrandSideSlot("static-badge")).toBe(true);
    expect(usesBrandSideSlot("content-interleave")).toBe(false);
  });

  it("shares the 5.3B schedule (interval between reveal starts; visible time)", () => {
    expect(isTimedBrandMode("content-interleave")).toBe(true);
    expect(isTimedBrandMode("static-badge")).toBe(false);
    const c = { ...IL, intervalSeconds: 60 as const, visibleSeconds: 3 as const };
    expect(brandFlagDelayMs(c, "hidden", true)).toBe(60_000);
    expect(brandFlagDelayMs(c, "shown", false)).toBe(3_000);
    expect(brandFlagDelayMs(c, "hidden", false)).toBe(57_000);
  });

  it("transition: fade or instant only (a stored slide fades); off / reduced motion ⇒ instant", () => {
    const on = { animations: true, reducedMotion: false };
    expect(interleaveTransition("fade", on)).toBe("fade");
    expect(interleaveTransition("slide", on)).toBe("fade");
    expect(interleaveTransition("instant", on)).toBe("instant");
    expect(interleaveTransition("fade", { animations: false, reducedMotion: false })).toBe(
      "instant",
    );
    expect(interleaveTransition("fade", { animations: true, reducedMotion: true })).toBe("instant");
  });

  it("15–18. same entitlement: Creator keeps it; Free effective has none; forged Free ignored; downgrade keeps, renewal restores", () => {
    expect(
      getEffectiveOverlayConfig(withFlag(IL), ent({ brandFlag: true })).creator?.brandFlag,
    ).toEqual(IL);
    expect(getEffectiveOverlayConfig(withFlag(IL), ent()).creator?.brandFlag).toBeUndefined();
    const stored = withFlag({ ...ON, mode: "timed-tab" });
    expect(mergeOverlayConfigForSave(stored, withFlag(IL), ent()).creator?.brandFlag?.mode).toBe(
      "timed-tab",
    );
    expect(
      mergeOverlayConfigForSave({ ...DEFAULT_OVERLAY_CONFIG }, withFlag(IL), ent()).creator,
    ).toBeUndefined();
    const kept = withFlag(IL);
    expect(getEffectiveOverlayConfig(kept, ent()).creator?.brandFlag).toBeUndefined();
    expect(kept.creator?.brandFlag).toEqual(IL);
    expect(getEffectiveOverlayConfig(kept, ent({ brandFlag: true })).creator?.brandFlag).toEqual(
      IL,
    );
  });

  it("14. presets carry the presentation", () => {
    const parsed = presetAppearanceSchema.safeParse({
      ...Object.fromEntries(
        Object.keys(presetAppearanceSchema.shape).map((k) => [
          k,
          (DEFAULT_OVERLAY_CONFIG as Record<string, unknown>)[k],
        ]),
      ),
      creator: withFlag(IL).creator,
    });
    expect(parsed.success && parsed.data.creator?.brandFlag?.mode).toBe("content-interleave");
  });
});

describe("Phase 5.3C: full-logo readability floor and theme capabilities", () => {
  it("rendered lockup words = min(h, w / (760/124)) · 27/124 (width-bound in narrow slots)", () => {
    expect(fullLockupWordPx({ width: 760, height: 124 })).toBeCloseTo(27);
    expect(fullLockupWordPx({ width: 111.3, height: 59.2 })).toBeCloseTo(3.95, 1); // width-bound
    expect(fullLockupWordPx({ width: 2000, height: 20 })).toBeCloseTo(4.35, 1); // height-bound
  });

  it("measured real slots at 800×180 all fail the floor (theme's own smallest text)", () => {
    // Production-browser measurements (docs/creator-overlays.md): slot box and min label px.
    const measured: Array<[string, { width: number; height: number }, number]> = [
      ["broadcast (whole segment)", { width: 111.3, height: 59.2 }, 9.876],
      ["broadcast (chips only)", { width: 74.8, height: 14.2 }, 9.876],
      ["competitive", { width: 558.8, height: 17.3 }, 12],
      ["fighter (whole block)", { width: 163.5, height: 82.2 }, 9.1],
      ["rank-card", { width: 198.4, height: 15.8 }, 10.944],
      ["prestige", { width: 92.6, height: 14.6 }, 10.116],
      ["minimal", { width: 96.7, height: 18.4 }, 9.1],
    ];
    for (const [, box, floor] of measured) expect(fullLockupLegible(box, floor)).toBe(false);
    // What legibility would take in Broadcast: a ~280 px wide box at its 9.9 px labels.
    expect(fullLockupLegible({ width: 280, height: 59.2 }, 9.876)).toBe(true);
  });

  it("every theme declares its slot and only legible logos (all monogram-only today)", () => {
    for (const theme of OVERLAY_THEMES) {
      const cap = THEME_REGISTRY[theme].integratedBranding;
      expect(cap.logos).toEqual(["monogram"]);
      expect(integratedSupportsFullLogo(theme)).toBe(false);
      expect(integratedLogo(theme, "full")).toBe("monogram");
      expect(integratedLogo(theme, "monogram")).toBe("monogram");
    }
    expect(THEME_REGISTRY.broadcast.integratedBranding.slot).toBe("recent-results-segment");
    expect(THEME_REGISTRY.fighter.integratedBranding.slot).toBe("recent-results-segment");
    expect(THEME_REGISTRY.minimal.integratedBranding.slot).toBe("recent-results");
  });
});
