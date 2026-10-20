// @vitest-environment happy-dom
/**
 * Phase 5.5 — rating transitions in the real Session overlay renderer (client React, controlled
 * frames: fake requestAnimationFrame / performance / Date). Count, fade and instant; speeds;
 * retargeting; identity resets; reduced motion; animations off; legacy configs; cleanup.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  RATING_TRANSITION_SPEEDS,
  applyThemeDefaults,
  parseOverlayConfig,
  sessionConfigOf,
  type SessionOverlayConfig,
} from "@/domain/overlay/config";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T = Date.parse("2026-10-20T20:00:00Z");

/** One character with an exact rating / delta (session identity fixed unless overridden). */
function live(
  value: number | null,
  opts: {
    system?: "mr" | "lp";
    delta?: number | null;
    character?: string;
    startedAt?: string;
    held?: { value: number; delta: number | null; pendingSinceMs: number };
  } = {},
): PlayerLiveState {
  const system = opts.system ?? "mr";
  const base = sampleLiveState({ rank: "x", system, value: value ?? 0 });
  const c = base.session.characters[0]!;
  return {
    ...base,
    generatedAt: new Date(Date.now()).toISOString(),
    session: {
      ...base.session,
      startedAt: opts.startedAt ?? new Date(T - 3_600_000).toISOString(),
      activeCharacterKey: opts.character ?? "ryu",
      characters: [
        {
          ...c,
          characterKey: opts.character ?? "ryu",
          characterName: (opts.character ?? "ryu").toUpperCase(),
          ratingSystem: system,
          current: value === null ? null : { system, value, rank: null },
          delta: opts.delta === undefined ? 30 : opts.delta,
          ...(opts.held
            ? {
                heldRating: {
                  current: { system, value: opts.held.value, rank: null },
                  delta: opts.held.delta,
                  pendingSince: new Date(opts.held.pendingSinceMs).toISOString(),
                },
              }
            : {}),
        },
      ],
    },
  };
}

const COUNT: SessionOverlayConfig = {
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "competitive"),
  locale: "en",
  ratingTransition: "count",
  ratingTransitionSpeed: "normal",
};

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
  });
  vi.setSystemTime(T);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(config: SessionOverlayConfig, first: PlayerLiveState) {
  host = document.createElement("div");
  document.body.append(host);
  const render = (state: PlayerLiveState, cfg = config) =>
    act(() => {
      root ??= createRoot(host);
      root.render(
        <OverlayView config={cfg} live={state} sizing={{ mode: "box", width: 800, height: 180 }} />,
      );
    });
  render(first);
  /** The rating cell: the number on screen + whether a count is running. */
  const rating = () => {
    const cell = [...host.querySelectorAll(".ov-cell")].find((c) => c.querySelector(".ov-char"))!;
    const num = cell.querySelector(".ov-num")!;
    const visible = num.querySelector('[aria-hidden="true"]')?.textContent ?? num.textContent;
    return {
      text: visible ?? "",
      value: Number((visible ?? "").replace(/[^\d-]/g, "")),
      counting: num.classList.contains("ov-counting"),
      fade: num.classList.contains("ov-rt-fade"),
      tick: num.classList.contains("ov-changed"),
      srFinal: num.querySelector(".ov-sr")?.textContent ?? null,
      delta: cell.querySelector(".ov-delta")?.textContent ?? "",
    };
  };
  return { render, rating };
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("count", () => {
  it("no animation on first load", () => {
    const { rating } = mount(COUNT, live(1859));
    expect(rating()).toMatchObject({ text: "1,859", counting: false });
  });

  it("increase: starts from the previous value (no frame of the final number), lands exactly", () => {
    const { render, rating } = mount(COUNT, live(1859));
    render(live(1861, { delta: 32 }));
    expect(rating()).toMatchObject({ value: 1859, counting: true, srFinal: "1,861" });
    expect(rating().delta).toContain("+32"); // the authoritative delta of the new observation
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      advance(16);
      seen.push(rating().value);
    }
    expect(seen.every((v, i) => v >= 1859 && v <= 1861 && (i === 0 || v >= seen[i - 1]!))).toBe(
      true,
    );
    expect(rating()).toMatchObject({ text: "1,861", counting: false, srFinal: null });
  });

  it("decrease, large positive and large negative deltas: monotonic, never overshoots", () => {
    for (const [from, to] of [
      [1859, 1847],
      [1500, 2240],
      [24990, 21000],
    ] as const) {
      const { render, rating } = mount(COUNT, live(from, { system: from > 9000 ? "lp" : "mr" }));
      render(live(to, { system: from > 9000 ? "lp" : "mr" }));
      const seen: number[] = [];
      for (let i = 0; i < 50; i++) {
        advance(16);
        seen.push(rating().value);
      }
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      expect(seen.every((v) => v >= lo && v <= hi)).toBe(true);
      const dir = Math.sign(to - from);
      expect(seen.every((v, i) => i === 0 || Math.sign(v - seen[i - 1]!) !== -dir)).toBe(true);
      expect(new Set(seen).size).toBeGreaterThan(5); // really counts, in frames, not per integer
      expect(rating().value).toBe(to);
      act(() => root?.unmount());
      root = null;
      host.remove();
    }
  });

  it("equal rating: nothing animates", () => {
    const { render, rating } = mount(COUNT, live(1859));
    render(live(1859, { delta: 31 }));
    expect(rating()).toMatchObject({ value: 1859, counting: false });
  });

  it("speeds: fast 300 ms, normal 550 ms, slow 800 ms", () => {
    for (const speed of ["fast", "normal", "slow"] as const) {
      const ms = RATING_TRANSITION_SPEEDS[speed];
      const { render, rating } = mount({ ...COUNT, ratingTransitionSpeed: speed }, live(1000));
      render(live(2000));
      advance(ms - 40);
      expect(rating().counting).toBe(true);
      advance(80);
      expect(rating()).toMatchObject({ value: 2000, counting: false });
      act(() => root?.unmount());
      root = null;
      host.remove();
    }
  });

  it("mid-animation retarget: continues from the number on screen, ends on the latest", () => {
    const { render, rating } = mount(COUNT, live(1859));
    render(live(1959));
    advance(200);
    const mid = rating().value;
    expect(mid).toBeGreaterThan(1859);
    expect(mid).toBeLessThan(1959);
    render(live(1864));
    expect(rating().value).toBe(mid); // no jump back to 1859, no jump to the target
    advance(1_000);
    expect(rating()).toMatchObject({ value: 1864, counting: false });
    expect(vi.getTimerCount()).toBe(0); // one loop, finished
  });

  it("unmount mid-count cancels the frame (no leak, no late update)", () => {
    const { render } = mount(COUNT, live(1859));
    render(live(1959));
    advance(100);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    act(() => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("identity resets show the new value directly: character, rating system, session", () => {
    const { render, rating } = mount(COUNT, live(1859));
    render(live(1700, { character: "ken" }));
    expect(rating()).toMatchObject({ value: 1700, counting: false });
    render(live(21950, { character: "ken", system: "lp" }));
    expect(rating()).toMatchObject({ value: 21950, counting: false });
    render(live(22000, { character: "ken", system: "lp", startedAt: new Date(T).toISOString() }));
    expect(rating()).toMatchObject({ value: 22000, counting: false });
  });

  it("unknown → value and value → unknown never animate (and never from zero)", () => {
    const { render, rating } = mount(COUNT, live(null, { delta: null }));
    expect(rating().text).toBe("—");
    render(live(1861));
    expect(rating()).toMatchObject({ value: 1861, counting: false });
  });
});

describe("held pending rating + count (the reported sequence)", () => {
  it("1859 +30 → pending (held 1859 +30) → 1861 +32 counts from 1859; never '—'", () => {
    const { render, rating } = mount(COUNT, live(1859, { delta: 30 }));
    render(live(null, { delta: null, held: { value: 1859, delta: 30, pendingSinceMs: T } }));
    expect(rating()).toMatchObject({ value: 1859, counting: false });
    expect(rating().delta).toContain("+30");
    advance(60_000);
    render(live(1861, { delta: 32 }));
    expect(rating()).toMatchObject({ value: 1859, counting: true });
    advance(600);
    expect(rating()).toMatchObject({ value: 1861, counting: false });
    expect(rating().delta).toContain("+32");
  });

  it("a hold that outlives 3 min turns into the honest unknown while the source stays open", () => {
    const { render, rating } = mount(COUNT, live(1859));
    render(live(null, { delta: null, held: { value: 1859, delta: 30, pendingSinceMs: T } }));
    advance(179_000);
    expect(rating().value).toBe(1859);
    advance(2_000);
    expect(rating().text).toBe("—");
  });
});

describe("fade and instant", () => {
  it("fade: new value of the same identity fades in; identity change appears directly", () => {
    const { render, rating } = mount({ ...COUNT, ratingTransition: "fade" }, live(1859));
    expect(rating()).toMatchObject({ fade: false, counting: false });
    render(live(1861));
    expect(rating()).toMatchObject({ text: "1,861", fade: true, counting: false });
    render(live(1700, { character: "ken" }));
    expect(rating()).toMatchObject({ text: "1,700", fade: false });
    expect(vi.getTimerCount()).toBe(0); // CSS only
  });

  it("instant: the established markup (tick), no frames", () => {
    const { render, rating } = mount({ ...COUNT, ratingTransition: "instant" }, live(1859));
    render(live(1861));
    expect(rating()).toMatchObject({ text: "1,861", counting: false, fade: false, tick: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("animations off or reduced motion ⇒ instant path whatever the mode", () => {
    const off = mount({ ...COUNT, animations: false }, live(1859));
    off.render(live(1861));
    expect(off.rating()).toMatchObject({ text: "1,861", counting: false });
    act(() => root?.unmount());
    root = null;
    host.remove();

    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const reduced = mount(COUNT, live(1859));
    reduced.render(live(1861));
    expect(reduced.rating()).toMatchObject({ text: "1,861", counting: false, fade: false });
  });
});

describe("configuration", () => {
  it("new overlays count at normal speed; legacy configs keep the established instant rendering", () => {
    expect(DEFAULT_OVERLAY_CONFIG).toMatchObject({
      ratingTransition: "count",
      ratingTransitionSpeed: "normal",
    });
    const legacy: Record<string, unknown> = { ...DEFAULT_OVERLAY_CONFIG };
    delete legacy.ratingTransition;
    delete legacy.ratingTransitionSpeed;
    expect(sessionConfigOf(parseOverlayConfig(legacy))).toMatchObject({
      ratingTransition: "instant",
      ratingTransitionSpeed: "normal",
    });
    for (const mode of ["count", "fade", "instant"] as const) {
      expect(
        sessionConfigOf(parseOverlayConfig({ ...legacy, ratingTransition: mode }))
          ?.ratingTransition,
      ).toBe(mode);
    }
    expect(
      sessionConfigOf(parseOverlayConfig({ ...legacy, ratingTransition: "spin" }))
        ?.ratingTransition,
    ).toBe("count"); // invalid ⇒ the safe default config (existing lenient-read rule)
  });

  it("instant renders exactly what a pre-5.5 overlay rendered (server markup)", () => {
    const legacy: Record<string, unknown> = { ...COUNT };
    delete legacy.ratingTransition;
    delete legacy.ratingTransitionSpeed;
    const parsed = sessionConfigOf(parseOverlayConfig(legacy))!;
    const html = (cfg: SessionOverlayConfig) =>
      renderToStaticMarkup(
        <OverlayView
          config={cfg}
          live={live(1859)}
          sizing={{ mode: "box", width: 800, height: 180 }}
        />,
      );
    expect(html(parsed)).toBe(html({ ...COUNT, ratingTransition: "instant" }));
    // At rest, count renders the same markup too (it only differs while counting).
    expect(html(COUNT)).toBe(html({ ...COUNT, ratingTransition: "instant" }));
  });
});
