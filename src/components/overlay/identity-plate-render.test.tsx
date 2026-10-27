// @vitest-environment happy-dom
/**
 * M2D — the identity plate through the real renderer, in all six themes: on / off, identity
 * from ratingParts (active character, pinned key, rotation-free character change), no stale
 * plate after a change, metrics untouched, accessible naming without duplicate announcements,
 * and realtime updates (setting and character) through the real LiveOverlay consumer.
 */
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayThemeId,
  type SessionOverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { sampleMultiCharacterState } from "@/domain/overlay/sample-session";
import type { OverlayPayload, PlayerLiveState } from "@/domain/overlay/state";
import { OverlayView } from "./OverlayView";

const sse = vi.hoisted(() => ({ handlers: {} as Record<string, (data: unknown) => void> }));
vi.mock("@/lib/use-event-stream", () => ({
  useEventStream: (opts: { handlers: Record<string, (data: unknown) => void> }) => {
    sse.handlers = opts.handlers;
  },
}));
const { LiveOverlay } = await import("./LiveOverlay");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEMES = [...OVERLAY_THEMES];
const ALL_FIELDS = Object.fromEntries(
  Object.keys(DEFAULT_OVERLAY_CONFIG.fields).map((k) => [k, true]),
) as SessionOverlayConfig["fields"];
const config = (
  theme: OverlayThemeId,
  over: Partial<SessionOverlayConfig> = {},
): SessionOverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  fields: ALL_FIELDS,
  identityPlate: "auto",
  ...over,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (cfg: SessionOverlayConfig, live: PlayerLiveState = sampleMultiCharacterState()) =>
  act(() =>
    root.render(
      <OverlayView config={cfg} live={live} sizing={{ mode: "box", width: 900, height: 240 }} />,
    ),
  );
const plates = () => [...host.querySelectorAll<HTMLElement>(".ov-ip")];
const plate = () => {
  const all = plates();
  expect(all).toHaveLength(1);
  return all[0]!;
};
/** Overlay text without the plate: every metric the streamer shows. */
const metrics = () => {
  const clone = host.querySelector(".sf6-overlay")!.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".ov-ip").forEach((n) => n.remove());
  return clone.textContent;
};

describe.each(THEMES)("%s", (theme) => {
  it("auto: one plate of the overlay's character (the active one), labelled RYU", () => {
    render(config(theme));
    const p = plate();
    expect(p.dataset.plate).toBe("character");
    expect(p.dataset.character).toBe("ryu");
    expect(p.textContent).toBe("RYU");
    expect(p.querySelector("img")).toBeNull(); // typography only, never an image
    expect(p.getAttribute("style")).toBeNull();
  });

  it("off: no plate and nothing else changes", () => {
    render(config(theme, { identityPlate: "off" }));
    expect(plates()).toEqual([]);
    const off = metrics();
    render(config(theme));
    expect(metrics()).toBe(off); // name, rank, MR, delta, W/L, rates, streaks, form: identical
  });

  it("a pinned rating character wins over the active one (existing rule), like the name", () => {
    render(config(theme, { ratingCharacterKey: "chunli" }));
    expect(plate().dataset.character).toBe("chunli");
    expect(plate().textContent).toBe("CHU");
    expect(host.querySelector(".ov-char")?.textContent).toContain("Chun-Li");
  });

  it("a character change replaces the plate in the same render (never stale)", () => {
    render(config(theme));
    expect(plate().textContent).toBe("RYU");
    render(
      config(theme),
      sampleMultiCharacterState("ryu", undefined, [{ characterKey: "jamie", result: "win" }]),
    );
    expect(plate().dataset.character).toBe("jamie");
    expect(plate().textContent).toBe("JAM");
    expect(host.querySelector(".ov-char")?.textContent).toContain("Jamie");
  });

  it("no character known ⇒ the neutral SST mark (no letters), never a missing-image box", () => {
    const live = sampleMultiCharacterState();
    render(config(theme), {
      ...live,
      session: { ...live.session, activeCharacterKey: null, characters: [] },
    });
    const p = plate();
    expect(p.dataset.plate).toBe("none");
    expect(p.textContent).toBe("");
    expect(p.querySelector("svg.ov-ip-mark")).not.toBeNull();
    expect(p.getAttribute("aria-hidden")).toBe("true");
  });

  it("Random ⇒ «?», never a specific fighter", () => {
    const live = sampleMultiCharacterState();
    const ryu = live.session.characters.find((c) => c.characterKey === "ryu")!;
    render(config(theme), {
      ...live,
      session: {
        ...live.session,
        activeCharacterKey: "random",
        characters: [{ ...ryu, characterKey: "random", characterName: "Random" }],
      },
    });
    expect(plate().dataset.plate).toBe("random");
    expect(plate().textContent).toBe("?");
  });

  it("accessibility: decorative beside the visible name; it names the character when the name is hidden", () => {
    render(config(theme));
    expect(plate().getAttribute("aria-hidden")).toBe("true");
    // Creator «character name» switch hides the name ⇒ the plate carries it (one announcement).
    render(
      config(theme, {
        creator: {
          ...DEFAULT_CREATOR_CUSTOMIZATION,
          show: { ...DEFAULT_CREATOR_CUSTOMIZATION.show, characterName: false },
        },
      }),
    );
    expect(plate().getAttribute("role")).toBe("img");
    expect(plate().getAttribute("aria-label")).toBe("Ryu");
  });
});

describe("theme-specific placement", () => {
  it("Broadcast: a leading cell; the title tab keeps the title", () => {
    render(config("broadcast", { title: "RANKED" }));
    const bc = host.querySelector(".ov-bc")!;
    const kids = [...bc.children].filter((c) => !c.classList.contains("ov-fx"));
    const ipIndex = kids.findIndex((c) => c.classList.contains("ov-ip"));
    const tabIndex = kids.findIndex((c) => c.classList.contains("ov-bc-tab"));
    expect(ipIndex).toBeGreaterThanOrEqual(0);
    expect(ipIndex).toBeLessThan(tabIndex);
    expect(host.querySelector(".ov-bc-tab")?.textContent).toBe("RANKED");
  });
  it("Minimal: the plate takes the decorative tick's place (one or the other)", () => {
    render(config("minimal"));
    expect(host.querySelector(".ov-min-bar")).toBeNull();
    render(config("minimal", { identityPlate: "off" }));
    expect(host.querySelector(".ov-min-bar")).not.toBeNull();
  });
  it("Rank Card and Prestige keep their rank emblem", () => {
    for (const theme of ["rank-card", "prestige"] as const) {
      render(config(theme));
      expect(host.querySelector(".ov-emb")).not.toBeNull();
    }
  });
  it("Prestige without the rating row still shows the medallion (and it names the character)", () => {
    render(config("prestige", { fields: { ...ALL_FIELDS, rating: false, ratingDelta: false } }));
    expect(plate().getAttribute("aria-label")).toBe("Ryu");
  });
});

describe("realtime (real LiveOverlay, existing stream handlers)", () => {
  const payload = (
    cfg: SessionOverlayConfig,
    live: PlayerLiveState,
    at: number,
  ): OverlayPayload => ({
    config: cfg,
    live: { ...live, generatedAt: new Date(at * 1000).toISOString() },
  });
  const push = (p: OverlayPayload) => act(() => sse.handlers.state?.(p));

  it("the setting and the character follow the pushed snapshots; repeats change nothing", () => {
    const base = config("broadcast");
    act(() =>
      root.render(
        <LiveOverlay token="tok" initial={payload(base, sampleMultiCharacterState(), 1)} />,
      ),
    );
    expect(plate().textContent).toBe("RYU");
    // Config-only update (same live timestamp is accepted): Off.
    push(payload({ ...base, identityPlate: "off" }, sampleMultiCharacterState(), 1));
    expect(plates()).toEqual([]);
    push(payload(base, sampleMultiCharacterState(), 2));
    expect(plate().textContent).toBe("RYU");
    // A new match with another character.
    const jamie = sampleMultiCharacterState("ryu", undefined, [
      { characterKey: "jamie", result: "win" },
    ]);
    push(payload(base, jamie, 3));
    expect(plate().textContent).toBe("JAM");
    // Repeated / older snapshots (reconnect resync): still one plate, never the stale one.
    push(payload(base, jamie, 3));
    push(payload(base, sampleMultiCharacterState(), 2));
    expect(plate().textContent).toBe("JAM");
  });
});

describe("plate CSS contract (overlay.css, OBS/CEF)", () => {
  const css = readFileSync("src/components/overlay/overlay.css", "utf8");
  // The M2D block, rules only (its comments may say what it does NOT do).
  const block = css
    .slice(css.lastIndexOf("/*", css.indexOf("M2D: character identity plate")))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  it("never animates (nothing for reduced motion to cut) and stays OBS/CEF-safe", () => {
    expect(block).toContain(".ov-ip-bc");
    expect(block).not.toMatch(/animation|transition|@keyframes/);
    expect(block).not.toMatch(/oklch\(|color-mix\(|@container|:has\(|url\(/);
  });
});
