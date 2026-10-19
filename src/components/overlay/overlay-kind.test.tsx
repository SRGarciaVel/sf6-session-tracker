/**
 * Phase 5.4A — renderer dispatch by kind. A stored legacy config (no `kind`) and the same config
 * with `kind: "session"` render byte-identical Session markup, through the real pipeline
 * (parse → effective config → OverlayView), for every theme / canvas and the Creator features.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_FLAG } from "@/domain/overlay/brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_PRESETS,
  applyThemeDefaults,
  parseOverlayConfig,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION, getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION } from "@/domain/overlay/rotation";
import { sampleMultiCharacterState } from "@/domain/overlay/sample-session";
import { sampleLiveState } from "@/domain/overlay/state";
import { THEME_IDS } from "@/domain/overlay/themes";
import { DEFAULT_THEME_VARIANTS } from "@/domain/overlay/variants";
import { OverlayView } from "./OverlayView";

const ENTITLED = {
  overlays: {
    advancedCustomization: true,
    premiumThemes: true,
    motionEffects: true,
    characterRotation: true,
    brandFlag: true,
  },
};
const FREE = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
    brandFlag: false,
  },
};

const withoutKind = (c: OverlayConfig) => {
  const raw: Record<string, unknown> = { ...c };
  delete raw.kind;
  return raw;
};

function variantsOf(theme: OverlayConfig["theme"], preset: OverlayConfig["preset"]) {
  const base = { ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme), preset };
  return {
    plain: base,
    "character-scope": { ...base, statsScope: "character", ratingCharacterKey: "chunli" },
    "creator-motion-rotation-modes": {
      ...base,
      variants: DEFAULT_THEME_VARIANTS,
      creator: {
        ...DEFAULT_CREATOR_CUSTOMIZATION,
        secondaryAccent: "#ff2e93",
        motion: { ...DEFAULT_CREATOR_MOTION, intensity: "strong" },
        characterRotation: { ...DEFAULT_CHARACTER_ROTATION, enabled: true, mode: "session-all" },
        brandFlag: { ...DEFAULT_BRAND_FLAG, enabled: true, mode: "static-badge" },
      },
    },
    "integrated-branding": {
      ...base,
      creator: {
        ...DEFAULT_CREATOR_CUSTOMIZATION,
        brandFlag: { ...DEFAULT_BRAND_FLAG, enabled: true, mode: "content-interleave" },
      },
    },
  } satisfies Record<string, OverlayConfig>;
}

const render = (raw: unknown, ent: typeof ENTITLED | typeof FREE, multi: boolean) =>
  renderToStaticMarkup(
    <OverlayView
      config={getEffectiveOverlayConfig(parseOverlayConfig(raw), ent)}
      live={multi ? sampleMultiCharacterState("chunli") : sampleLiveState()}
      sizing={{ mode: "box", width: 400, height: 90 }}
    />,
  );

describe("Session renderer equivalence: legacy (no kind) ≡ kind: session", () => {
  for (const theme of THEME_IDS) {
    it(`${theme}: every canvas, scope, Creator motion / rotation / modes / brand flag`, () => {
      let compared = 0;
      for (const preset of Object.keys(OVERLAY_PRESETS) as OverlayConfig["preset"][]) {
        for (const cfg of Object.values(variantsOf(theme, preset))) {
          for (const ent of [ENTITLED, FREE]) {
            for (const multi of [false, true]) {
              const legacyHtml = render(withoutKind(cfg), ent, multi);
              const explicitHtml = render({ ...withoutKind(cfg), kind: "session" }, ent, multi);
              expect(legacyHtml).toBe(explicitHtml);
              expect(legacyHtml).toContain('class="sf6-overlay'); // routed to the Session renderer
              compared++;
            }
          }
        }
      }
      expect(compared).toBe(3 * 4 * 2 * 2);
    });
  }

  it("a Free owner of a Creator theme still sees the registered Free fallback", () => {
    const cfg = applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "prestige");
    const free = render(withoutKind(cfg), FREE, false);
    const fallback = render(
      withoutKind({
        ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "fighter"),
        ...withoutKind(cfg),
        theme: "fighter",
      } as OverlayConfig),
      FREE,
      false,
    );
    expect(free).toBe(fallback);
  });

  it("an unknown stored kind renders the safe Session default (no crash, no Creator)", () => {
    const html = render(
      {
        ...withoutKind(variantsOf("prestige", "detailed")["creator-motion-rotation-modes"]),
        kind: "evil-widget",
      },
      ENTITLED,
      true,
    );
    expect(html).toBe(render(withoutKind(DEFAULT_OVERLAY_CONFIG), ENTITLED, true));
  });
});
