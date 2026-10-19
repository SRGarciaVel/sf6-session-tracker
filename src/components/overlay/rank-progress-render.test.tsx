/**
 * Phase 5.4B — Rank Progress renderer (through the public OverlayView dispatch): Broadcast and
 * Compact × LP / MR / Ultimate Master / Master reached / no rating, progressbar ARIA in real
 * LP/MR values, clamped bar, remaining, session delta, character name, ES/EN, OBS-safe CSS.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  RANK_PROGRESS_STYLES,
  type RankProgressOverlayConfig,
} from "@/domain/overlay/rank-progress";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

const RP = DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG;

/** One-character live state with an exact rating (and delta). */
function live(
  rating: { system: "lp" | "mr"; value: number } | null,
  opts: { delta?: number | null; baselineKnown?: boolean; status?: "active" | "none" } = {},
): PlayerLiveState {
  const base = sampleLiveState(
    rating ? { rank: "ignored label", system: rating.system, value: rating.value } : undefined,
  );
  const c = base.session.characters[0]!;
  return {
    ...base,
    session: {
      ...base.session,
      status: opts.status ?? "active",
      characters: [
        {
          ...c,
          ratingSystem: rating?.system ?? null,
          current: rating ? { ...rating, rank: "ignored label" } : null,
          initial: rating ? { ...rating, rank: "ignored label" } : null,
          delta: opts.delta === undefined ? 84 : opts.delta,
          baselineKnown: opts.baselineKnown ?? true,
        },
      ],
    },
  };
}

const render = (config: Partial<RankProgressOverlayConfig>, state: PlayerLiveState) =>
  renderToStaticMarkup(
    <OverlayView
      config={{ ...RP, ...config }}
      live={state}
      sizing={{ mode: "box", width: 640, height: 140 }}
    />,
  );

const attr = (html: string, name: string) =>
  html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

for (const style of RANK_PROGRESS_STYLES) {
  describe(`${style} style`, () => {
    it("LP next division: Diamond 3 · 21,950 LP, bar 21,400 → 22,600, 650 LP to Diamond 4", () => {
      const html = render({ style, locale: "en" }, live({ system: "lp", value: 21950 }));
      expect(html).toContain('data-kind="rank-progress"');
      expect(html).toContain(`ov-rp-${style}`);
      expect(html).not.toContain("ov-theme-"); // not a Session theme
      expect(html).toContain('role="progressbar"');
      expect(attr(html, "aria-valuemin")).toBe("21400");
      expect(attr(html, "aria-valuemax")).toBe("22600");
      expect(attr(html, "aria-valuenow")).toBe("21950");
      expect(attr(html, "aria-label")).toBe("Progress to Diamond 4");
      expect(attr(html, "aria-valuetext")).toBe("21,950 of 22,600 LP");
      expect(html).toContain(`transform:scaleX(${550 / 1200})`);
      const t = text(html);
      expect(t).toContain("Next division");
      expect(t).toContain("Diamond 3");
      expect(t).toContain("21,950");
      expect(t).toContain("650 LP to Diamond 4");
      expect(t).toContain("Ryu");
      expect(t).toMatch(/Session ▲ \+84 LP/);
    });

    it("LP Road to Master: bar from the family start to 25,000", () => {
      const html = render(
        { style, goal: "master", locale: "en" },
        live({ system: "lp", value: 21950 }),
      );
      expect(attr(html, "aria-valuemin")).toBe("19000");
      expect(attr(html, "aria-valuemax")).toBe("25000");
      expect(text(html)).toContain("Road to Master");
      expect(text(html)).toContain("3,050 LP to Master");
    });

    it("MR next tier: High Master 1,642 MR ⇒ 58 MR to Grand Master", () => {
      const html = render({ style, locale: "en" }, live({ system: "mr", value: 1642 }));
      expect(attr(html, "aria-valuemin")).toBe("1600");
      expect(attr(html, "aria-valuemax")).toBe("1700");
      expect(attr(html, "aria-valuenow")).toBe("1642");
      expect(text(html)).toContain("Next Master tier");
      expect(text(html)).toContain("High Master");
      expect(text(html)).toContain("58 MR to Grand Master");
    });

    it("Ultimate Master: terminal, no bar, 'Legend · Top 500 required', never Legend progress", () => {
      const html = render({ style, locale: "en" }, live({ system: "mr", value: 2196 }));
      expect(html).not.toContain('role="progressbar"');
      expect(html).not.toContain("ov-rp-bar");
      expect(html).toContain('data-rp-state="ultimate-master"');
      const t = text(html);
      expect(t).toContain("Ultimate Master");
      expect(t).toContain("2,196");
      expect(t).toContain("Legend");
      expect(t).toContain("Top 500 required");
      expect(t).not.toMatch(/to Legend|#\d/);
    });

    it("LP at Master: goal reached, no fake bar beyond Master", () => {
      const html = render({ style, locale: "en" }, live({ system: "lp", value: 25120 }));
      expect(html).not.toContain('role="progressbar"');
      expect(text(html)).toContain("Master reached");
    });

    it("no rating: neutral state, no bar, no zero", () => {
      const html = render({ style, locale: "en" }, live(null));
      expect(html).not.toContain('role="progressbar"');
      expect(html).toContain('data-rp-state="no-rating"');
      const t = text(html);
      expect(t).toContain("No rating data");
      expect(t).not.toMatch(/Rookie|\b0 LP|±0/);
    });
  });
}

describe("display options and session delta", () => {
  const lp = live({ system: "lp", value: 21950 });
  it("character name and remaining points can be hidden", () => {
    const html = render({ showCharacterName: false, showRemaining: false, locale: "en" }, lp);
    expect(html).not.toContain("ov-rp-char");
    expect(text(html)).not.toContain("650");
    expect(text(html)).toContain("Goal: Diamond 4");
  });
  it("negative delta: ▼ and minus sign (not color alone)", () => {
    const html = render({ locale: "en" }, live({ system: "mr", value: 1642 }, { delta: -32 }));
    expect(text(html)).toMatch(/Session ▼ -32 MR/);
    expect(html).toContain("ov-neg");
  });
  it("unknown baseline or null delta ⇒ no session change at all (never +0)", () => {
    for (const s of [
      live({ system: "lp", value: 21950 }, { baselineKnown: false }),
      live({ system: "lp", value: 21950 }, { delta: null }),
    ]) {
      const html = render({ locale: "en" }, s);
      expect(html).not.toContain("rp-session-delta");
      expect(text(html)).not.toMatch(/Session|±0|\+0/);
    }
  });
  it("known zero delta is shown explicitly as ±0", () => {
    expect(
      text(render({ locale: "en" }, live({ system: "lp", value: 21950 }, { delta: 0 }))),
    ).toMatch(/Session ±0 LP/);
  });
  it("option off hides the delta", () => {
    expect(render({ showSessionDelta: false }, lp)).not.toContain("rp-session-delta");
  });
  it("works without a session (status none)", () => {
    const html = render({ locale: "en" }, live({ system: "lp", value: 21950 }, { status: "none" }));
    expect(html).toContain('data-session-status="none"');
    expect(html).toContain('role="progressbar"');
  });
});

describe("bar safety", () => {
  it("the fill is a clamped scaleX in [0, 1], never a width or a percentage", () => {
    const points = [
      { system: "lp", value: 0 },
      { system: "lp", value: 199 },
      { system: "lp", value: 21400 },
      { system: "lp", value: 24999 },
      { system: "mr", value: 1001 },
      { system: "mr", value: 1500 },
      { system: "mr", value: 1799 },
    ] as const;
    for (const point of points) {
      const html = render({}, live(point));
      const scale = Number(html.match(/scaleX\(([^)]+)\)/)?.[1]);
      expect(scale).toBeGreaterThanOrEqual(0);
      expect(scale).toBeLessThanOrEqual(1);
      expect(html).not.toMatch(/ov-rp-fill"[^>]*width/);
    }
  });
});

describe("i18n", () => {
  it("ES: localized copy and numbers; rank names stay official game terms", () => {
    const html = render({ locale: "es" }, live({ system: "lp", value: 21950 }));
    const t = text(html);
    expect(html).toContain('lang="es"');
    expect(t).toContain("Siguiente división");
    expect(t).toContain("21.950");
    expect(t).toContain("650 LP para Diamond 4");
    expect(t).toMatch(/Sesión ▲ \+84 LP/);
    expect(attr(html, "aria-label")).toBe("Progreso hacia Diamond 4");
  });
  it("ES terminal and empty states", () => {
    expect(text(render({ locale: "es" }, live({ system: "mr", value: 2134 })))).toContain(
      "Requiere Top 500",
    );
    expect(text(render({ locale: "es" }, live(null)))).toContain("Sin datos de rango");
  });
});

describe("OBS-safe CSS", () => {
  it("rank-progress.css uses no Tailwind / oklch / color-mix / container queries / :has()", () => {
    const css = readFileSync(new URL("./rank-progress.css", import.meta.url), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(css).not.toMatch(/oklch\(|color-mix\(|@container|:has\(|@apply|@tailwind/);
  });
});
