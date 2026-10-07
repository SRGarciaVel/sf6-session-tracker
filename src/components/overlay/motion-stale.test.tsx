// @vitest-environment happy-dom
/**
 * Creator Motion vs out-of-order snapshots (real DOM, fake timers). A stale snapshot (same
 * session, fewer games) must never become the comparison baseline, so the current snapshot
 * arriving again can't replay an already processed match. Covers the renderer directly, the
 * dashboard consumer (LiveDashboardProvider, which can pass an older snapshot through) and the
 * OBS consumer (LiveOverlay, which drops older generatedAt).
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import type { DashboardLiveState } from "@/server/dashboard/state";

const sse = vi.hoisted(() => ({ handlers: {} as Record<string, (data: unknown) => void> }));
vi.mock("@/lib/use-event-stream", () => ({
  useEventStream: (opts: { handlers: Record<string, (data: unknown) => void> }) => {
    sse.handlers = opts.handlers;
    return "open";
  },
}));
vi.mock("@/lib/session-heartbeat", () => ({ useSessionHeartbeat: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { OverlayView } = await import("./OverlayView");
const { LiveOverlay } = await import("./LiveOverlay");
const { LiveDashboardProvider, useLiveDashboard } =
  await import("@/app/(app)/dashboard/_components/LiveDashboard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const motionConfig = (over: Partial<OverlayConfig> = {}): OverlayConfig => ({
  ...DEFAULT_OVERLAY_CONFIG,
  ...over,
  creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion: DEFAULT_CREATOR_MOTION },
});

/** A consistent single-character (Ryu) snapshot: session and character counters agree. */
function snap(
  wins: number,
  losses: number,
  opts: { rating?: number; sessionId?: string; at?: number } = {},
): PlayerLiveState {
  const base = sampleLiveState();
  const games = wins + losses;
  const winRate = games === 0 ? 0 : Math.round((wins / games) * 1000) / 10;
  const counters = { wins, losses, draws: 0, winRate, currentWinStreak: 0, currentLossStreak: 0 };
  const [ryu] = base.session.characters;
  return {
    ...base,
    generatedAt: new Date((opts.at ?? games) * 1000).toISOString(),
    session: {
      ...base.session,
      ...counters,
      totalGames: games,
      sessionId: opts.sessionId ?? "s1",
      characters: ryu
        ? [
            {
              ...ryu,
              ...counters,
              games,
              current: { system: "mr", value: opts.rating ?? 1600, rank: "Master" },
            },
          ]
        : [],
    },
  };
}

let host: HTMLDivElement;
let root: Root;
const render = (node: ReactNode) =>
  act(() => {
    root.render(node);
  });
const view = (live: PlayerLiveState, config = motionConfig()) =>
  render(
    <OverlayView config={config} live={live} sizing={{ mode: "box", width: 800, height: 180 }} />,
  );
const el = () => host.querySelector<HTMLElement>(".sf6-overlay");
const update = () => el()?.dataset.update;
const cycle = () => el()?.dataset.updateCycle;
/** Lets the active effect finish (clearAfterMs) so the next assertion starts clean. */
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(5_000);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Creator Motion: stale snapshots (renderer)", () => {
  it("first render plays nothing", () => {
    view(snap(12, 8));
    expect(update()).toBeUndefined();
  });

  it("stale → current (20 → 19 → 20) does not replay the match", () => {
    view(snap(12, 8));
    view(snap(12, 7)); // stale (19 games)
    expect(update()).toBeUndefined();
    view(snap(12, 8)); // current again
    expect(update()).toBeUndefined();
  });

  it("stale → current during an active effect: the effect is neither replayed nor cut", () => {
    view(snap(11, 8));
    view(snap(12, 8)); // real match → effect
    expect(update()).toBe("win");
    const seq = cycle();
    view(snap(11, 8)); // stale while the effect plays
    view(snap(12, 8)); // current again
    expect(update()).toBe("win"); // same effect still running
    expect(cycle()).toBe(seq); // no second event
    settle();
    expect(update()).toBeUndefined();
  });

  it("repeated snapshots never replay", () => {
    view(snap(11, 8));
    view(snap(12, 8));
    settle();
    for (let i = 0; i < 5; i++) view(snap(12, 8, { at: 100 + i }));
    expect(update()).toBeUndefined();
  });

  it("a genuine new match after a stale snapshot plays exactly once, with its result", () => {
    view(snap(12, 8));
    view(snap(12, 7)); // stale
    view(snap(12, 9)); // 21 games: a real loss
    expect(update()).toBe("loss");
    const seq = cycle();
    view(snap(12, 9));
    view(snap(12, 8)); // stale again
    view(snap(12, 9));
    expect(cycle()).toBe(seq);
  });

  it("a new session with fewer games is a new baseline (not stale, not a match)", () => {
    view(snap(12, 8));
    view(snap(1, 0, { sessionId: "s2" }));
    expect(update()).toBeUndefined();
    view(snap(2, 0, { sessionId: "s2" })); // first real match of the new session
    expect(update()).toBe("win");
  });

  it("rating/rank-only updates keep their behaviour (update without result)", () => {
    view(snap(12, 8, { rating: 1600 }));
    view(snap(12, 8, { rating: 1612 }));
    expect(update()).toBe("update");
  });

  it("character, statsScope and theme changes still play nothing", () => {
    const live = snap(12, 8);
    view(live);
    view(live, motionConfig({ statsScope: "character" }));
    view(live, motionConfig({ statsScope: "character", theme: "fighter" }));
    view(live, motionConfig({ statsScope: "character", ratingCharacterKey: "ryu" }));
    expect(update()).toBeUndefined();
  });

  it("character scope: stale → current does not replay either", () => {
    const cfg = motionConfig({ statsScope: "character" });
    view(snap(12, 8), cfg);
    view(snap(12, 7), cfg);
    view(snap(12, 8), cfg);
    expect(update()).toBeUndefined();
    view(snap(13, 8), cfg);
    expect(update()).toBe("win");
  });

  it("reduced motion: no motion attributes at all; data still updates", () => {
    const mql = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("reduce"),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    view(snap(11, 8));
    view(snap(12, 8));
    expect(update()).toBeUndefined();
    expect(el()?.dataset.motionStyle).toBeUndefined();
    expect(el()?.textContent).toContain("12");
    mql.mockRestore();
  });
});

describe("consumers", () => {
  const dashboard = (live: PlayerLiveState, overlayConnections: number): DashboardLiveState =>
    ({
      live,
      player: { cfnUserId: "1" },
      tracker: {},
      overlayConnections,
      companion: {},
    }) as unknown as DashboardLiveState;
  function DashboardOverlay() {
    const { state } = useLiveDashboard();
    return (
      <OverlayView
        config={motionConfig()}
        live={state.live}
        sizing={{ mode: "box", width: 800, height: 180 }}
      />
    );
  }

  it("dashboard: an older snapshot passes through (overlayConnections changed) — no replay", () => {
    const current = snap(12, 8, { at: 200 });
    render(
      <LiveDashboardProvider initial={dashboard(current, 1)}>
        <DashboardOverlay />
      </LiveDashboardProvider>,
    );
    act(() => sse.handlers.dashboard?.(dashboard(snap(12, 7, { at: 150 }), 2))); // older, accepted
    expect(el()?.textContent).toContain("7"); // it really reached the renderer
    act(() => sse.handlers.dashboard?.(dashboard(snap(12, 8, { at: 201 }), 2)));
    expect(update()).toBeUndefined();
    act(() => sse.handlers.dashboard?.(dashboard(snap(13, 8, { at: 202 }), 2))); // real match
    expect(update()).toBe("win");
  });

  it("OBS: LiveOverlay drops the older snapshot; the current one again plays nothing", () => {
    const payload = (live: PlayerLiveState) => ({ config: motionConfig(), live });
    render(<LiveOverlay token="t" initial={payload(snap(12, 8, { at: 200 }))} />);
    act(() => sse.handlers.state?.(payload(snap(12, 7, { at: 150 }))));
    act(() => sse.handlers.state?.(payload(snap(12, 8, { at: 201 }))));
    expect(update()).toBeUndefined();
    act(() => sse.handlers.state?.(payload(snap(13, 8, { at: 202 }))));
    expect(update()).toBe("win");
  });
});
