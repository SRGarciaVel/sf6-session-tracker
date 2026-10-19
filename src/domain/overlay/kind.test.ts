/**
 * Phase 5.4A — overlay kind foundation: legacy configs (no kind) ARE Session overlays, the kind is
 * immutable, unknown kinds fail safe, and Session presets never cross kinds.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_FLAG } from "./brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  DEFAULT_SESSION_OVERLAY_CONFIG,
  applyThemeDefaults,
  defaultOverlayConfigForKind,
  overlayConfigSchema,
  overlayReadout,
  parseOverlayConfig,
  type OverlayConfig,
} from "./config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  getEffectiveOverlayConfig,
  mergeOverlayConfigForSave,
} from "./creator";
import {
  CREATABLE_OVERLAY_KINDS,
  OVERLAY_KINDS,
  checkOverlayKindEdit,
  isCreatableOverlayKind,
  storedOverlayKind,
} from "./kind";
import { DEFAULT_CREATOR_MOTION } from "./motion";
import {
  appearanceFromConfig,
  applyPresetToConfig,
  parsePresetAppearance,
  presetAppliesTo,
  presetKindOf,
} from "./presets";
import { DEFAULT_CHARACTER_ROTATION } from "./rotation";

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

/** A stored row as the DB holds it before 5.4A: no `kind`. */
function legacy(config: OverlayConfig): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...config };
  delete raw.kind;
  return raw;
}

const creatorConfig: OverlayConfig = {
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "rank-card"),
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    secondaryAccent: "#ff2e93",
    motion: DEFAULT_CREATOR_MOTION,
    characterRotation: { ...DEFAULT_CHARACTER_ROTATION, enabled: true },
    brandFlag: { ...DEFAULT_BRAND_FLAG, enabled: true },
  },
};

describe("kinds", () => {
  it("session is the only creatable kind; rank-progress is reserved", () => {
    expect(OVERLAY_KINDS).toEqual(["session", "rank-progress"]);
    expect(CREATABLE_OVERLAY_KINDS).toEqual(["session"]);
    expect(isCreatableOverlayKind("session")).toBe(true);
    expect(isCreatableOverlayKind("rank-progress")).toBe(false);
    expect(isCreatableOverlayKind("evil-widget")).toBe(false);
  });

  it("stored kind: missing ⇒ session (legacy); known ⇒ itself; anything else ⇒ null", () => {
    expect(storedOverlayKind({ theme: "minimal" })).toBe("session");
    expect(storedOverlayKind({ kind: "session" })).toBe("session");
    expect(storedOverlayKind({ kind: "rank-progress" })).toBe("rank-progress");
    expect(storedOverlayKind({ kind: "evil-widget" })).toBeNull();
    expect(storedOverlayKind({ kind: 7 })).toBeNull();
    for (const raw of [null, undefined, "x", 3, [], [{ kind: "session" }]]) {
      expect(storedOverlayKind(raw)).toBeNull();
    }
  });
});

describe("parseOverlayConfig (single public parser)", () => {
  it("1/2. legacy config without kind ≡ explicit kind: session", () => {
    for (const theme of ["minimal", "competitive", "fighter", "broadcast"] as const) {
      const cfg = applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme);
      const fromLegacy = parseOverlayConfig(legacy(cfg));
      const fromExplicit = parseOverlayConfig({ ...legacy(cfg), kind: "session" });
      expect(fromLegacy).toEqual(fromExplicit);
      expect(fromLegacy.kind).toBe("session");
      expect(fromLegacy).toEqual(cfg);
    }
  });

  it("3. an invalid Session config keeps the safe default fallback", () => {
    expect(parseOverlayConfig({ theme: "nope", preset: "giant" })).toEqual(
      DEFAULT_SESSION_OVERLAY_CONFIG,
    );
    expect(parseOverlayConfig("garbage")).toEqual(DEFAULT_SESSION_OVERLAY_CONFIG);
    expect(parseOverlayConfig(null)).toEqual(DEFAULT_SESSION_OVERLAY_CONFIG);
  });

  it("4. unknown / reserved kinds fail safe: Session default, never their own fields", () => {
    for (const kind of ["evil-widget", "rank-progress", 42]) {
      const parsed = parseOverlayConfig({ ...legacy(creatorConfig), kind });
      expect(parsed).toEqual(DEFAULT_SESSION_OVERLAY_CONFIG);
      // No Creator block survives ⇒ nothing to bypass entitlement gating with.
      expect(parsed.creator).toBeUndefined();
      expect(getEffectiveOverlayConfig(parsed, ALL)).toEqual(DEFAULT_SESSION_OVERLAY_CONFIG);
    }
  });

  it("5. old Creator configs without kind still parse (Creator block, variants, scope)", () => {
    const parsed = parseOverlayConfig({ ...legacy(creatorConfig), statsScope: "character" });
    expect(parsed.kind).toBe("session");
    expect(parsed.creator).toEqual(creatorConfig.creator);
    expect(parsed.theme).toBe("rank-card");
    expect(parsed.statsScope).toBe("character");
  });

  it("6. stored examples gain only the discriminant (no other semantic change)", () => {
    const old = { ...legacy(creatorConfig), locale: "en" };
    const parsed = parseOverlayConfig(old);
    const rest: Record<string, unknown> = { ...parsed };
    delete rest.kind;
    expect(rest).toEqual(old);
    // Reading never mutates the stored JSON.
    expect("kind" in old).toBe(false);
  });

  it("the editor schema accepts a missing kind (older clients) and rejects any other kind", () => {
    const body = legacy(DEFAULT_OVERLAY_CONFIG);
    expect(overlayConfigSchema.parse(body).kind).toBe("session");
    expect(overlayConfigSchema.safeParse({ ...body, kind: "session" }).success).toBe(true);
    for (const kind of ["rank-progress", "evil-widget", null]) {
      expect(overlayConfigSchema.safeParse({ ...body, kind }).success).toBe(false);
    }
  });
});

describe("creation defaults", () => {
  it("a new Session overlay gets exactly the historical defaults (+ the discriminant)", () => {
    const created = defaultOverlayConfigForKind("session");
    expect(created).toBe(DEFAULT_SESSION_OVERLAY_CONFIG);
    expect(DEFAULT_OVERLAY_CONFIG).toBe(DEFAULT_SESSION_OVERLAY_CONFIG);
    const rest: Record<string, unknown> = { ...created };
    delete rest.kind;
    expect(rest).toMatchObject({
      version: 1,
      theme: "competitive",
      preset: "standard",
      statsScope: "session",
      font: "barlow-condensed",
      accentColor: "#2fe0ff",
      backgroundOpacity: 0.82,
    });
    expect(applyThemeDefaults(created, "minimal").kind).toBe("session");
  });

  it("readout for dashboard cards is kind-aware (Session: canvas, language, theme)", () => {
    expect(overlayReadout(applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "minimal"))).toEqual({
      kind: "session",
      canvas: { width: 600, height: 120 },
      locale: DEFAULT_OVERLAY_CONFIG.locale,
      theme: "minimal",
    });
  });
});

describe("immutable kind", () => {
  it("edits need an editable stored kind and the SAME incoming kind", () => {
    expect(checkOverlayKindEdit("session", "session")).toEqual({ ok: true });
    expect(checkOverlayKindEdit("session", "rank-progress")).toEqual({
      ok: false,
      error: "kind_mismatch",
    });
    expect(checkOverlayKindEdit("rank-progress", "rank-progress")).toEqual({
      ok: false,
      error: "unsupported_kind",
    });
    expect(checkOverlayKindEdit(null, "session")).toEqual({
      ok: false,
      error: "unsupported_kind",
    });
  });

  it("the save merge keeps the stored kind even if a forged incoming config claims another", () => {
    const forged = { ...creatorConfig, kind: "rank-progress" } as unknown as OverlayConfig;
    for (const ent of [ALL, NONE]) {
      expect(mergeOverlayConfigForSave(DEFAULT_OVERLAY_CONFIG, forged, ent).kind).toBe("session");
    }
  });
});

describe("effective config / save merge equivalence (legacy vs explicit)", () => {
  const cases: OverlayConfig[] = [
    DEFAULT_OVERLAY_CONFIG,
    applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "fighter"),
    creatorConfig,
    { ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "prestige"), preset: "compact" },
  ];
  it("same effective config for Free and Creator owners, theme fallback included", () => {
    for (const cfg of cases) {
      for (const ent of [ALL, NONE]) {
        expect(getEffectiveOverlayConfig(parseOverlayConfig(legacy(cfg)), ent)).toEqual(
          getEffectiveOverlayConfig(parseOverlayConfig({ ...legacy(cfg), kind: "session" }), ent),
        );
      }
    }
    // Free owner of a Creator theme still gets the registered Free fallback.
    expect(getEffectiveOverlayConfig(parseOverlayConfig(legacy(creatorConfig)), NONE).theme).toBe(
      "competitive",
    );
  });

  it("Free save after a downgrade still preserves the stored Creator block", () => {
    const stored = parseOverlayConfig(legacy(creatorConfig));
    const incoming = { ...stored, creator: undefined, accentColor: "#123456" };
    const merged = mergeOverlayConfigForSave(stored, incoming, NONE);
    expect(merged.creator).toEqual(creatorConfig.creator);
    expect(merged.accentColor).toBe("#123456");
    expect(merged.kind).toBe("session");
  });
});

describe("Session presets never cross kinds", () => {
  it("legacy presets (no kind) are Session presets and still apply to Session overlays", () => {
    const raw: Record<string, unknown> = { ...appearanceFromConfig(creatorConfig) };
    delete raw.kind;
    const preset = parsePresetAppearance(raw);
    expect(preset).not.toBeNull();
    expect(presetKindOf(preset!)).toBe("session");
    expect(presetAppliesTo(preset!, "session")).toBe(true);
    const applied = applyPresetToConfig(DEFAULT_OVERLAY_CONFIG, preset!);
    expect(applied.kind).toBe("session");
    expect(applied.theme).toBe("rank-card");
  });

  it("new presets carry the kind they were saved from", () => {
    expect(appearanceFromConfig(DEFAULT_OVERLAY_CONFIG).kind).toBe("session");
  });

  it("cross-kind application is refused (reserved or unknown overlay kinds)", () => {
    const preset = parsePresetAppearance(appearanceFromConfig(DEFAULT_OVERLAY_CONFIG))!;
    expect(presetAppliesTo(preset, "rank-progress")).toBe(false);
    expect(presetAppliesTo(preset, null)).toBe(false);
    // A preset claiming another kind is not a usable Session preset at all.
    expect(parsePresetAppearance({ ...preset, kind: "rank-progress" })).toBeNull();
  });
});
