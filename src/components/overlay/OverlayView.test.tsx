import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import type { Locale } from "@/i18n/locale";
import { OverlayView } from "./OverlayView";

/** Visible text only (tags stripped, NBSP normalized). */
function render(config: OverlayConfig): string {
  const html = renderToStaticMarkup(
    <OverlayView config={config} live={sampleLiveState()} sizing={{ mode: "viewport" }} />,
  );
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/ | /g, " ")
    .replace(/\s+/g, " ");
}

const all = { ...DEFAULT_OVERLAY_CONFIG.fields, totalGames: true, bestStreak: true };
const cfg = (theme: OverlayConfig["theme"], locale: Locale): OverlayConfig => ({
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
  fields: all,
  locale,
});

describe("OverlayView i18n", () => {
  it("renders in Spanish", () => {
    const text = render(cfg("competitive", "es"));
    expect(text).toContain("Victorias");
    expect(text).toContain("Derrotas");
    expect(text).toContain("% Victorias");
    expect(text).toContain("Sesión");
    expect(text).toContain("70,6 %");
    expect(text).toContain("1684"); // es-ES does not group 4-digit numbers
    expect(text).not.toContain("Wins");
  });

  it("renders in English", () => {
    const text = render(cfg("competitive", "en"));
    expect(text).toContain("Wins");
    expect(text).toContain("Losses");
    expect(text).toContain("Win rate");
    expect(text).toContain("Session");
    expect(text).toContain("70.6%");
    expect(text).toContain("1,684");
    expect(text).not.toContain("Victorias");
  });

  it("keeps MR / LP as official terms in both languages", () => {
    expect(render(cfg("competitive", "es"))).toContain("MR");
    expect(render(cfg("competitive", "en"))).toContain("MR");
  });

  it("compact minimal theme uses short units per language", () => {
    expect(render(cfg("minimal", "es"))).toMatch(/12 V 5 D/);
    expect(render(cfg("minimal", "en"))).toMatch(/12 W 5 L/);
  });

  it("fighter theme is translated", () => {
    expect(render(cfg("fighter", "es"))).toContain("Racha");
    expect(render(cfg("fighter", "en"))).toContain("Win streak");
  });

  it("a custom title is shown as typed; hidden when showTitle is off", () => {
    expect(render({ ...cfg("competitive", "es"), title: "RANKED" })).toContain("RANKED");
    expect(render({ ...cfg("competitive", "es"), showTitle: false })).not.toContain("Sesión");
  });

  it("the same stats render in both languages (presentation only)", () => {
    const digits = (s: string) => s.replace(/[^0-9]/g, "");
    expect(digits(render(cfg("competitive", "es")))).toBe(digits(render(cfg("competitive", "en"))));
  });
});
