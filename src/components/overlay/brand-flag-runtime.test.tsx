// @vitest-environment happy-dom
/**
 * SST Brand Flag in a real DOM (Phase 5.3B, fake timers): the controller's schedule and timer
 * lifecycle, the renderer (official mark, positions, structure fit-to-box relies on), and its
 * independence from presentation rotation, latest-match priority, Creator Motion and the OBS
 * public payload. Pixel geometry (containment, occlusion, layout shift) is verified in a real
 * browser (docs/creator-overlays.md, measured QA) — happy-dom has no layout.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LETTERS } from "@/components/brand/geometry";
import { DEFAULT_BRAND_FLAG, type BrandFlag } from "@/domain/overlay/brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION, type PresentationMode } from "@/domain/overlay/rotation";
import { sampleMultiCharacterState, type SampleExtraMatch } from "@/domain/overlay/sample-session";
import {
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
const { OverlayView } = await import("./OverlayView");
const { LiveOverlay } = await import("./LiveOverlay");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FLAG: BrandFlag = {
  ...DEFAULT_BRAND_FLAG,
  enabled: true,
  intervalSeconds: 30,
  visibleSeconds: 3,
};
const config = (
  flag: Partial<BrandFlag> | null = {},
  over: Partial<OverlayConfig> = {},
  extras: { motion?: boolean; mode?: PresentationMode } = {},
): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, over.theme ?? "competitive"),
  ...over,
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    ...(flag === null ? {} : { brandFlag: { ...FLAG, ...flag } }),
    ...(extras.motion ? { motion: DEFAULT_CREATOR_MOTION } : {}),
    ...(extras.mode
      ? {
          characterRotation: {
            ...DEFAULT_CHARACTER_ROTATION,
            enabled: true,
            mode: extras.mode,
            intervalSeconds: 5 as const,
            prioritySeconds: 10 as const,
          },
        }
      : {}),
  },
});
const sample = (extra: SampleExtraMatch[] = []) =>
  sampleMultiCharacterState("ryu", undefined, extra);
const W = (characterKey: SampleExtraMatch["characterKey"]): SampleExtraMatch => ({
  characterKey,
  result: "win",
});
const resend = (s: PlayerLiveState, ms = 1000): PlayerLiveState => ({
  ...structuredClone(s),
  generatedAt: new Date(Date.parse(s.generatedAt) + ms).toISOString(),
});

let host: HTMLDivElement;
let root: Root;
const render = (cfg: OverlayConfig, live: PlayerLiveState = sample(), signal = 0) =>
  act(() => {
    root.render(
      <OverlayView
        config={cfg}
        live={live}
        sizing={{ mode: "box", width: 800, height: 180 }}
        brandRevealSignal={signal}
      />,
    );
  });
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const flagEl = () => host.querySelector<HTMLElement>(".ov-brand-flag");
const state = () => flagEl()?.dataset.state ?? null;
const overlay = () => host.querySelector<HTMLElement>(".sf6-overlay");
const update = () => overlay()?.dataset.update;
const viewTitle = () => host.querySelector(".ov-comp-tag")?.textContent ?? null;

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

describe("controller (13–28)", () => {
  it("13–17. starts hidden; reveals after a full interval; visible for visibleSeconds; repeats every interval", () => {
    render(config());
    expect(state()).toBe("hidden");
    expect(vi.getTimerCount()).toBe(1);
    tick(29_999);
    expect(state()).toBe("hidden");
    tick(1);
    expect(state()).toBe("shown"); // reveal starts at 30 s
    tick(2_999);
    expect(state()).toBe("shown");
    tick(1);
    expect(state()).toBe("hidden"); // retracted at 33 s
    tick(26_999);
    expect(state()).toBe("hidden");
    tick(1);
    expect(state()).toBe("shown"); // next reveal STARTS at 60 s (interval between starts)
  });

  it("18. never more than one timer across many cycles", () => {
    render(config());
    for (let i = 0; i < 40; i++) {
      tick(15_000);
      expect(vi.getTimerCount()).toBe(1);
    }
  });

  it("19–20. disabling clears the timer and removes the DOM; unmount clears everything", () => {
    render(config());
    render(config({ enabled: false }));
    expect(vi.getTimerCount()).toBe(0);
    expect(host.querySelector(".ov-brand-row")).toBeNull();
    render(config());
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it("21. static badge: always shown, no timer", () => {
    render(config({ mode: "static-badge" }));
    expect(state()).toBe("shown");
    expect(vi.getTimerCount()).toBe(0);
    tick(600_000);
    expect(state()).toBe("shown");
  });

  it("22–23. mode / interval changes restart the schedule from hidden (one timer)", () => {
    render(config());
    tick(30_000);
    expect(state()).toBe("shown");
    render(config({ mode: "static-badge" }));
    expect(vi.getTimerCount()).toBe(0);
    render(config({ mode: "timed-tab", intervalSeconds: 60 }));
    expect(state()).toBe("hidden");
    expect(vi.getTimerCount()).toBe(1);
    tick(59_999);
    expect(state()).toBe("hidden");
    tick(1);
    expect(state()).toBe("shown");
  });

  it("cosmetic changes (position, logo, colour, animation) never restart the schedule", () => {
    render(config());
    tick(20_000);
    render(
      config({
        position: "left",
        logoVariant: "full",
        colorMode: "creator-accent",
        animation: "fade",
      }),
    );
    tick(10_000);
    expect(state()).toBe("shown"); // still on the original 30 s schedule
  });

  it("24–25. repeated snapshots and new matches never restart or touch it", () => {
    let live = sample();
    render(config(), live);
    tick(20_000);
    for (let i = 1; i <= 10; i++) render(config(), resend(live, i));
    live = sample([W("jamie")]);
    render(config(), live);
    tick(10_000);
    expect(state()).toBe("shown"); // still revealed at 30 s
    expect(vi.getTimerCount()).toBe(1);
  });

  it("26. preview reveal: shows now through the same controller, retracts, then the cycle goes on", () => {
    render(config(), sample(), 0);
    tick(5_000);
    render(config(), sample(), 1); // "Probar aparición"
    expect(state()).toBe("shown");
    tick(3_000);
    expect(state()).toBe("hidden");
    tick(27_000); // then a normal reveal one interval after the previous start
    expect(state()).toBe("shown");
    render(config(), sample(), 1); // the same signal again: nothing
    expect(vi.getTimerCount()).toBe(1);
  });

  it("27–28. reduced motion / animations off: instant (no transition), still on schedule", () => {
    render(config({}, { animations: false }));
    expect(flagEl()?.dataset.anim).toBe("instant");
    tick(30_000);
    expect(state()).toBe("shown");
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
    render(config({ animation: "slide" }));
    expect(flagEl()?.dataset.anim).toBe("instant");
    tick(30_000);
    expect(state()).toBe("shown");
    mql.mockRestore();
  });
});

describe("renderer (29–40)", () => {
  it("29/32. the OFFICIAL SST geometry (monogram; full = monogram + Session Stats Tracker)", () => {
    render(config({ mode: "static-badge" }));
    const html = flagEl()?.innerHTML ?? "";
    for (const d of Object.values(LETTERS)) expect(html).toContain(d);
    expect(flagEl()?.getAttribute("aria-label")).toBe("SST");
    render(config({ mode: "static-badge", logoVariant: "full" }));
    expect(flagEl()?.textContent).toBe("SessionStatsTracker");
    expect(flagEl()?.innerHTML).toContain(LETTERS.t);
    expect(flagEl()?.querySelector("img")).toBeNull(); // inline vector: no image request
  });

  it("30–31. right = [panel][flag]; left = row-reverse (DOM order stable)", () => {
    render(config({ position: "right" }));
    const row = overlay()?.firstElementChild as HTMLElement;
    expect(row.className).toBe("ov-brand-row");
    expect(row.dataset.brandPosition).toBe("right");
    expect(row.lastElementChild?.className).toBe("ov-brand-slot");
    render(config({ position: "left" }));
    expect((overlay()?.firstElementChild as HTMLElement).dataset.brandPosition).toBe("left");
  });

  it("33–36. the flag lives in its own slot beside the panel (never inside it, never over it)", () => {
    render(config());
    const row = overlay()?.firstElementChild as HTMLElement;
    const [panel, slot] = [...row.children];
    expect(panel?.className).toContain("ov-panel");
    expect(slot?.className).toBe("ov-brand-slot");
    expect(panel?.querySelector(".ov-brand-flag")).toBeNull();
  });

  it("37–38. colour mode: theme accent or the Creator accent", () => {
    render(config({ colorMode: "theme" }));
    expect((host.querySelector(".ov-brand-slot") as HTMLElement).dataset.color).toBe("theme");
    render(config({ colorMode: "creator-accent" }));
    expect((host.querySelector(".ov-brand-slot") as HTMLElement).dataset.color).toBe(
      "creator-accent",
    );
  });

  it.each(OVERLAY_THEMES)("39. %s renders the flag through the same shared component", (theme) => {
    render(config({ mode: "static-badge" }, { theme }));
    expect(host.querySelectorAll(".ov-brand-flag")).toHaveLength(1);
    expect(host.querySelectorAll(".ov-brand-row")).toHaveLength(1);
  });

  it("no flag ⇒ the DOM is exactly the pre-5.3B structure", () => {
    render(config(null));
    expect(host.querySelector(".ov-brand-row")).toBeNull();
    expect((overlay()?.firstElementChild as HTMLElement).className).toContain("ov-panel");
  });
});

describe("independence from 5.0 / 5.2 / 5.3A (50–58)", () => {
  it.each([undefined, "characters", "session-active", "session-all"] as const)(
    "50–53. rotation %s: views rotate on their own schedule, the flag on its own",
    (mode) => {
      render(config({}, {}, mode ? { mode } : {}));
      const titles = new Set<string | null>();
      for (let i = 0; i < 6; i++) {
        tick(5_000);
        titles.add(viewTitle());
      }
      expect(state()).toBe("shown"); // 30 s
      if (mode === "session-all" || mode === "session-active")
        expect(titles.size).toBeGreaterThan(1);
      tick(3_000);
      expect(state()).toBe("hidden");
      expect(vi.getTimerCount()).toBeLessThanOrEqual(mode ? 2 : 1); // rotation + flag
    },
  );

  it("54–55. the flag never plays motion; a real match still prioritizes and plays once", () => {
    render(config({}, {}, { motion: true, mode: "session-all" }));
    tick(30_000); // flag reveal
    expect(state()).toBe("shown");
    expect(update()).toBeUndefined();
    tick(3_000); // flag retract
    expect(update()).toBeUndefined();
    render(config({}, {}, { motion: true, mode: "session-all" }), sample([W("jamie")]));
    expect(update()).toBe("win");
    expect(viewTitle()).toBe("Jamie");
  });

  it("56–58. real OBS path (public payload): repeated + stale snapshots don't touch the flag or replay", () => {
    const cfg = config({}, {}, { motion: true, mode: "session-active" });
    const pay = (extra: SampleExtraMatch[], at: number): OverlayPayload => {
      const l = sample(extra);
      return {
        config: cfg,
        live: toPublicLiveState({ ...l, generatedAt: new Date(at * 1000).toISOString() }),
      };
    };
    act(() => root.render(<LiveOverlay token="t" initial={pay([W("ryu")], 100)} />));
    tick(20_000);
    for (let i = 1; i <= 5; i++)
      act(() => {
        sse.handlers.state?.(pay([W("ryu")], 100 + i));
      });
    act(() => {
      sse.handlers.state?.(pay([], 110)); // stale content, newer timestamp
    });
    act(() => {
      sse.handlers.state?.(pay([W("ryu")], 111)); // current again
    });
    expect(update()).toBeUndefined();
    tick(10_000);
    expect(state()).toBe("shown"); // flag kept its 30 s schedule throughout
    act(() => {
      sse.handlers.state?.(pay([W("ryu"), W("jamie")], 112)); // genuine match
    });
    expect(update()).toBe("win");
    expect(state()).toBe("shown");
  });

  it("long run: 120 flag cycles with rotation — constant DOM, at most rotation + flag timers", () => {
    render(config({}, {}, { mode: "session-all" }));
    tick(30_000);
    const baseline = host.getElementsByTagName("*").length;
    let reveals = 0;
    for (let i = 0; i < 120; i++) {
      tick(3_000); // visible time over
      expect(state()).toBe("hidden");
      tick(27_000); // next reveal starts one interval after the previous start
      expect(state()).toBe("shown");
      reveals++;
      expect(vi.getTimerCount()).toBeLessThanOrEqual(2); // rotation + flag
      expect(host.querySelectorAll(".ov-brand-flag")).toHaveLength(1);
    }
    expect(reveals).toBeGreaterThanOrEqual(100);
    expect(Math.abs(host.getElementsByTagName("*").length - baseline)).toBeLessThan(25);
  });
});
