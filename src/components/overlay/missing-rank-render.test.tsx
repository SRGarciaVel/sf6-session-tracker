// @vitest-environment happy-dom
/**
 * Missing rank in completed sessions, through the real renderer (every theme, Broadcast
 * included): the reported ended session (1866 → 1903 MR, no stored rank) shows Ultimate Master
 * instead of «—», with MR, delta and the other metrics unchanged; a stored label is kept; no
 * rating at all still shows «—». The live state is built by the real engine + toLiveSessionState.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type SessionOverlayConfig,
} from "@/domain/overlay/config";
import { akiSession, mr } from "@/domain/overlay/missing-rank.fixture";
import {
  toLiveSessionState,
  toPublicLiveState,
  type PlayerLiveState,
} from "@/domain/overlay/state";
import type { SessionStatus } from "@/domain/session/engine";
import { OverlayView } from "./OverlayView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const live = (
  status: SessionStatus,
  opts: Parameters<typeof akiSession>[1] = {},
): PlayerLiveState =>
  toPublicLiveState({
    player: { displayName: "Streamer" },
    session: toLiveSessionState(
      "s1",
      akiSession(status, opts),
      { characters: [], activeCharacterKey: null },
      new Map([["aki", { system: "mr", value: 1903, position: 7465 }]]),
    ),
    generatedAt: "2026-10-26T19:55:14.000Z",
  });

const config = (theme: SessionOverlayConfig["theme"]): SessionOverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true, rating: true, ratingDelta: true },
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
function render(theme: SessionOverlayConfig["theme"], state: PlayerLiveState) {
  act(() =>
    root.render(
      <OverlayView
        config={config(theme)}
        live={state}
        sizing={{ mode: "box", width: 1000, height: 240 }}
      />,
    ),
  );
  return host.querySelector<HTMLElement>(".sf6-overlay")?.textContent ?? "";
}
const THEMES = [...OVERLAY_THEMES];

describe("ended session, missing stored rank (reported case)", () => {
  it.each(THEMES)("%s: Ultimate Master with 1903 MR and +37, never «—» for rank", (theme) => {
    const text = render(theme, live("ended"));
    expect(text).toContain("Ultimate Master");
    expect(text).toContain("1903");
    expect(text).toMatch(/\+\s?37/);
  });
  it.each(THEMES)("%s: ended and active render the same rank, MR and delta", (theme) => {
    const metrics = (text: string) => ({
      rank: text.includes("Ultimate Master"),
      mr: text.includes("1903"),
      delta: /\+\s?37/.test(text),
    });
    expect(metrics(render(theme, live("ended")))).toEqual(metrics(render(theme, live("active"))));
  });
});

describe("existing behaviour kept", () => {
  it("Broadcast: a stored historical label is shown as stored", () => {
    const text = render(
      "broadcast",
      live("ended", { initial: mr(1866, "Master"), final: mr(1903, "Master") }),
    );
    expect(text).toContain("Master");
    expect(text).not.toContain("Ultimate Master");
  });
  it.each(THEMES)("%s: no rating at all still renders the «—» fallback", (theme) => {
    const text = render(theme, live("ended", { initial: null, final: null }));
    expect(text).not.toContain("Master");
    expect(text).toContain("—");
  });
});
