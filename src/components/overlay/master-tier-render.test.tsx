// @vitest-environment happy-dom
/**
 * PR A — the derived Master tier through the real renderer: all six themes, fixed mode and the
 * three presentation modes, Creator Motion, rotation and the SST Brand Flag. The live state is
 * built by the real engine + toLiveSessionState (the same path the server uses).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRAND_FLAG } from "@/domain/overlay/brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION, type PresentationMode } from "@/domain/overlay/rotation";
import { toLiveSessionState, type PlayerLiveState } from "@/domain/overlay/state";
import {
  summarizeSession,
  type CharacterBaseline,
  type SessionMatch,
} from "@/domain/session/engine";
import type { MatchResult, RatingPoint } from "@/domain/sf6/types";
import { OverlayView } from "./OverlayView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date("2026-10-07T20:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const point = (system: "mr" | "lp", value: number, rank: string | null = null): RatingPoint => ({
  system,
  value,
  rank,
  rankTier: null,
  phase: null,
});

/**
 * The reported case: Akuma played 6-1, current MR from the profile with NO stored rank, plus
 * Juri (LP, Diamond 1) earlier in the session so the mixed modes have two characters.
 */
function liveState(akumaMr: number, extraResults: MatchResult[] = []): PlayerLiveState {
  const results: Array<[string, MatchResult]> = [
    ["juri", "win"],
    ...(["win", "win", "loss", "win", "win", "win", "win"] as MatchResult[]).map(
      (r): [string, MatchResult] => ["gouki", r],
    ),
    ...extraResults.map((r): [string, MatchResult] => ["gouki", r]),
  ];
  const matches: SessionMatch[] = results.map(([key, result], i) => ({
    externalMatchId: `m${i}`,
    playedAt: at(3 * (i + 1)),
    mode: "ranked",
    result,
    characterKey: key,
    characterName: key === "gouki" ? "Akuma" : "Juri",
    opponentCharacter: null,
    opponentName: null,
    ratingBefore: null,
    ratingAfter: null,
  }));
  const baselines: CharacterBaseline[] = [
    {
      characterKey: "gouki",
      characterName: "Akuma",
      source: "session_start",
      rating: point("mr", 1580, "Master"),
      capturedAt: T0,
    },
    {
      characterKey: "juri",
      characterName: "Juri",
      source: "session_start",
      rating: point("lp", 19_600, "Diamond 1"),
      capturedAt: T0,
    },
  ];
  const summary = summarizeSession({
    status: "active",
    ratingModel: "per_character",
    baseline: {
      startedAt: T0,
      endedAt: null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: { modes: ["ranked"] },
    },
    matches,
    characterBaselines: baselines,
    current: [
      {
        characterKey: "gouki",
        characterName: "Akuma",
        rating: point("mr", akumaMr),
        observedAt: at(200),
      },
      {
        characterKey: "juri",
        characterName: "Juri",
        rating: point("lp", 19_704, "Diamond 1"),
        observedAt: at(200),
      },
    ],
    favoriteCharacterKey: null,
  });
  return {
    player: { displayName: "Streamer" },
    session: toLiveSessionState("s1", summary, { characters: [], activeCharacterKey: null }),
    generatedAt: new Date(at(200).getTime() + extraResults.length * 1000).toISOString(),
  };
}

const config = (
  theme: OverlayConfig["theme"],
  mode: PresentationMode | null,
  extras: { brand?: boolean } = {},
): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true, rating: true, ratingDelta: true },
  creator: {
    ...DEFAULT_CREATOR_CUSTOMIZATION,
    motion: DEFAULT_CREATOR_MOTION,
    ...(mode
      ? {
          characterRotation: {
            ...DEFAULT_CHARACTER_ROTATION,
            enabled: true,
            mode,
            intervalSeconds: 5 as const,
          },
        }
      : {}),
    ...(extras.brand
      ? { brandFlag: { ...DEFAULT_BRAND_FLAG, enabled: true, mode: "static-badge" as const } }
      : {}),
  },
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
const text = () => overlay()?.textContent ?? "";
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

describe("1605 MR renders High Master", () => {
  it("the live state carries the derived tier (no '—')", () => {
    const akuma = liveState(1605).session.characters.find((c) => c.characterKey === "gouki");
    expect(akuma?.current).toEqual({ system: "mr", value: 1605, rank: "High Master" });
  });

  it.each(OVERLAY_THEMES)("%s · fixed mode", (theme) => {
    render(config(theme, null), liveState(1605));
    expect(text()).toContain("High Master");
    expect(text()).toContain("1605");
    expect(update()).toBeUndefined();
  });

  it.each(["characters", "session-active", "session-all"] as const)(
    "every theme · %s: Akuma's view shows High Master; rotation still cycles; no false match",
    (mode) => {
      for (const theme of OVERLAY_THEMES) {
        render(config(theme, mode), liveState(1605));
        const seen = new Set<string>();
        for (let i = 0; i < 6; i++) {
          if (text().includes("1605")) seen.add(text().includes("High Master") ? "ok" : "missing");
          tick(5_000);
          expect(update()).toBeUndefined();
        }
        expect(seen).toEqual(new Set(["ok"]));
        act(() => root.unmount());
        root = createRoot(host);
      }
    },
  );

  it("rank-aware themes style the High Master family", () => {
    for (const theme of ["rank-card", "prestige"] as const) {
      render(config(theme, null), liveState(1605));
      expect(host.querySelector("[data-rank-family]")?.getAttribute("data-rank-family")).toBe(
        "high-master",
      );
    }
  });

  it("the SST Brand Flag doesn't change the rank (and adds no event)", () => {
    render(config("competitive", null, { brand: true }), liveState(1605));
    expect(host.querySelector(".ov-brand-flag")).not.toBeNull();
    expect(text()).toContain("High Master");
    expect(update()).toBeUndefined();
  });
});

describe("Creator Motion with derived tiers", () => {
  it("repeated snapshots never play; a real match crossing 1600 plays once (legit rank change)", () => {
    const cfg = config("rank-card", null);
    render(cfg, liveState(1595));
    expect(text()).toContain("Master");
    for (let i = 0; i < 3; i++) render(cfg, { ...liveState(1595), generatedAt: `${i}` });
    expect(update()).toBeUndefined();
    render(cfg, liveState(1605, ["win"])); // a real match: 8 → 9 games
    expect(update()).toBe("win");
    expect(overlay()?.dataset.ratingChanged).toBe("yes");
    expect(text()).toContain("High Master");
    const cycle = overlay()?.dataset.updateCycle;
    render(cfg, liveState(1605, ["win"]));
    expect(overlay()?.dataset.updateCycle).toBe(cycle);
  });
});
