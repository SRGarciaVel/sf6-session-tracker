import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_THEME_VARIANTS } from "@/domain/overlay/variants";
import { sampleMultiCharacterState } from "@/domain/overlay/sample-session";
import { OverlayView } from "./OverlayView";

const live = sampleMultiCharacterState();
const text = (config: OverlayConfig) =>
  renderToStaticMarkup(<OverlayView config={config} live={live} sizing={{ mode: "viewport" }} />)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
const cfg = (theme: OverlayConfig["theme"], extra: Partial<OverlayConfig> = {}): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  locale: "en",
  variants: DEFAULT_THEME_VARIANTS,
  fields: {
    ...DEFAULT_OVERLAY_CONFIG.fields,
    wins: true,
    losses: true,
    winRate: true,
    totalGames: true,
    rating: true,
  },
  ...extra,
});

describe("statsScope in every theme (26–32)", () => {
  it.each(OVERLAY_THEMES)(
    "%s: session = 14-14; character (Chun-Li) = 2-1 with Chun-Li's rating",
    (theme) => {
      const session = text(cfg(theme));
      expect(session).toMatch(/\b14\b/);
      expect(session).toContain("50%");
      const chun = text(cfg(theme, { statsScope: "character", ratingCharacterKey: "chunli" }));
      expect(chun).toContain("66.7%");
      expect(chun).toContain("21,150"); // Chun-Li's LP, not Ryu's MR
      expect(chun).not.toContain("1,684");
      expect(chun).not.toMatch(/\b14\b/);
    },
  );

  it("34. character with 0 games: zeros, rating still shown", () => {
    const t = text(cfg("competitive", { statsScope: "character", ratingCharacterKey: "cammy" }));
    expect(t).toContain("0%");
    expect(t).toContain("9,200");
  });

  it("36. hidden fields stay hidden in character scope", () => {
    const t = text(
      cfg("competitive", {
        statsScope: "character",
        ratingCharacterKey: "chunli",
        fields: {
          ...DEFAULT_OVERLAY_CONFIG.fields,
          wins: true,
          losses: true,
          winRate: false,
          totalGames: false,
        },
      }),
    );
    expect(t).not.toContain("%");
  });

  it("37. Creator theme variants still apply with character scope", () => {
    const html = renderToStaticMarkup(
      <OverlayView
        config={cfg("rank-card", {
          statsScope: "character",
          ratingCharacterKey: "jamie",
          variants: {
            ...DEFAULT_THEME_VARIANTS,
            "rank-card": {
              density: "compact",
              badge: "large",
              glow: "strong",
              background: "solid",
            },
          },
        })}
        live={live}
        sizing={{ mode: "viewport" }}
      />,
    );
    expect(html).toContain("ov-rc-compact");
    expect(html).toContain("ov-rc-badge-large");
    expect(html).toMatch(/37\.5/);
  });
});
