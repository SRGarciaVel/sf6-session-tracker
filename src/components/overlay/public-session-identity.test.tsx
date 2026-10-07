// @vitest-environment happy-dom
/**
 * The PUBLIC overlay payload (OBS) never carries the internal sessionId (toPublicLiveState strips
 * it). Rotation priority and the motion/rotation baselines must still tell sessions apart and
 * detect new matches there, from data the public payload already has (no protocol change).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION } from "@/domain/overlay/rotation";
import { sampleMultiCharacterState, type SampleExtraMatch } from "@/domain/overlay/sample-session";
import { sessionIdentity, toPublicLiveState, type OverlayPayload } from "@/domain/overlay/state";

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
/** What the server sends to OBS: the public live state (sessionId stripped). */
const publicPayload = (
  extra: SampleExtraMatch[],
  at: number,
  startedAt?: string,
): OverlayPayload => {
  const live = sampleMultiCharacterState("ryu", undefined, extra);
  const session = startedAt ? { ...live.session, startedAt } : live.session;
  return {
    config,
    live: toPublicLiveState({
      ...live,
      session,
      generatedAt: new Date(at * 1000).toISOString(),
    }),
  };
};
const JAMIE: SampleExtraMatch = { characterKey: "jamie", result: "win" };

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

describe("public overlay (sessionId stripped): session identity", () => {
  it("the public payload really has no sessionId, but a stable session identity", () => {
    const p = publicPayload([], 100);
    expect(p.live.session.sessionId).toBeNull();
    expect(sessionIdentity(p.live.session)).toBe(p.live.session.startedAt);
    expect(sessionIdentity({ sessionId: "uuid", startedAt: "x", status: "active" })).toBe("uuid");
    expect(sessionIdentity({ sessionId: null, startedAt: null, status: "none" })).toBeNull();
  });

  it("OBS: a new match triggers latest-match priority (and its motion event)", () => {
    act(() => root.render(<LiveOverlay token="t" initial={publicPayload([], 100)} />));
    expect(shownName()).toBe("Ryu");
    push(publicPayload([JAMIE], 101));
    expect(shownName()).toBe("Jamie");
    expect(update()).toBe("win");
    tick(10_000);
    expect(shownName()).not.toBe("Jamie"); // priority ended, cycle resumed
  });

  it("OBS: a new session (fewer games) is a fresh baseline, not a stale snapshot", () => {
    act(() => root.render(<LiveOverlay token="t" initial={publicPayload([JAMIE, JAMIE], 100)} />));
    // New session: its own startedAt, fewer games than the previous one.
    const fresh = (extra: SampleExtraMatch[], at: number) => {
      const p = publicPayload(extra, at, "2026-02-01T18:00:00.000Z");
      const s = p.live.session;
      const one = s.characters.map((c) =>
        c.characterKey === "ryu" ? { ...c, games: 1, wins: 1, losses: 0 } : { ...c, games: 0 },
      );
      return {
        ...p,
        live: {
          ...p.live,
          session: {
            ...s,
            totalGames: 1,
            wins: 1,
            losses: 0,
            characters: one,
            activeCharacterKey: "ryu",
          },
        },
      };
    };
    push(fresh([], 200));
    expect(update()).toBeUndefined(); // the new session isn't a match
    expect(shownName()).toBe("Ryu");
    const second = fresh([], 201);
    const s = second.live.session;
    push({
      ...second,
      live: {
        ...second.live,
        session: {
          ...s,
          totalGames: 2,
          wins: 2,
          activeCharacterKey: "jamie",
          characters: s.characters.map((c) =>
            c.characterKey === "jamie" ? { ...c, games: 1, wins: 1, losses: 0 } : c,
          ),
        },
      },
    });
    // Its first real match is detected (it would be ignored as "stale" against the old session).
    expect(update()).toBe("win");
    expect(shownName()).toBe("Jamie");
  });
});
