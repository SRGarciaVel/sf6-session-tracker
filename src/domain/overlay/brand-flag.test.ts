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
  parseBrandFlag,
  type BrandFlag,
} from "./brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig,
  type OverlayConfig,
} from "./config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  getEffectiveOverlayConfig,
  mergeOverlayConfigForSave,
  parseCreatorCustomization,
} from "./creator";
import { PLAN_ENTITLEMENTS } from "@/domain/entitlements/plans";
import { presetAppearanceSchema } from "./presets";

const ON: BrandFlag = { ...DEFAULT_BRAND_FLAG, enabled: true };
const withFlag = (flag: BrandFlag = ON): OverlayConfig => ({
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
    const edit: OverlayConfig = { ...stored, title: "FREE", creator: undefined };
    const merged = mergeOverlayConfigForSave<OverlayConfig>(stored, edit, ent());
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
