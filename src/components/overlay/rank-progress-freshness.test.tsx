// @vitest-environment happy-dom
/**
 * Phase 5.4C pre-merge — a Legend cutoff must stop being shown as current EXACTLY when it turns
 * stale (age > 30 min), in a browser source that stays open with no new snapshot (OBS overnight,
 * Companion disconnected). Injected clock (fake timers); real React client render.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } from "@/domain/overlay/rank-progress";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Deliberately NOT on a minute boundary (a minute-rounded clock lags up to ~2 min here). */
const T = Date.parse("2026-10-19T12:00:59.000Z");
const MIN = 60_000;

function live(cutoffObservedAt: number, position: number | null = 530): PlayerLiveState {
  const base = sampleLiveState({ rank: "Ultimate Master", system: "mr", value: 2189 });
  return {
    ...base,
    generatedAt: new Date(T).toISOString(),
    legendCutoff: {
      cutoffMr: 2196,
      observedAt: new Date(cutoffObservedAt).toISOString(),
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
    },
    session: {
      ...base.session,
      characters: base.session.characters.map((c) => ({ ...c, leaderboardPosition: position })),
    },
  };
}

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  vi.setSystemTime(T);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

function mount(state: PlayerLiveState) {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <OverlayView
        config={{ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "en" }}
        live={state}
        sizing={{ mode: "box", width: 640, height: 140 }}
      />,
    );
  });
  return () => host.querySelector(".ov-rp")?.getAttribute("data-rp-state");
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("Legend cutoff expiry in a long-open overlay (no new snapshot)", () => {
  it("chase while age ≤ 30 min; terminal fallback right after 30 min — not ~2 min later", () => {
    const state = mount(live(T - 29.5 * MIN)); // expires at T + 30 s
    expect(state()).toBe("legend-chase");
    advance(29_000); // age 29 min 59 s
    expect(state()).toBe("legend-chase");
    advance(2_000); // age 30 min 1 s
    expect(state()).toBe("ultimate-master");
    expect(host.textContent).not.toMatch(/cutoff/i);
  });

  it("the boundary state expires the same way (never a stale numeric cutoff)", () => {
    const base = live(T - 29.9 * MIN);
    const atCutoff: PlayerLiveState = {
      ...base,
      session: {
        ...base.session,
        characters: base.session.characters.map((c) => ({
          ...c,
          current: { system: "mr", value: 2196, rank: "Ultimate Master" },
          leaderboardPosition: 505,
        })),
      },
    };
    const state = mount(atCutoff);
    expect(state()).toBe("legend-boundary");
    advance(7_000);
    expect(state()).toBe("ultimate-master");
  });

  it("stays expired indefinitely while the source stays open", () => {
    const state = mount(live(T - 29 * MIN));
    advance(61_000);
    expect(state()).toBe("ultimate-master");
    advance(12 * 60 * MIN);
    expect(state()).toBe("ultimate-master");
  });

  it("an already-stale cutoff is never shown, even on the first client render", () => {
    expect(mount(live(T - 31 * MIN))()).toBe("ultimate-master");
  });

  it("the OBS machine's clock does not matter (10 min behind the server)", () => {
    vi.setSystemTime(T - 10 * MIN); // skewed browser clock; generatedAt is still server time T
    const state = mount(live(T - 29.5 * MIN));
    expect(state()).toBe("legend-chase");
    advance(31_000); // 31 s of real time ⇒ server time T + 31 s ⇒ age 30 min 1 s
    expect(state()).toBe("ultimate-master");
  });

  it("a newer snapshot (fresh cutoff from the Companion) restarts the clock", () => {
    host = document.createElement("div");
    document.body.append(host);
    const render = (s: PlayerLiveState) =>
      act(() => {
        root ??= createRoot(host);
        root.render(
          <OverlayView
            config={{ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "en" }}
            live={s}
            sizing={{ mode: "box", width: 640, height: 140 }}
          />,
        );
      });
    const state = () => host.querySelector(".ov-rp")?.getAttribute("data-rp-state");
    render(live(T - 29.5 * MIN));
    advance(31_000);
    expect(state()).toBe("ultimate-master");
    const next = Date.now();
    render({ ...live(next), generatedAt: new Date(next).toISOString() });
    expect(state()).toBe("legend-chase");
  });

  it("a wall clock that steps BACK while waiting (NTP / VM sync) never keeps a stale cutoff", () => {
    // Timers run on the monotonic clock; Date.now() can be adjusted backwards meanwhile. The
    // expiry must follow elapsed (monotonic) time, and a timer that fires "early" re-arms.
    const state = mount(live(T - 29.5 * MIN)); // expires at T + 30 s (monotonic)
    advance(15_000);
    vi.setSystemTime(Date.now() - 2_000); // the OS clock is corrected 2 s back
    advance(16_000); // 31 s of real (monotonic) time since the snapshot
    expect(state()).toBe("ultimate-master");
    advance(60 * MIN);
    expect(state()).toBe("ultimate-master");
  });

  it("a wall clock stepping back by a single millisecond near the edge is enough to matter", () => {
    const state = mount(live(T - 29.5 * MIN));
    advance(29_999);
    vi.setSystemTime(Date.now() - 1);
    advance(5_000);
    expect(state()).toBe("ultimate-master");
  });

  it("authoritative Legend does not depend on cutoff freshness", () => {
    const state = mount(live(T - 29.5 * MIN, 327));
    expect(state()).toBe("legend");
    advance(5 * MIN);
    expect(state()).toBe("legend");
  });
});
