// @vitest-environment happy-dom
/**
 * Phase 5.3A presentation modes in a real DOM (fake timers): the controller (views, one timer,
 * priority, resume, stale snapshots), Creator Motion safety across views, and the renderer
 * (six themes, view identifier, custom title, transitions + directions, fit-to-box, long run).
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

const config = (
  rotation: Partial<CharacterRotation> = {},
  over: Partial<OverlayConfig> = {},
  motion = true,
): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, over.theme ?? "competitive"),
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true, totalGames: true },
  ...over,
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    characterRotation: {
      ...DEFAULT_CHARACTER_ROTATION,
      enabled: true,
      intervalSeconds: 5,
      prioritySeconds: 10,
      mode: "session-all",
      ...rotation,
    },
    ...(motion ? { motion: DEFAULT_CREATOR_MOTION } : {}),
  },
});
// Sample: Chun-Li 2-1, Jamie 3-5, Ryu 9-8 (14-14, 28 games); latest match = Ryu; Cammy unplayed.
const sample = (extra: SampleExtraMatch[] = []) =>
  sampleMultiCharacterState("ryu", undefined, extra);
const resend = (s: PlayerLiveState, ms = 1000): PlayerLiveState => ({
  ...structuredClone(s),
  generatedAt: new Date(Date.parse(s.generatedAt) + ms).toISOString(),
});
const W = (characterKey: SampleExtraMatch["characterKey"]): SampleExtraMatch => ({
  characterKey,
  result: "win",
});
const L = (characterKey: SampleExtraMatch["characterKey"]): SampleExtraMatch => ({
  characterKey,
  result: "loss",
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
const frame = () => host.querySelector<HTMLElement>(".ov-rot-frame");
const text = () => (overlay()?.textContent ?? "").replace(/\s+/g, " ");
const title = () => host.querySelector(".ov-comp-tag")?.textContent ?? null;
/** "session" or the character name, from the view identifier in the title. */
const view = () => title();
const update = () => overlay()?.dataset.update;

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

describe("controller (33–53)", () => {
  it("33. one character in 'characters' mode: shown, no timer (Phase 5.2)", () => {
    const one = sample();
    one.session.characters = one.session.characters.map((c) =>
      c.characterKey === "ryu" ? c : { ...c, games: 0 },
    );
    render(config({ mode: "characters" }), one);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("34. one character in 'session-active': session ↔ character, one timer", () => {
    const one = sample();
    one.session.characters = one.session.characters.map((c) =>
      c.characterKey === "ryu" ? c : { ...c, games: 0 },
    );
    render(config({ mode: "session-active" }), one);
    expect(view()).toBe("Sesión");
    expect(vi.getTimerCount()).toBe(1);
    tick(5_000);
    expect(view()).toBe("Ryu");
    tick(5_000);
    expect(view()).toBe("Sesión");
  });

  it("35–36. session-all cycles S → C → S → C … with exactly one timer", () => {
    render(config({ mode: "session-all" }), sample());
    const seen = [view()];
    for (let i = 0; i < 6; i++) {
      tick(5_000);
      seen.push(view());
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(seen).toEqual(["Sesión", "Ryu", "Sesión", "Chun-Li", "Sesión", "Jamie", "Sesión"]);
  });

  it("37/52/53. turning it off clears the timer; unmount clears everything", () => {
    render(config(), sample());
    expect(vi.getTimerCount()).toBe(1);
    render(config({ enabled: false }), sample());
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector(".ov-rot-stage")).toBeNull();
    render(config(), sample());
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it("38. interval change restarts the single timer", () => {
    render(config({ intervalSeconds: 30 }), sample());
    tick(20_000);
    render(config({ intervalSeconds: 5 }), sample());
    expect(vi.getTimerCount()).toBe(1);
    tick(5_000);
    expect(view()).toBe("Ryu");
  });

  it("39. mode change: a still-valid view stays; an invalid one falls back; nothing plays", () => {
    render(config({ mode: "session-all" }), sample());
    render(config({ mode: "session-active" }), sample());
    expect(view()).toBe("Sesión");
    render(config({ mode: "characters" }), sample());
    expect(frame()?.dataset.view).toBe("character"); // session isn't a view here ⇒ first character
    expect(update()).toBeUndefined();
  });

  it("40–41. transition / direction changes apply to the next view; no extra timer", () => {
    render(config({ transition: "fade" }), sample());
    render(config({ transition: "wipe", direction: "up" }), sample());
    expect(vi.getTimerCount()).toBe(1);
    tick(5_000);
    expect(frame()?.dataset.rotTransition).toBe("wipe");
    expect(frame()?.dataset.rotDirection).toBe("up");
  });

  it("42/46. priority shows the match character's view; then the cycle resumes (session-active)", () => {
    const cfg = config({ mode: "session-active" });
    render(cfg, sample());
    render(cfg, sample([W("jamie")]));
    expect(view()).toBe("Jamie");
    tick(9_999);
    expect(view()).toBe("Jamie");
    tick(1);
    expect(view()).toBe("Sesión"); // SESIÓN → JAMIE → SESIÓN …
    tick(5_000);
    expect(view()).toBe("Jamie");
  });

  it("43. priority disabled: no interruption; session-active follows the new active character", () => {
    const cfg = config({ mode: "session-active", prioritizeLatestMatch: false });
    render(cfg, sample());
    tick(2_000);
    render(cfg, sample([W("jamie")]));
    expect(view()).toBe("Sesión");
    tick(3_000);
    expect(view()).toBe("Jamie");
  });

  it("44. same character again restarts priority without re-mounting the view", () => {
    const cfg = config();
    render(cfg, sample());
    render(cfg, sample([W("jamie")]));
    const mounted = frame();
    tick(8_000);
    render(cfg, sample([W("jamie"), L("jamie")]));
    expect(frame()).toBe(mounted);
    tick(9_999);
    expect(view()).toBe("Jamie");
  });

  it("45. another character replaces the priority (no queue)", () => {
    const cfg = config();
    render(cfg, sample());
    render(cfg, sample([W("jamie")]));
    tick(3_000);
    render(cfg, sample([W("jamie"), L("chunli")]));
    expect(view()).toBe("Chun-Li");
    tick(10_000);
    expect(view()).toBe("Sesión");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("47–50 / 64. CRITICAL: stale (while the view changes) → current → real match", () => {
    const cfg = config();
    const current = sample([W("ryu")]); // 29 games
    render(cfg, current);
    tick(5_000); // view moves on
    render(cfg, sample()); // stale (28) while views keep changing
    tick(5_000);
    const viewBefore = view();
    render(cfg, resend(current)); // current again, another view on screen
    expect(update()).toBeUndefined(); // no second victory
    expect(view()).toBe(viewBefore); // no priority restart (no jump)
    for (let i = 0; i < 3; i++) render(cfg, resend(current, 10 + i)); // 47. repeated
    expect(update()).toBeUndefined();
    render(cfg, sample([W("ryu"), L("jamie")])); // 50. a real match (30)
    expect(update()).toBe("loss");
    expect(view()).toBe("Jamie");
    const cycle = overlay()?.dataset.updateCycle;
    render(cfg, resend(sample([W("ryu"), L("jamie")])));
    expect(overlay()?.dataset.updateCycle).toBe(cycle); // exactly one event
  });

  it("51. a new session restarts at the session view with no priority and no false event", () => {
    const cfg = config();
    render(cfg, sample());
    render(cfg, sample([W("jamie")]));
    const fresh = sample([W("jamie"), W("jamie")]);
    fresh.session.sessionId = "another";
    render(cfg, fresh);
    expect(view()).toBe("Sesión");
    tick(5_000);
    expect(view()).not.toBe("Sesión");
  });

  it("21. an ended session stops the automatic presentation (normal overlay, no timers)", () => {
    const ended = sample();
    ended.session.status = "ended";
    render(config(), ended);
    expect(host.querySelector(".ov-rot-stage")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zero played characters in a mixed mode: session view only, no timer", () => {
    const none = sample();
    none.session.characters = none.session.characters.map((c) => ({ ...c, games: 0 }));
    render(config({ mode: "session-all" }), none);
    expect(view()).toBe("Sesión");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("statistics per view", () => {
  it("session view: global W/L + the active character's rating by name; character view: its own", () => {
    render(config({ mode: "session-active" }, { statsScope: "character" }), sample());
    expect(text()).toMatch(/14\D+14/); // global, although statsScope is "character"
    expect(host.querySelector(".ov-char")?.textContent).toBe("Ryu");
    tick(5_000);
    expect(view()).toBe("Ryu");
    expect(text()).toMatch(/9\D+8/);
    expect(text()).toContain("52,9");
  });
});

describe("Creator Motion across views (54–63)", () => {
  it("54–56/62. session → character → session steps and first render play nothing", () => {
    render(config(), sample());
    expect(update()).toBeUndefined();
    for (let i = 0; i < 8; i++) {
      tick(5_000);
      expect(update()).toBeUndefined();
    }
  });

  it("57. a real match plays the right result (session view on screen)", () => {
    const cfg = config({ prioritizeLatestMatch: false });
    render(cfg, sample());
    render(cfg, sample([L("chunli")]));
    expect(view()).toBe("Sesión");
    expect(update()).toBe("loss");
  });

  it("58. a real match during a priority period plays again", () => {
    const cfg = config();
    render(cfg, sample());
    render(cfg, sample([W("jamie")]));
    tick(2_000);
    render(cfg, sample([W("jamie"), W("jamie")]));
    expect(update()).toBe("win");
  });

  it("59. a different character's rating never produces a false rating update", () => {
    const cfg = config({ mode: "session-active" });
    render(cfg, sample()); // session view shows Ryu's rating
    tick(5_000); // → Ryu's own view (same character, different view)
    expect(update()).toBeUndefined();
    tick(5_000); // → session
    expect(update()).toBeUndefined();
  });

  it("63. config edits (mode, transition, direction, title, statsScope) play nothing", () => {
    render(config(), sample());
    render(config({ mode: "session-active" }), sample());
    render(config({ transition: "wipe", direction: "down" }), sample());
    render(config({}, { title: "RANKED" }), sample());
    render(config({}, { statsScope: "character" }), sample());
    expect(update()).toBeUndefined();
  });

  it("60–61. reduced motion / animations off: instant views, no motion, still rotating", () => {
    render(config({ transition: "slide" }, { animations: false }), sample());
    tick(5_000);
    expect(frame()?.dataset.rotTransition).toBe("instant");
    expect(frame()?.dataset.rotDirection).toBeUndefined();
    expect(overlay()?.dataset.motionStyle).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    const mql = vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          matches: q.includes("reduce"),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    render(config({ transition: "wipe" }), sample());
    tick(5_000);
    expect(view()).toBe("Ryu");
    expect(frame()?.dataset.rotTransition).toBe("instant");
    mql.mockRestore();
  });
});

describe("renderer (73–88)", () => {
  it.each(OVERLAY_THEMES)("73–78/86. %s identifies the view (session ↔ character)", (theme) => {
    render(config({}, { theme }), sample());
    expect(text()).toContain("Sesión");
    tick(5_000);
    expect(text()).toContain("Ryu");
    expect(text()).not.toContain("Sesión");
    expect(host.querySelectorAll(".ov-rot-frame")).toHaveLength(1);
  });

  it("85. a custom title is kept and the view label appended", () => {
    render(config({}, { title: "RANKED", showTitle: true }), sample());
    expect(title()).toBe("RANKED · Sesión");
    tick(5_000);
    expect(title()).toBe("RANKED · Ryu");
  });

  it("'characters' mode keeps the Phase 5.2 look (no view label)", () => {
    render(config({ mode: "characters" }, { title: "RANKED", showTitle: true }), sample());
    expect(title()).toBe("RANKED");
  });

  it("79–83. fade / slide / wipe / instant and the four directions (only where they apply)", () => {
    for (const transition of ["fade", "slide", "wipe", "instant"] as const) {
      for (const direction of ["left", "right", "up", "down"] as const) {
        render(config({ transition, direction }), sample());
        expect(frame()?.dataset.rotTransition).toBeUndefined(); // nothing on first mount
        tick(5_000);
        expect(frame()?.dataset.rotTransition).toBe(transition);
        expect(frame()?.dataset.rotDirection).toBe(
          transition === "slide" || transition === "wipe" ? direction : undefined,
        );
        act(() => root.unmount());
        root = createRoot(host);
      }
    }
  });

  it("84. fit-to-box still measures the theme panel (stage > frame > panel)", () => {
    render(config({ transition: "wipe" }), sample());
    tick(5_000);
    const stage = overlay()?.firstElementChild;
    expect(stage?.className).toBe("ov-rot-stage");
    expect(stage?.firstElementChild?.className).toBe("ov-rot-frame");
    expect(stage?.firstElementChild?.firstElementChild?.className).toContain("ov-panel");
  });

  it("87–88. long run: 120 view changes + matches — constant DOM, one rotation timer", () => {
    const cfg = config({ transition: "wipe" }, { statsScope: "character" });
    let extra: SampleExtraMatch[] = [];
    render(cfg, sample(extra));
    tick(5_000);
    const baseline = host.getElementsByTagName("*").length;
    let changes = 0;
    let last = view();
    const keys = ["ryu", "chunli", "jamie"] as const;
    for (let i = 0; i < 160; i++) {
      if (i % 8 === 7) {
        extra = [...extra, (i % 2 ? W : L)(keys[i % 3] ?? "ryu")];
        render(cfg, sample(extra));
      } else tick(5_000);
      if (view() !== last) changes++;
      last = view();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // rotation + one motion clear at most
      expect(host.querySelectorAll(".ov-rot-frame")).toHaveLength(1);
    }
    tick(20_000);
    expect(changes).toBeGreaterThanOrEqual(100);
    expect(Math.abs(host.getElementsByTagName("*").length - baseline)).toBeLessThan(25);
    expect(vi.getTimerCount()).toBe(1);
  });
});
