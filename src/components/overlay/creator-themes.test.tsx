import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { getEffectiveOverlayConfig } from "@/domain/overlay/creator";
import { sampleLiveState, type SampleRank } from "@/domain/overlay/state";
import { CREATOR_THEME_IDS, THEME_REGISTRY, type CreatorThemeId } from "@/domain/overlay/themes";
import { DEFAULT_THEME_VARIANTS } from "@/domain/overlay/variants";
import { OverlayView } from "./OverlayView";

const FREE = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
  },
};
const CREATOR = {
  overlays: {
    advancedCustomization: true,
    premiumThemes: true,
    motionEffects: true,
    characterRotation: true,
  },
};
const allFields = Object.fromEntries(
  Object.keys(DEFAULT_OVERLAY_CONFIG.fields).map((k) => [k, true]),
) as OverlayConfig["fields"];

const premium = (theme: CreatorThemeId, extra: Partial<OverlayConfig> = {}): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  fields: allFields,
  ...extra,
});
const html = (config: OverlayConfig, sample?: SampleRank) =>
  renderToStaticMarkup(
    <OverlayView config={config} live={sampleLiveState(sample)} sizing={{ mode: "viewport" }} />,
  );

describe("Creator themes render (entitled)", () => {
  it.each(CREATOR_THEME_IDS)("%s renders its own composition with the session values", (theme) => {
    const out = html(getEffectiveOverlayConfig(premium(theme), CREATOR));
    expect(out).toContain(`ov-theme-${theme}`);
    expect(out).toContain("12");
    expect(out).toContain("1684"); // es (default locale) does not group 4 digits
    expect(out).toContain("MR");
    // No other theme's composition leaks in.
    for (const other of ["ov-comp", "ov-minimal", "ov-street"])
      expect(out).not.toContain(`"${other}`);
  });

  it("the three compositions are structurally distinct", () => {
    const roots = CREATOR_THEME_IDS.map((t) => html(premium(t)).match(/ov-(rc|bc|pr)\b/)?.[0]);
    expect(new Set(roots).size).toBe(3);
  });

  it.each([
    [{ rank: "Iron 3", system: "lp", value: 1200 }, "iron", 1],
    [{ rank: "Gold 2", system: "lp", value: 9200 }, "gold", 2],
    [{ rank: "Diamond 4", system: "lp", value: 23000 }, "diamond", 4],
    [{ rank: "Master", system: "mr", value: 1500 }, "master", 5],
    [{ rank: "Ultimate Master", system: "mr", value: 2100 }, "ultimate-master", 6],
  ] as const)("rank-card is rank-aware: %o → %s", (sample, family, level) => {
    const out = html(premium("rank-card"), sample);
    expect(out).toContain(`data-rank-family="${family}"`);
    expect(out).toContain(`ov-tier-${level}`);
    expect(out).toContain(sample.rank);
    expect(out.includes("ov-emb-wings")).toBe(level >= 6);
  });

  it("rank hidden ⇒ neutral emblem (no rank revealed by color or tier)", () => {
    const out = html(premium("prestige", { fields: { ...allFields, rank: false } }), {
      rank: "Diamond 2",
      system: "lp",
      value: 21000,
    });
    expect(out).toContain('data-rank-family="unranked"');
    expect(out).not.toContain("Diamond");
    expect(out).toContain("--ov-tier:var(--ov-accent)");
  });

  it("forged rank labels never become CSS or markup", () => {
    for (const rank of [
      'Diamond 1"><script>x</script>',
      "#fff;background:url(x)",
      "Master</style>",
    ]) {
      const out = html(premium("rank-card"), { rank, system: "lp", value: 1 });
      expect(out).not.toContain("<script>");
      // Escaped as text at most; never inside a style attribute or class.
      const styles = [...out.matchAll(/style="([^"]*)"/g)].map((m) => m[1]).join(" ");
      expect(styles).not.toContain("url(");
      expect(styles).not.toContain("background:");
      expect(out).not.toMatch(/class="[^"]*(script|url|#fff)/);
      expect(out).toMatch(/--ov-tier:(#[0-9a-f]{6}|var\(--ov-accent\))/);
    }
  });

  it("variants map to fixed classes only", () => {
    const out = html(
      premium("rank-card", {
        variants: {
          ...DEFAULT_THEME_VARIANTS,
          "rank-card": { density: "compact", badge: "large", glow: "strong", background: "solid" },
        },
      }),
    );
    for (const cls of [
      "ov-rc-compact",
      "ov-rc-badge-large",
      "ov-rc-glow-strong",
      "ov-rc-bg-solid",
    ]) {
      expect(out).toContain(cls);
    }
    const pr = html(
      premium("prestige", {
        variants: {
          ...DEFAULT_THEME_VARIANTS,
          prestige: { glow: "subtle", frame: "subtle", animatedAccent: false },
        },
      }),
    );
    expect(pr).toContain("ov-pr-frame-subtle");
    expect(pr).not.toContain("ov-pr-sheen");
  });
});

describe("Creator themes downgrade (not entitled)", () => {
  it.each(CREATOR_THEME_IDS)(
    "%s ⇒ renders EXACTLY its Free fallback theme (same config otherwise)",
    (theme) => {
      const stored = premium(theme, { variants: DEFAULT_THEME_VARIANTS });
      const fallback = THEME_REGISTRY[theme].fallback;
      const free = html(getEffectiveOverlayConfig(stored, FREE));
      const plain = html({ ...stored, theme: fallback, variants: undefined });
      expect(free).toBe(plain);
      expect(free).toContain(`ov-theme-${fallback}`);
      expect(free).not.toMatch(/ov-(rc|bc|pr|emb)\b/);
    },
  );
});
