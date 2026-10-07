// @vitest-environment happy-dom
/**
 * The real OBS consumer (LiveOverlay) with character rotation: stale snapshots are dropped by
 * `generatedAt` before they reach the renderer, and stale → current never restarts priority or
 * plays a false match. The SSE hook is replaced by a handle on its handlers (no network).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION } from "@/domain/overlay/rotation";
import { sampleMultiCharacterState, type SampleExtraMatch } from "@/domain/overlay/sample-session";
import type { OverlayPayload } from "@/domain/overlay/state";

const sse = vi.hoisted(() => ({ handlers: {} as Record<string, (data: unknown) => void> }));
vi.mock("@/lib/use-event-stream", () => ({
  useEventStream: (opts: { handlers: Record<string, (data: unknown) => void> }) => {
    sse.handlers = opts.handlers;
  },
}));
const { LiveOverlay } = await import("./LiveOverlay");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config: OverlayConfig = {
  ...DEFAULT_OVERLAY_CONFIG,
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    motion: DEFAULT_CREATOR_MOTION,
    characterRotation: {
      ...DEFAULT_CHARACTER_ROTATION,
      enabled: true,
      intervalSeconds: 5,
      prioritySeconds: 10,
    },
  },
};
const payload = (extra: SampleExtraMatch[], at: number): OverlayPayload => {
  const live = sampleMultiCharacterState("ryu", undefined, extra);
  return { config, live: { ...live, generatedAt: new Date(at * 1000).toISOString() } };
};
const RYU_WIN: SampleExtraMatch = { characterKey: "ryu", result: "win" };
const JAMIE_WIN: SampleExtraMatch = { characterKey: "jamie", result: "win" };

let host: HTMLDivElement;
let root: Root;
const push = (p: OverlayPayload) =>
  act(() => {
    sse.handlers.state?.(p);
  });
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const shownName = () => host.querySelector(".ov-char")?.textContent?.trim() ?? null;
const games = () => host.querySelector(".sf6-overlay")?.textContent ?? "";
const update = () => host.querySelector<HTMLElement>(".sf6-overlay")?.dataset.update;

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

describe("LiveOverlay (OBS) + rotation: stale snapshots", () => {
  it("drops an older generatedAt; the current snapshot again is not a match", () => {
    const current = payload([RYU_WIN], 100);
    act(() => root.render(<LiveOverlay token="t" initial={current} />));
    expect(shownName()).toBe("Ryu");
    const before = games();
    push(payload([], 50)); // older snapshot (fewer games): dropped by generatedAt
    expect(games()).toBe(before);
    push(payload([RYU_WIN], 101)); // current data again (newer timestamp)
    expect(update()).toBeUndefined();
    tick(5_000);
    expect(shownName()).toBe("Chun-Li"); // normal cycle, no priority
  });

  it("during a priority period: stale + current keep the original period; a real match plays once", () => {
    act(() => root.render(<LiveOverlay token="t" initial={payload([RYU_WIN], 100)} />));
    push(payload([RYU_WIN, JAMIE_WIN], 110)); // legitimate match
    expect(shownName()).toBe("Jamie");
    expect(update()).toBe("win");
    tick(6_000);
    push(payload([RYU_WIN], 105)); // stale: dropped
    push(payload([RYU_WIN, JAMIE_WIN], 111)); // current again
    tick(4_000); // the original 10 s period ends now (it was not restarted)
    expect(shownName()).not.toBe("Jamie");
  });
});
