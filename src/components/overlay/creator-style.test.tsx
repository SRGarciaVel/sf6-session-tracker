import { FREE_THEME_IDS } from "@/domain/overlay/themes";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION, getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { sampleLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";
import { creatorClassNames, creatorCssVars } from "./creator-style";

const custom = {
  secondaryAccent: "#ffb000",
  numberFont: "jetbrains-mono" as const,
  numberScale: 1.15,
  show: { labels: false, units: false, characterName: false, decorations: false },
};
const render = (config: Parameters<typeof OverlayView>[0]["config"]) =>
  renderToString(
    <OverlayView
      config={config}
      live={sampleLiveState()}
      sizing={{ mode: "box", width: 900, height: 240 }}
    />,
  );

describe("Creator renderer hooks", () => {
  it("no creator block or neutral defaults ⇒ no Creator classes or variables", () => {
    expect(creatorClassNames(undefined)).toEqual([]);
    expect(creatorCssVars(undefined)).toEqual({});
    expect(creatorClassNames(DEFAULT_CREATOR_CUSTOMIZATION)).toEqual([]);
    expect(creatorCssVars(DEFAULT_CREATOR_CUSTOMIZATION)).toEqual({});
  });

  it("customization ⇒ classes + validated variables only", () => {
    expect(creatorClassNames(custom).sort()).toEqual(
      [
        "ov-c-hide-char",
        "ov-c-hide-deco",
        "ov-c-hide-labels",
        "ov-c-hide-units",
        "ov-c-numfont",
        "ov-c-numscale",
        "ov-c-secondary",
      ].sort(),
    );
    expect(creatorCssVars(custom)).toEqual({
      "--ov-secondary": "#ffb000",
      "--ov-num-font": "var(--ovf-jetbrains-mono)",
      "--ov-num-scale": "1.15",
    });
  });

  it.each(FREE_THEME_IDS)(
    "%s: Free render has no Creator traces; Creator render applies them",
    (theme) => {
      const base = applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme);
      const stored = { ...base, creator: custom };
      const free = render(
        getEffectiveOverlayConfig(stored, {
          overlays: { advancedCustomization: false, premiumThemes: false },
        }),
      );
      const plain = render(base);
      expect(free).toBe(plain); // downgraded = exactly the theme's own Free look
      expect(free).not.toContain("ov-c-");
      expect(free).not.toContain("--ov-secondary");
      const creator = render(
        getEffectiveOverlayConfig(stored, {
          overlays: { advancedCustomization: true, premiumThemes: true },
        }),
      );
      expect(creator).toContain("ov-c-secondary");
      expect(creator).toContain("--ov-secondary:#ffb000");
      expect(creator).toContain("ov-char");
    },
  );
});
