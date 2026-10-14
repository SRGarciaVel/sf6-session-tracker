// @vitest-environment happy-dom
/**
 * Phase 5.3C — integrated SST branding through the real renderer (fake timers): the theme's
 * designated secondary slot (Recent results) hosts the official mark in its own box; nothing is
 * reserved, moved or re-measured. Same controller and schedule as the Phase 5.3B side tab.
 * Pixel geometry (no width/height change, fit stability, legibility) is measured in a real
 * browser (docs, QA) — happy-dom has no layout.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCKUP_LAYOUT, VIEWBOX_ATTR } from "@/components/brand/geometry";
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

const IL: BrandFlag = {
  ...DEFAULT_BRAND_FLAG,
  enabled: true,
  mode: "content-interleave",
  intervalSeconds: 30,
  visibleSeconds: 3,
  animation: "fade",
  logoVariant: "full",
};
const config = (
  flag: Partial<BrandFlag> | null = {},
  over: Partial<OverlayConfig> = {},
  extras: { motion?: boolean; mode?: PresentationMode } = {},
): OverlayConfig => {
  const theme = over.theme ?? "broadcast";
  return {
    ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
    ...over,
    fields: { ...DEFAULT_OVERLAY_CONFIG.fields, recentForm: true, ...over.fields },
    creator: {
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      ...(flag === null ? {} : { brandFlag: { ...IL, ...flag } }),
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
  };
};
const sample = (extra: SampleExtraMatch[] = []) =>
  sampleMultiCharacterState("ryu", undefined, extra);
const W = (characterKey: SampleExtraMatch["characterKey"]): SampleExtraMatch => ({
  characterKey,
  result: "win",
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
const overlay = () => host.querySelector<HTMLElement>(".sf6-overlay");
const slot = () => host.querySelector<HTMLElement>(".ov-il-host");
const state = () => slot()?.dataset.il ?? null;
const brand = () => host.querySelector<HTMLElement>(".ov-il-brand");
const chipsText = () =>
  [...(slot()?.querySelectorAll(".ov-form-chip") ?? [])].map((c) => c.textContent).join("");
const update = () => overlay()?.dataset.update;
/** Structure of the overlay without the integrated layer and its state attributes. */
const skeleton = () => {
  const clone = overlay()?.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".ov-il-brand").forEach((n) => n.remove());
  clone.querySelectorAll("[data-il], [aria-hidden]").forEach((n) => {
    n.removeAttribute("data-il");
    n.removeAttribute("data-il-anim");
    n.removeAttribute("aria-hidden");
    n.classList.remove("ov-il-host");
  });
  clone.removeAttribute("style");
  return clone.outerHTML;
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

describe("Broadcast (reference): Recent results ↔ full SST logo", () => {
  it("1. the Recent results segment hosts the official full lockup, then returns exactly", () => {
    render(config());
    const before = chipsText();
    expect(before.length).toBeGreaterThan(0);
    expect(slot()?.closest(".ov-bc-form")).not.toBeNull(); // Broadcast's secondary segment
    expect(state()).toBe("hidden");
    tick(30_000);
    expect(state()).toBe("shown");
    const svg = brand()?.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${LOCKUP_LAYOUT.width} ${LOCKUP_LAYOUT.height}`);
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(brand()?.textContent).toBe("SESSIONSTATSTRACKER");
    expect(brand()?.getAttribute("aria-label")).toBe("SST");
    expect(slot()?.querySelector(".ov-form-chip")?.getAttribute("aria-hidden")).toBe("true");
    tick(3_000);
    expect(state()).toBe("hidden");
    expect(chipsText()).toBe(before);
    expect(brand()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("2. no layout container changes between states (same nodes; only the layer + attributes)", () => {
    render(config());
    const node = slot();
    const hidden = skeleton();
    tick(30_000);
    expect(slot()).toBe(node); // the very same element: nothing re-mounted
    expect(skeleton()).toBe(hidden);
    tick(3_000);
    expect(skeleton()).toBe(hidden);
  });

  it("no side row: the panel stays the overlay's first child (fit-to-box measures it as without branding)", () => {
    render(config());
    expect(host.querySelector(".ov-brand-row, .ov-brand-slot")).toBeNull();
    const first = overlay()?.firstElementChild?.className ?? "";
    render(config(null));
    expect(overlay()?.firstElementChild?.className).toBe(first);
  });
});

describe("schedule (shared 5.3B controller)", () => {
  it("3–5. first reveal after a full interval; visible time; reveals start every interval", () => {
    render(config());
    tick(29_999);
    expect(state()).toBe("hidden");
    tick(1);
    expect(state()).toBe("shown");
    tick(2_999);
    expect(state()).toBe("shown");
    tick(1);
    expect(state()).toBe("hidden");
    tick(27_000);
    expect(state()).toBe("shown");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("6. preview reveal through the same controller", () => {
    render(config(), sample(), 0);
    tick(5_000);
    render(config(), sample(), 1);
    expect(state()).toBe("shown");
    tick(3_000);
    expect(state()).toBe("hidden");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("7–9. fade, instant; animations off and reduced motion ⇒ instant", () => {
    render(config({ animation: "fade" }));
    expect(slot()?.dataset.ilAnim).toBe("fade");
    render(config({ animation: "slide" })); // a stored slide fades in a content slot
    expect(slot()?.dataset.ilAnim).toBe("fade");
    render(config({ animation: "instant" }));
    expect(slot()?.dataset.ilAnim).toBe("instant");
    render(config({ animation: "fade" }, { animations: false }));
    expect(slot()?.dataset.ilAnim).toBe("instant");
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
    render(config({ animation: "fade" }));
    expect(slot()?.dataset.ilAnim).toBe("instant");
    tick(30_000);
    expect(state()).toBe("shown"); // same schedule, instant swap
    mql.mockRestore();
  });

  it("10–12. disabled ⇒ the markup of 5.3B-off; side tab and static badge unchanged", () => {
    render(config(null));
    expect(host.querySelector(".ov-il-host, .ov-il-brand, .ov-brand-row")).toBeNull();
    render(config({ mode: "timed-tab" }));
    expect(host.querySelector(".ov-brand-row .ov-brand-slot .ov-brand-flag")).not.toBeNull();
    expect(host.querySelector(".ov-il-host")).toBeNull();
    render(config({ mode: "static-badge" }));
    expect(host.querySelector(".ov-brand-flag")?.getAttribute("data-state")).toBe("shown");
    expect(host.querySelector(".ov-il-host")).toBeNull();
  });

  it("switching between side tab and integrated restarts the schedule (meaningful change)", () => {
    render(config({ mode: "timed-tab" }));
    tick(20_000);
    render(config({ mode: "content-interleave" }));
    tick(10_000);
    expect(state()).toBe("hidden"); // the integrated schedule started over
    tick(20_000);
    expect(state()).toBe("shown");
  });
});

describe("themes and logos (19–21)", () => {
  it.each(OVERLAY_THEMES)("%s exposes its designated slot", (theme) => {
    render(config({}, { theme }));
    expect(host.querySelectorAll(".ov-il-host")).toHaveLength(1);
    tick(30_000);
    expect(state()).toBe("shown");
    const vb = brand()?.querySelector("svg")?.getAttribute("viewBox");
    // Minimal's single-line slot always uses the monogram; the others honour "full".
    expect(vb).toBe(
      theme === "minimal" ? VIEWBOX_ATTR : `0 0 ${LOCKUP_LAYOUT.width} ${LOCKUP_LAYOUT.height}`,
    );
  });

  it("monogram variant everywhere", () => {
    render(config({ logoVariant: "monogram" }));
    tick(30_000);
    expect(brand()?.querySelector("svg")?.getAttribute("viewBox")).toBe(VIEWBOX_ATTR);
    expect(brand()?.textContent).toBe("");
  });

  it("colour mode: theme text or the Creator accent", () => {
    render(config({ colorMode: "creator-accent" }));
    expect(brand()?.dataset.color).toBe("creator-accent");
  });

  it("no slot visible (Recent results off) ⇒ nothing is shown, nothing reserved", () => {
    render(config({}, { fields: { ...DEFAULT_OVERLAY_CONFIG.fields, recentForm: false } }));
    tick(30_000);
    expect(host.querySelector(".ov-il-host, .ov-brand-row")).toBeNull();
  });
});

describe("independence (22–31)", () => {
  it.each([undefined, "characters", "session-active", "session-all"] as const)(
    "22–25/31. rotation %s keeps its own cycle; a reveal never resets it",
    (mode) => {
      render(config({}, {}, mode ? { mode } : {}));
      const titles: Array<string | null> = [];
      for (let i = 0; i < 6; i++) {
        tick(5_000);
        titles.push(
          host.querySelector(".ov-bc-title, .ov-bc-tab, [class*='title']")?.textContent ?? null,
        );
      }
      expect(state()).toBe("shown"); // reveal at 30 s, regardless of the 5 s view steps
      if (mode === "session-all") expect(new Set(titles).size).toBeGreaterThan(1);
      expect(vi.getTimerCount()).toBeLessThanOrEqual(mode ? 2 : 1);
    },
  );

  it("26/30. a reveal never plays Creator Motion; a real match plays once", () => {
    render(config({}, {}, { motion: true }));
    tick(30_000);
    expect(state()).toBe("shown");
    expect(update()).toBeUndefined();
    tick(3_000);
    expect(update()).toBeUndefined();
    render(config({}, {}, { motion: true }), sample([W("ryu")]));
    expect(update()).toBe("win");
  });

  it("27–29. real OBS path: repeated + stale snapshots don't touch the schedule; a real match still plays", () => {
    const cfg = config({}, {}, { motion: true, mode: "session-all" });
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
    expect(state()).toBe("shown"); // still the original 30 s schedule
    act(() => {
      sse.handlers.state?.(pay([W("ryu"), W("jamie")], 112)); // genuine match
    });
    expect(update()).toBe("win");
  });
});

describe("long run (32)", () => {
  it("120 integrated cycles with rotation: constant DOM, one brand timer + one rotation timer", () => {
    render(config({}, {}, { mode: "session-all" }));
    tick(30_000);
    const baseline = host.getElementsByTagName("*").length;
    for (let i = 0; i < 120; i++) {
      tick(3_000);
      expect(state()).toBe("hidden");
      tick(27_000);
      expect(state()).toBe("shown");
      expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
      expect(host.querySelectorAll(".ov-il-brand")).toHaveLength(1);
    }
    expect(Math.abs(host.getElementsByTagName("*").length - baseline)).toBeLessThan(25);
  });
});
