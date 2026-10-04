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

  it("shows the ACTIVE character's rating and switches with it, keeping global W/L", () => {
    const live = sampleLiveState();
    live.session.characters = [
      {
        characterKey: "kimberly",
        characterName: "Kimberly",
        wins: 1,
        losses: 0,
        draws: 0,
        games: 1,
        ratingSystem: "mr",
        initial: { system: "mr", value: 1479, rank: "Master" },
        current: { system: "mr", value: 1500, rank: "Master" },
        delta: 21,
        baselineKnown: true,
      },
      {
        characterKey: "aki",
        characterName: "A.K.I.",
        wins: 11,
        losses: 5,
        draws: 0,
        games: 16,
        ratingSystem: "lp",
        initial: { system: "lp", value: 21579, rank: "Diamond 2" },
        current: { system: "lp", value: 21898, rank: "Diamond 2" },
        delta: 319,
        baselineKnown: true,
      },
    ];
    const html = (config: OverlayConfig, l = live) =>
      renderToStaticMarkup(<OverlayView config={config} live={l} sizing={{ mode: "viewport" }} />)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");

    live.session.activeCharacterKey = "aki";
    const aki = html(cfg("competitive", "en"));
    expect(aki).toContain("A.K.I.");
    expect(aki).toContain("21,898");
    expect(aki).toContain("+319");

    live.session.activeCharacterKey = "kimberly";
    const kim = html(cfg("competitive", "en"));
    expect(kim).toContain("Kimberly");
    expect(kim).toContain("1,500");
    expect(kim).toContain("MR");
    expect(kim).not.toContain("21,898");
    // Global W/L unchanged by the switch.
    expect(kim).toContain("12");
    expect(kim).toContain("5");

    // A pinned character wins over the active one.
    const pinned = html({ ...cfg("competitive", "en"), ratingCharacterKey: "aki" });
    expect(pinned).toContain("A.K.I.");
    expect(pinned).toContain("21,898");
  });

  it("unknown starting rating renders no delta (—), never a fabricated one", () => {
    const live = sampleLiveState();
    const [ryu] = live.session.characters;
    if (!ryu) throw new Error("sample");
    live.session.characters = [{ ...ryu, initial: null, delta: null, baselineKnown: false }];
    const text = renderToStaticMarkup(
      <OverlayView config={cfg("competitive", "en")} live={live} sizing={{ mode: "viewport" }} />,
    );
    expect(text).toContain("—");
    expect(text).not.toContain("+96");
  });
});

describe("OverlayView XSS (SEC-016: external Buckler strings are rendered as text)", () => {
  const PAYLOADS = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=alert(1)>',
    "</style><script>alert(1)</script>",
    "javascript:alert(1)",
  ];

  /** Replace every name/rank/title-like string (the data that comes from Buckler/users). */
  function poison<T>(value: T, payload: string): T {
    if (Array.isArray(value)) return value.map((v) => poison(v, payload)) as T;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          typeof v === "string" && /name|rank|title|label|opponent/i.test(k)
            ? payload
            : poison(v, payload),
        ]),
      ) as T;
    }
    return value;
  }

  it.each(PAYLOADS)("never emits markup from %s", (payload) => {
    const html = renderToStaticMarkup(
      <OverlayView
        config={{ ...cfg("fighter", "en"), title: payload.slice(0, 24), showTitle: true }}
        live={poison(sampleLiveState(), payload)}
        sizing={{ mode: "viewport" }}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    // Inside real TAGS only (escaped text like "&lt;img … onerror=…&gt;" is harmless).
    expect(html).not.toMatch(/<[^>]*\son[a-z]+=/i); // no event-handler attributes
    expect(html).not.toMatch(/<[^>]*(href|src)="javascript:/i);
    expect(html).toContain(payload.includes("<") ? "&lt;" : payload.slice(0, 8)); // rendered as text
  });
});
