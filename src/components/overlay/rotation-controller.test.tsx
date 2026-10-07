// @vitest-environment happy-dom
/**
 * Character rotation controller + renderer in a real DOM (Phase 5.2): timers, cleanup, priority,
 * Creator Motion interplay, transitions and long-run stability. Fake timers only (no waiting).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION, type CharacterRotation } from "@/domain/overlay/rotation";
import { sampleMultiCharacterState, type SampleExtraMatch } from "@/domain/overlay/sample-session";
import type { PlayerLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROT: CharacterRotation = { ...DEFAULT_CHARACTER_ROTATION, enabled: true };
const config = (
  rotation: Partial<CharacterRotation> | null = {},
  over: Partial<OverlayConfig> = {},
  motion = false,
): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, over.theme ?? "competitive"),
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true, totalGames: true },
  ...over,
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    ...(rotation === null ? {} : { characterRotation: { ...ROT, ...rotation } }),
    ...(motion ? { motion: DEFAULT_CREATOR_MOTION } : {}),
  },
});
const sample = (extra: SampleExtraMatch[] = []) =>
  sampleMultiCharacterState("ryu", undefined, extra);
/** Same data, a newer snapshot (what an SSE push / reconnect delivers). */
const resend = (s: PlayerLiveState, ms = 1000): PlayerLiveState => ({
  ...structuredClone(s),
  generatedAt: new Date(Date.parse(s.generatedAt) + ms).toISOString(),
});

let host: HTMLDivElement;
let root: Root;
const render = (cfg: OverlayConfig, live: PlayerLiveState) =>
  act(() => {
    root.render(
      <OverlayView config={cfg} live={live} sizing={{ mode: "box", width: 800, height: 180 }} />,
    );
  });
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const overlay = () => host.querySelector<HTMLElement>(".sf6-overlay");
const shownName = () => host.querySelector(".ov-char")?.textContent?.trim() ?? null;
const text = () => (overlay()?.textContent ?? "").replace(/\s+/g, " ");
const frame = () => host.querySelector<HTMLElement>(".ov-rot-frame");

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

describe("controller (17–36)", () => {
  it("17. rotation off: config's character, no stage, no timers", () => {
    render(config({ enabled: false }), sample());
    expect(shownName()).toBe("Ryu");
    expect(host.querySelector(".ov-rot-stage")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    tick(60_000);
    expect(shownName()).toBe("Ryu");
  });

  it("18–19. rotation on: one timer, advances every interval in order (recent) and wraps", () => {
    render(config({ intervalSeconds: 5 }), sample());
    expect(shownName()).toBe("Ryu");
    expect(vi.getTimerCount()).toBe(1);
    tick(4_999);
    expect(shownName()).toBe("Ryu");
    tick(1);
    expect(shownName()).toBe("Chun-Li");
    tick(5_000);
    expect(shownName()).toBe("Jamie");
    tick(5_000);
    expect(shownName()).toBe("Ryu"); // wrap-around
    expect(vi.getTimerCount()).toBe(1);
  });

  it("20. interval change restarts the single timer with the new delay", () => {
    render(config({ intervalSeconds: 30 }), sample());
    tick(20_000);
    render(config({ intervalSeconds: 5 }), sample());
    expect(vi.getTimerCount()).toBe(1);
    tick(5_000);
    expect(shownName()).toBe("Chun-Li");
  });

  it("21. order change applies to the next step without jumping now", () => {
    render(config({ intervalSeconds: 5 }), sample());
    render(config({ intervalSeconds: 5, order: "alphabetical" }), sample());
    expect(shownName()).toBe("Ryu"); // visible character kept
    tick(5_000);
    expect(shownName()).toBe("Chun-Li"); // alphabetical: Chun-Li, Jamie, Ryu → after Ryu wraps
    tick(5_000);
    expect(shownName()).toBe("Jamie");
  });

  it("22. transition change applies to the next character; no extra timer", () => {
    render(config({ intervalSeconds: 5, transition: "fade" }), sample());
    render(config({ intervalSeconds: 5, transition: "slide" }), sample());
    expect(vi.getTimerCount()).toBe(1);
    tick(5_000);
    expect(frame()?.dataset.rotTransition).toBe("slide");
  });

  it("23–24. turning rotation off clears its timer; unmount clears everything", () => {
    render(config(), sample());
    expect(vi.getTimerCount()).toBe(1);
    render(config({ enabled: false }), sample());
    expect(vi.getTimerCount()).toBe(0);
    render(config(), sample());
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host); // for afterEach
  });

  it("25. a single eligible character: shown, zero timers", () => {
    const one = sample();
    one.session.characters = one.session.characters.map((c) =>
      c.characterKey === "ryu" ? c : { ...c, games: 0 },
    );
    render(config(), one);
    expect(shownName()).toBe("Ryu");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zero eligible characters: normal overlay, zero timers", () => {
    const none = sample();
    none.session.characters = none.session.characters.map((c) => ({ ...c, games: 0 }));
    render(config(), none);
    expect(host.querySelector(".ov-rot-stage")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("26/28/35. repeated snapshots (SSE pushes, reconnects) neither add nor restart timers", () => {
    const s = sample();
    render(config({ intervalSeconds: 10 }), s);
    tick(6_000);
    for (let i = 1; i <= 20; i++) render(config({ intervalSeconds: 10 }), resend(s, i));
    expect(vi.getTimerCount()).toBe(1);
    tick(4_000); // not restarted: still fires at 10 s from the start
    expect(shownName()).toBe("Chun-Li");
  });

  it("29. a new match prioritizes its character immediately and holds it for prioritySeconds", () => {
    render(config({ intervalSeconds: 5, prioritySeconds: 20 }), sample());
    render(
      config({ intervalSeconds: 5, prioritySeconds: 20 }),
      sample([{ characterKey: "jamie", result: "win" }]),
    );
    expect(shownName()).toBe("Jamie");
    tick(19_999);
    expect(shownName()).toBe("Jamie");
    tick(1);
    // 33. resumes with the character after Jamie in the (recent) order: Jamie, Ryu, Chun-Li.
    expect(shownName()).toBe("Ryu");
  });

  it("30. another match with the same character restarts the period (no transition)", () => {
    const cfg = config({ intervalSeconds: 5, prioritySeconds: 10 });
    render(cfg, sample());
    render(cfg, sample([{ characterKey: "jamie", result: "win" }]));
    const mounted = frame();
    tick(8_000);
    render(
      cfg,
      sample([
        { characterKey: "jamie", result: "win" },
        { characterKey: "jamie", result: "loss" },
      ]),
    );
    expect(frame()).toBe(mounted); // same element: no re-mount, no transition
    tick(9_999);
    expect(shownName()).toBe("Jamie");
    tick(1);
    expect(shownName()).not.toBe("Jamie");
  });

  it("31. a match with another character replaces the priority (no queue)", () => {
    const cfg = config({ prioritySeconds: 10 });
    render(cfg, sample());
    render(cfg, sample([{ characterKey: "jamie", result: "win" }]));
    tick(3_000);
    const m2 = sample([
      { characterKey: "jamie", result: "win" },
      { characterKey: "chunli", result: "loss" },
    ]);
    render(cfg, m2);
    expect(shownName()).toBe("Chun-Li");
    tick(10_000);
    expect(shownName()).not.toBe("Chun-Li");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("32. priority disabled: matches update numbers but the cycle is not interrupted", () => {
    const cfg = config({ prioritizeLatestMatch: false, intervalSeconds: 5 });
    render(cfg, sample());
    tick(2_000);
    render(cfg, sample([{ characterKey: "jamie", result: "win" }]));
    expect(shownName()).toBe("Ryu");
    tick(3_000);
    expect(shownName()).not.toBe("Ryu");
  });

  it("34. roster change during priority: a new character joins; the prioritized one stays", () => {
    const cfg = config({ prioritySeconds: 10 });
    render(cfg, sample());
    render(cfg, sample([{ characterKey: "cammy", result: "win" }])); // first Cammy match ever
    expect(shownName()).toBe("Cammy");
    tick(10_000);
    expect(shownName()).toBe("Ryu"); // recent: Cammy, Ryu, Chun-Li, Jamie
  });

  it("27. a new session clears the priority and is a baseline (not a match)", () => {
    const cfg = config({ prioritySeconds: 60 }, {}, true);
    render(cfg, sample());
    render(cfg, sample([{ characterKey: "jamie", result: "win" }]));
    expect(shownName()).toBe("Jamie");
    const next = sample([
      { characterKey: "jamie", result: "win" },
      { characterKey: "jamie", result: "win" },
    ]);
    next.session.sessionId = "another-session";
    render(cfg, next);
    expect(overlay()?.dataset.update).toBeUndefined(); // no false victory
    expect(shownName()).toBe("Jamie"); // fresh cycle starts at the first (recent) character
    tick(10_000);
    expect(shownName()).toBe("Ryu"); // the cycle runs (no 60 s priority left over)
  });

  it("36. an older snapshot (rewind) never triggers priority or a match", () => {
    const cfg = config({}, {}, true);
    const newer = sample([{ characterKey: "jamie", result: "win" }]);
    render(cfg, newer);
    render(cfg, sample()); // fewer games (stale)
    expect(overlay()?.dataset.update).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stale → current snapshots never restart priority (also during a priority period)", () => {
    const cfg = config({ intervalSeconds: 5, prioritySeconds: 10 }, {}, true);
    const twenty = sample([{ characterKey: "ryu", result: "win" }]);
    const nineteen = sample();
    render(cfg, twenty);
    render(cfg, nineteen); // stale
    render(cfg, resend(twenty)); // current again: not a match
    expect(shownName()).toBe("Ryu");
    tick(5_000);
    expect(shownName()).toBe("Chun-Li"); // the interval cycle kept running (no priority)

    // A legitimate match: priority once.
    const jamie = sample([
      { characterKey: "ryu", result: "win" },
      { characterKey: "jamie", result: "win" },
    ]);
    render(cfg, jamie);
    expect(shownName()).toBe("Jamie");
    tick(6_000);
    render(cfg, twenty); // stale during the priority period
    render(cfg, resend(jamie)); // current again
    tick(4_000); // the ORIGINAL 10 s period ends (not restarted at 6 s)
    expect(shownName()).not.toBe("Jamie");
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
  });

  it("ended session: no rotation, normal overlay (final summary semantics kept)", () => {
    const ended = sample();
    ended.session.status = "ended";
    render(config(), ended);
    expect(host.querySelector(".ov-rot-stage")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("statistics stay coherent with the rotated character (37–43)", () => {
  it("session scope: global W/L; rating, rank and name follow the character", () => {
    render(config({ intervalSeconds: 5 }, { statsScope: "session" }), sample());
    expect(text()).toContain("1684");
    tick(5_000);
    expect(shownName()).toBe("Chun-Li");
    expect(text()).toMatch(/21[.,]150/);
    expect(text()).toContain("Diamond 2");
    expect(text()).toMatch(/14\s*\/\s*\w*\s*14|14.*14/);
    tick(5_000);
    expect(text()).toContain("Platinum 4");
  });

  it("character scope: W/L, win rate, streak, delta all belong to the shown character", () => {
    const cfg = config(
      { intervalSeconds: 5 },
      { statsScope: "character", ratingCharacterKey: "ryu" },
    );
    render(cfg, sample());
    tick(5_000); // Chun-Li 2-1
    expect(shownName()).toBe("Chun-Li");
    expect(text()).toContain("66,7");
    expect(text()).toContain("+150");
    tick(5_000); // Jamie 3-5
    expect(shownName()).toBe("Jamie");
    expect(text()).toContain("37,5");
    expect(text()).toMatch(/[-−]260/);
    expect(text()).not.toContain("66,7");
  });

  it("78. the pinned character is restored as soon as rotation is turned off", () => {
    const pinned = (on: boolean) =>
      config({ enabled: on, intervalSeconds: 5 }, { ratingCharacterKey: "jamie" });
    render(pinned(true), sample());
    expect(shownName()).toBe("Ryu"); // rotation replaces the pinned choice temporarily
    tick(5_000);
    render(pinned(false), sample());
    expect(shownName()).toBe("Jamie");
    expect(pinned(true).ratingCharacterKey).toBe("jamie"); // never written by rotation
  });
});

describe("Creator Motion with rotation (45–54)", () => {
  const cfg = (over: Partial<OverlayConfig> = {}, rot: Partial<CharacterRotation> = {}) =>
    config({ intervalSeconds: 5, ...rot }, { statsScope: "character", ...over }, true);

  it("45/51. rotation steps and the first render never set data-update", () => {
    render(cfg(), sample());
    expect(overlay()?.dataset.update).toBeUndefined();
    for (let i = 0; i < 6; i++) {
      tick(5_000);
      expect(overlay()?.dataset.update).toBeUndefined();
    }
  });

  it("46/50. config edits (character pin, theme, locale, scope) never set data-update", () => {
    render(cfg(), sample());
    render(cfg({ ratingCharacterKey: "jamie" }), sample());
    render(cfg({ theme: "fighter" }), sample());
    render(cfg({ locale: "en" }), sample());
    render(cfg({ statsScope: "session" }), sample());
    render(cfg({}, { enabled: false }), sample());
    render(cfg(), sample());
    expect(overlay()?.dataset.update).toBeUndefined();
  });

  it("47. a real match of the visible character plays", () => {
    render(cfg(), sample());
    render(cfg(), sample([{ characterKey: "ryu", result: "win" }]));
    expect(overlay()?.dataset.update).toBe("win");
  });

  it("48–49. a match that moves to its character (priority) still plays its result", () => {
    render(cfg(), sample());
    render(cfg(), sample([{ characterKey: "jamie", result: "loss" }]));
    expect(shownName()).toBe("Jamie");
    expect(overlay()?.dataset.update).toBe("loss");
    tick(2_000);
    // Another match during the priority period.
    render(
      cfg(),
      sample([
        { characterKey: "jamie", result: "loss" },
        { characterKey: "jamie", result: "win" },
      ]),
    );
    expect(overlay()?.dataset.update).toBe("win");
  });

  it("stale → current while another character is rotated in never replays the match", () => {
    const c = cfg({}, { prioritizeLatestMatch: false });
    const current = sample([{ characterKey: "ryu", result: "win" }]);
    render(c, sample());
    render(c, current); // real match: plays once
    expect(overlay()?.dataset.update).toBe("win");
    tick(5_000); // rotation moves to another character
    expect(shownName()).not.toBe("Ryu");
    render(c, sample()); // stale snapshot (fewer games) while that character is shown
    tick(5_000); // rotation moves on again
    render(c, resend(current)); // current data again
    // The first effect has long finished; no second event appears.
    expect(overlay()?.dataset.update).toBeUndefined();
    // A genuine match afterwards still plays exactly once.
    render(
      c,
      sample([
        { characterKey: "ryu", result: "win" },
        { characterKey: "jamie", result: "loss" },
      ]),
    );
    expect(overlay()?.dataset.update).toBe("loss");
  });

  it("stale → current during a priority switch keeps the single match event", () => {
    const c = cfg({}, { prioritySeconds: 10 });
    render(c, sample());
    const jamie = sample([{ characterKey: "jamie", result: "win" }]);
    render(c, jamie); // priority switch to Jamie + match event
    expect(overlay()?.dataset.update).toBe("win");
    const seq = overlay()?.dataset.updateCycle;
    render(c, sample()); // stale
    render(c, resend(jamie)); // current again
    expect(overlay()?.dataset.updateCycle).toBe(seq);
    expect(shownName()).toBe("Jamie");
  });

  it("priority disabled: a match of another character still plays (real result)", () => {
    render(cfg({}, { prioritizeLatestMatch: false }), sample());
    render(
      cfg({}, { prioritizeLatestMatch: false }),
      sample([{ characterKey: "jamie", result: "win" }]),
    );
    expect(shownName()).toBe("Ryu");
    expect(overlay()?.dataset.update).toBe("win");
  });

  it("52. re-renders with the same data never duplicate the event", () => {
    render(cfg(), sample());
    const after = sample([{ characterKey: "ryu", result: "win" }]);
    render(cfg(), after);
    const cycle = overlay()?.dataset.updateCycle;
    render(cfg(), resend(after));
    render(cfg(), resend(after, 2));
    expect(overlay()?.dataset.updateCycle).toBe(cycle);
  });

  it("53. animations off: no motion profile; rotation still runs, instantly", () => {
    render(config({ intervalSeconds: 5 }, { animations: false }, true), sample());
    tick(5_000);
    expect(shownName()).toBe("Chun-Li");
    expect(frame()?.dataset.rotTransition).toBe("instant");
    expect(overlay()?.dataset.motionStyle).toBeUndefined();
  });

  it("54. reduced motion: instant transitions, no motion effects, correct character", () => {
    const mql = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("reduce"),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(config({ intervalSeconds: 5, transition: "slide" }, {}, true), sample());
    tick(5_000);
    expect(shownName()).toBe("Chun-Li");
    expect(frame()?.dataset.rotTransition).toBe("instant");
    expect(overlay()?.dataset.motionStyle).toBeUndefined();
    mql.mockRestore();
  });
});

describe("renderer (79–92)", () => {
  it.each(OVERLAY_THEMES)("79–84. %s rotates through the same controller (one stage)", (theme) => {
    render(config({ intervalSeconds: 5 }, { theme, statsScope: "character" }), sample());
    const before = text();
    tick(5_000);
    expect(host.querySelectorAll(".ov-rot-stage").length).toBe(1);
    expect(host.querySelectorAll(".ov-rot-frame").length).toBe(1);
    expect(text()).not.toBe(before);
  });

  it("85–87. fade / slide / instant set the one-shot transition; none on first mount", () => {
    for (const transition of ["fade", "slide", "instant"] as const) {
      render(config({ intervalSeconds: 5, transition }), sample());
      expect(frame()?.dataset.rotTransition).toBeUndefined();
      tick(5_000);
      expect(frame()?.dataset.rotTransition).toBe(transition);
      act(() => root.unmount());
      root = createRoot(host);
    }
  });

  it("90. stage (static) > frame (animated) > theme panel — fit-to-box measures the panel, as without rotation", () => {
    render(config({ intervalSeconds: 5, transition: "slide" }), sample());
    tick(5_000);
    const stage = overlay()?.firstElementChild;
    expect(stage?.className).toBe("ov-rot-stage");
    expect(stage?.getAttribute("data-rot-transition")).toBeNull();
    expect(stage?.firstElementChild?.className).toBe("ov-rot-frame");
  });

  it("91–92. long run: 120 transitions + 30 matches — constant DOM size, one timer", () => {
    const cfg = config(
      { intervalSeconds: 5, prioritySeconds: 10 },
      { statsScope: "character" },
      true,
    );
    let extra: SampleExtraMatch[] = [];
    render(cfg, sample(extra));
    tick(5_000);
    const baseline = host.getElementsByTagName("*").length;
    let transitions = 0;
    let last = shownName();
    const keys = ["ryu", "chunli", "jamie"] as const;
    for (let i = 0; i < 150; i++) {
      if (i % 5 === 4) {
        extra = [...extra, { characterKey: keys[i % 3] ?? "ryu", result: i % 2 ? "win" : "loss" }];
        render(cfg, sample(extra));
      } else {
        tick(5_000);
      }
      if (shownName() !== last) transitions++;
      last = shownName();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // rotation + one motion clear at most
      expect(host.querySelectorAll(".ov-rot-frame").length).toBe(1);
      expect(host.querySelectorAll(".ov-m-sweep").length).toBeLessThanOrEqual(1);
    }
    tick(20_000);
    expect(transitions).toBeGreaterThanOrEqual(60);
    // Element count stays within a small band (forms/streak cells differ per character).
    expect(Math.abs(host.getElementsByTagName("*").length - baseline)).toBeLessThan(25);
    expect(vi.getTimerCount()).toBe(1);
  });
});
