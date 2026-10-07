import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION, getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { sampleLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

const FREE = {
  overlays: { advancedCustomization: false, premiumThemes: false, motionEffects: false },
};
const CREATOR = {
  overlays: { advancedCustomization: true, premiumThemes: true, motionEffects: true },
};
const render = (config: OverlayConfig) =>
  renderToStaticMarkup(
    <OverlayView config={config} live={sampleLiveState()} sizing={{ mode: "viewport" }} />,
  );
const withMotion = (theme: OverlayConfig["theme"]): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    motion: { ...DEFAULT_CREATOR_MOTION, accentMotion: "sweep" },
  },
});

describe("Creator motion in the renderer", () => {
  it.each(OVERLAY_THEMES)(
    "%s: Free (stored motion ignored) renders exactly like no motion",
    (theme) => {
      const stored = withMotion(theme);
      const free = render(getEffectiveOverlayConfig(stored, FREE));
      const plain = render(getEffectiveOverlayConfig({ ...stored, creator: undefined }, FREE));
      expect(free).toBe(plain);
      expect(free).not.toMatch(/data-motion|data-update|ov-m-|--ovm-/);
    },
  );

  it.each(OVERLAY_THEMES)(
    "%s: entitled ⇒ motion attributes + tokens, but NO update on initial render",
    (theme) => {
      const html = render(getEffectiveOverlayConfig(withMotion(theme), CREATOR));
      expect(html).toContain('data-motion-style="snappy"');
      expect(html).toContain('data-accent-motion="sweep"');
      expect(html).toContain("--ovm-dur:260ms");
      expect(html).not.toContain("data-update=");
      expect(html).not.toContain("ov-m-sweep"); // the sweep only exists during an update
    },
  );

  it("animations switched off ⇒ no Creator motion either (data still renders)", () => {
    const html = render(
      getEffectiveOverlayConfig({ ...withMotion("competitive"), animations: false }, CREATOR),
    );
    expect(html).not.toContain("data-motion-style");
    expect(html).toContain("12");
  });
});
