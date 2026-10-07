// @vitest-environment happy-dom
/**
 * Presentation modes through the REAL OBS path (Phase 5.3A): the LiveOverlay component fed with
 * the public payload exactly as the server builds it (toPublicLiveState ⇒ sessionId: null; the
 * session is identified by sessionIdentity(), PR #30). The SSE hook is replaced by a handle on
 * its handlers — no network — so every snapshot goes through LiveOverlay's own generatedAt
 * filter before reaching the renderer.
 *
 * Sample (engine-built): Chun-Li 2-1, Jamie 3-5, Ryu 9-8 ⇒ 14-14 in 28 games; latest match =
 * Ryu; recent order Ryu → Chun-Li → Jamie; Cammy unplayed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import {
  DEFAULT_CHARACTER_ROTATION,
  type CharacterRotation,
  type PresentationMode,
} from "@/domain/overlay/rotation";
import { sampleMultiCharacterState, type SampleExtraMatch } from "@/domain/overlay/sample-session";
import {
  sessionIdentity,
  toPublicLiveState,
  type OverlayPayload,
  type PlayerLiveState,
} from "@/domain/overlay/state";

const sse = vi.hoisted(() => ({ handlers: {} as Record<string, (data: unknown) => void> }));
vi.mock("@/lib/use-event-stream", () => ({
  useEventStream: (opts: { handlers: Record<string, (data: unknown) => void> }) => {
    sse.handlers = opts.handlers;
  },
}));
const { LiveOverlay } = await import("./LiveOverlay");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INTERVAL = 5_000;
const PRIORITY = 10_000;

const config = (mode: PresentationMode, over: Partial<CharacterRotation> = {}): OverlayConfig => ({
  ...DEFAULT_OVERLAY_CONFIG, // competitive theme, "session" statsScope, empty title
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, totalGames: true },
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    motion: DEFAULT_CREATOR_MOTION,
    characterRotation: {
      ...DEFAULT_CHARACTER_ROTATION,
      enabled: true,
      mode,
      intervalSeconds: 5,
      prioritySeconds: 10,
      ...over,
    },
  },
});

const W = (characterKey: SampleExtraMatch["characterKey"]): SampleExtraMatch => ({
  characterKey,
  result: "win",
});

/**
 * A session where only Ryu has played (internally consistent: the session's counters are Ryu's
 * own, since every match is his). Built from the engine sample, then restricted.
 */
function onlyRyu(live: PlayerLiveState): PlayerLiveState {
  const ryu = live.session.characters.find((c) => c.characterKey === "ryu");
  if (!ryu) throw new Error("sample without Ryu");
  return {
    ...live,
    session: {
      ...live.session,
      wins: ryu.wins,
      losses: ryu.losses,
      draws: ryu.draws,
      totalGames: ryu.games,
      winRate: ryu.winRate,
      currentWinStreak: ryu.currentWinStreak,
      currentLossStreak: ryu.currentLossStreak,
      bestWinStreak: ryu.bestWinStreak,
      recentResults: ryu.recentResults,
      activeCharacterKey: "ryu",
      characters: live.session.characters.map((c) =>
        c.characterKey === "ryu" ? c : { ...c, games: 0, lastPlayedAt: null },
      ),
    },
  };
}

/** What the server pushes to OBS: the PUBLIC live state (sessionId stripped). */
function publicPayload(
  cfg: OverlayConfig,
  extra: SampleExtraMatch[],
  atSeconds: number,
  shape: (live: PlayerLiveState) => PlayerLiveState = (l) => l,
): OverlayPayload {
  const live = shape(sampleMultiCharacterState("ryu", undefined, extra));
  return {
    config: cfg,
    live: toPublicLiveState({ ...live, generatedAt: new Date(atSeconds * 1000).toISOString() }),
  };
}

let host: HTMLDivElement;
let root: Root;
const mount = (initial: OverlayPayload) =>
  act(() => {
    root.render(<LiveOverlay token="t" initial={initial} />);
  });
const push = (p: OverlayPayload) =>
  act(() => {
    sse.handlers.state?.(p);
  });
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const overlay = () => host.querySelector<HTMLElement>(".sf6-overlay");
/** View identifier in the title slot (mixed modes) — or the plain title otherwise. */
const title = () => host.querySelector(".ov-comp-tag")?.textContent ?? null;
/** Character whose rating is shown (labelled with its name). */
const ratingName = () => host.querySelector(".ov-char")?.textContent ?? null;
const frameView = () => host.querySelector<HTMLElement>(".ov-rot-frame")?.dataset.view ?? null;
const text = () => (overlay()?.textContent ?? "").replace(/\s+/g, " ");
const update = () => overlay()?.dataset.update;
/** Wins / losses shown, read from the scoreboard cells (competitive theme). */
const score = () => {
  const nums = [...host.querySelectorAll(".ov-comp-score .ov-big")].map((n) => n.textContent);
  return nums.join("-");
};

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

describe("public OBS payload", () => {
  it("has no sessionId; the session is identified by sessionIdentity()", () => {
    const p = publicPayload(config("session-all"), [], 100);
    expect(p.live.session.sessionId).toBeNull();
    expect(sessionIdentity(p.live.session)).toBe(p.live.session.startedAt);
    expect(sessionIdentity(p.live.session)).not.toBeNull();
  });
});

describe("OBS · session-active with ONE played character", () => {
  const cfg = config("session-active");
  const pay = (extra: SampleExtraMatch[], at: number) => publicPayload(cfg, extra, at, onlyRyu);

  it("alternates session ↔ character, each with correct statistics; nothing plays", () => {
    mount(pay([], 100));
    // Session view: global counters (all Ryu's here) and the active character's rating by name.
    expect(title()).toBe("Sesión");
    expect(frameView()).toBe("session");
    expect(score()).toBe("9-8");
    expect(ratingName()).toBe("Ryu");
    tick(INTERVAL);
    // Character view: Ryu's own statistics, rating, rank and delta.
    expect(title()).toBe("Ryu");
    expect(frameView()).toBe("character");
    expect(score()).toBe("9-8");
    expect(text()).toContain("52,9");
    expect(text()).toContain("1684");
    tick(INTERVAL);
    expect(title()).toBe("Sesión");
    tick(INTERVAL);
    expect(title()).toBe("Ryu");
    expect(update()).toBeUndefined(); // view transitions are never match events
  });

  it("a genuine new match activates priority, which expires and the cycle resumes", () => {
    mount(pay([], 100));
    expect(title()).toBe("Sesión");
    push(pay([W("ryu")], 101)); // 18 → 19 games
    expect(title()).toBe("Ryu"); // priority: the match character's view, immediately
    expect(update()).toBe("win");
    expect(score()).toBe("10-8");
    tick(PRIORITY - 1);
    expect(title()).toBe("Ryu"); // held for the whole priority period (not the 5 s interval)
    tick(1);
    expect(title()).toBe("Sesión"); // priority expired ⇒ the cycle resumes with the session view
    expect(score()).toBe("10-8"); // global = Ryu's (single character)
    tick(INTERVAL);
    expect(title()).toBe("Ryu");
    tick(INTERVAL);
    expect(title()).toBe("Sesión");
  });
});

describe("OBS · session-all", () => {
  const cfg = config("session-all");
  const pay = (extra: SampleExtraMatch[], at: number) => publicPayload(cfg, extra, at);

  it("alternates session and characters in the expected sequence with per-view statistics", () => {
    mount(pay([], 100));
    const seen: Array<[string | null, string]> = [[title(), score()]];
    for (let i = 0; i < 6; i++) {
      tick(INTERVAL);
      seen.push([title(), score()]);
    }
    expect(seen).toEqual([
      ["Sesión", "14-14"],
      ["Ryu", "9-8"],
      ["Sesión", "14-14"],
      ["Chun-Li", "2-1"],
      ["Sesión", "14-14"],
      ["Jamie", "3-5"],
      ["Sesión", "14-14"],
    ]);
    expect(update()).toBeUndefined();
  });

  it("a new match prioritizes the right character; afterwards the order resumes correctly", () => {
    mount(pay([], 100));
    tick(INTERVAL); // Ryu
    tick(INTERVAL); // Sesión
    expect(title()).toBe("Sesión");
    push(pay([W("jamie")], 101)); // Jamie wins: 4-5
    expect(title()).toBe("Jamie");
    expect(score()).toBe("4-5");
    expect(update()).toBe("win");
    tick(PRIORITY);
    // Resume: the session view, then the character AFTER Jamie in the (recent) order. Jamie is
    // now the latest match, so the order is Jamie → Ryu → Chun-Li: next is Ryu.
    expect(title()).toBe("Sesión");
    expect(score()).toBe("15-14");
    tick(INTERVAL);
    expect(title()).toBe("Ryu");
    tick(INTERVAL);
    expect(title()).toBe("Sesión");
    tick(INTERVAL);
    expect(title()).toBe("Chun-Li");
  });

  it("stale → current → genuine new match: no replay, no priority restart, then exactly one event", () => {
    const current = pay([W("ryu")], 200); // 29 games
    mount(current);
    tick(INTERVAL); // view moves on (Ryu)
    expect(title()).toBe("Ryu");
    // 1) An OLDER snapshot (older generatedAt): LiveOverlay drops it before the renderer.
    push(pay([], 150));
    expect(score()).toBe("10-8");
    // 2) Stale CONTENT with a newer timestamp (e.g. a lagging reconnect): reaches the renderer,
    //    but the monotonic baselines ignore it.
    push(pay([], 201));
    tick(INTERVAL); // the view keeps changing meanwhile
    const viewBefore = title();
    // 3) The current data again: neither a replayed effect nor a priority jump.
    push(pay([W("ryu")], 202));
    expect(update()).toBeUndefined();
    expect(title()).toBe(viewBefore);
    // 4) A genuine new match: exactly one event and the right priority.
    push(pay([W("ryu"), W("chunli")], 203));
    expect(update()).toBe("win");
    expect(title()).toBe("Chun-Li");
    const cycle = overlay()?.dataset.updateCycle;
    push(pay([W("ryu"), W("chunli")], 204)); // repeated snapshot
    expect(overlay()?.dataset.updateCycle).toBe(cycle);
  });

  it("long cycles of view transitions never produce a Creator Motion event", () => {
    mount(pay([], 100));
    for (let i = 0; i < 24; i++) {
      tick(INTERVAL);
      expect(update()).toBeUndefined();
    }
  });
});

describe("OBS · characters (Phase 5.2 behaviour)", () => {
  const cfg = config("characters");
  const pay = (extra: SampleExtraMatch[], at: number) => publicPayload(cfg, extra, at);

  it("rotates characters with the stored statsScope and no view labels", () => {
    mount(pay([], 100));
    expect(frameView()).toBe("character");
    expect(title()).toBe("Sesión"); // the plain default title — no view label is added
    const seen = [ratingName()];
    for (let i = 0; i < 3; i++) {
      tick(INTERVAL);
      seen.push(ratingName());
      expect(title()).toBe("Sesión");
      expect(score()).toBe("14-14"); // statsScope "session" (stored) ⇒ global W/L
    }
    expect(seen).toEqual(["Ryu", "Chun-Li", "Jamie", "Ryu"]);
    expect(update()).toBeUndefined();
  });

  it("a new match prioritizes its character, plays once, and stale → current never replays", () => {
    mount(pay([], 100));
    push(pay([W("jamie")], 101));
    expect(ratingName()).toBe("Jamie");
    expect(update()).toBe("win");
    tick(PRIORITY);
    expect(ratingName()).toBe("Ryu"); // resumes after Jamie (order Jamie → Ryu → Chun-Li)
    push(pay([], 102)); // stale content, newer timestamp
    push(pay([W("jamie")], 103)); // current again
    expect(update()).toBeUndefined();
  });
});
