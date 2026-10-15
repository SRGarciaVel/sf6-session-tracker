import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeAnalytics,
  type AnalyticsMatchRow,
  type AnalyticsMode,
  type AnalyticsRange,
} from "@/domain/analytics/aggregate";
import type { MatchResult } from "@/domain/sf6/types";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsView, analyticsHref } from "./AnalyticsView";

const T0 = Date.parse("2026-10-14T18:00:00Z");
let seq = 0;
const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
  externalMatchId: `m${++seq}`,
  playedAt: new Date(T0 + seq * 60_000),
  result,
  mode: "ranked",
  characterKey: "aki",
  characterName: "A.K.I.",
  sessionId: "s1",
  opponentCharacterKey: "ken",
  opponentCharacterName: "Ken",
  ...over,
});

function data(
  rows: AnalyticsMatchRow[],
  range: AnalyticsRange = "90d",
  mode: AnalyticsMode = "ranked",
  character: string | null = null,
): PlayerAnalytics {
  return {
    range,
    mode,
    character,
    characters: [
      { characterKey: "aki", characterName: "A.K.I." },
      { characterKey: "juri", characterName: "Juri" },
    ],
    from: null,
    generatedAt: new Date(T0),
    summary: computeAnalytics(rows, { character }),
  };
}

/** n matches of one own×opponent pair from a W/L/D string. */
const pairRows = (own: string, opp: string | null, results: string) =>
  [...results].map((c) =>
    row(c === "W" ? "win" : c === "L" ? "loss" : "draw", {
      characterKey: own,
      characterName: own === "aki" ? "A.K.I." : own === "juri" ? "Juri" : own,
      opponentCharacterKey: opp,
      opponentCharacterName: opp ? opp[0]!.toUpperCase() + opp.slice(1) : null,
    }),
  );

const render = (d: PlayerAnalytics, locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <AnalyticsView data={d} />
    </NextIntlClientProvider>,
  );
/** Visible text only (tags stripped, entities decoded enough for assertions). */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("AnalyticsView", () => {
  it("empty state: clear message, filters and coverage note still there, no metrics", () => {
    const html = render(data([]));
    expect(text(html)).toContain("No hay partidas registradas en este periodo");
    expect(text(html)).toContain(
      "Estas analíticas se basan solo en las partidas que SST ha registrado",
    );
    expect(html).not.toContain("Forma reciente");
    expect(html).not.toContain("NaN");
    expect(html).toContain('aria-current="page"');
  });

  it("populated summary: matches, record with draws apart, win rate excluding draws, sessions", () => {
    const rows = [
      row("win"),
      row("win"),
      row("loss"),
      row("draw"),
      row("win", { sessionId: null }),
    ];
    const t = text(render(data(rows)));
    expect(t).toContain("Partidas registradas 5");
    expect(t).toMatch(/Récord 3 – 1 1 empate/);
    expect(t).toContain("75 %"); // 3 / 4 decided, not 3 / 5
    expect(t).toContain("Sesiones con partidas 1");
    expect(t).toContain("4 partidas por sesión de media");
    expect(t).toContain("1 partida registrada fuera de una sesión");
  });

  it("draw-only data: win rate '—' with an explanation, never 0 %", () => {
    const html = render(data([row("draw"), row("draw")]));
    const t = text(html);
    expect(t).toContain("Sin partidas decididas");
    expect(t).toContain("2 empates");
    expect(t).not.toMatch(/\b0 %/);
    expect(html).not.toContain("NaN");
  });

  it("sample labels are rendered (overall and per character)", () => {
    const rows = [
      ...Array.from({ length: 6 }, () => row("win")),
      row("loss", { characterKey: "juri", characterName: "Juri" }),
    ];
    const t = text(render(data(rows)));
    expect(t).toContain("Muestra pequeña"); // overall: 7 decided
    expect(t).toContain("Muestra muy pequeña"); // Juri: 1 decided
    expect(t).toContain("Más jugado");
    expect(t).not.toMatch(/mejor|best/i);
  });

  it("recent form makes a short sample explicit and announces results without colour", () => {
    const html = render(data([row("win"), row("loss"), row("draw")]));
    const t = text(html);
    expect(t).toContain("Últimas 5");
    expect(t).toContain("3 de 5 partidas registradas");
    expect(html).toContain('aria-label="Resultados, del más reciente al más antiguo"');
    expect(t).toMatch(/Empate.*Derrota.*Victoria/); // newest first
  });

  it("range / mode selection: current option marked, links carry URL state", () => {
    const html = render(data([row("win")], "7d", "all"));
    const current = [...html.matchAll(/<a [^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes('aria-current="page"'));
    expect(current).toHaveLength(2);
    expect(current.every((tag) => tag.includes("range=7d&amp;mode=all"))).toBe(true);
    expect(html).toContain('href="/dashboard/analytics?range=30d&amp;mode=all"');
    expect(html).toContain('href="/dashboard/analytics?range=7d&amp;mode=ranked"');
    expect(analyticsHref("all", "ranked")).toBe("/dashboard/analytics?range=all&mode=ranked");
  });

  it("'all recorded' says how many matches have an unidentified mode", () => {
    const rows = [row("win"), row("loss", { mode: "unknown" })];
    expect(text(render(data(rows, "90d", "all")))).toContain("1 partida de modo no identificado");
    expect(text(render(data(rows, "90d", "ranked")))).not.toContain("modo no identificado");
  });

  it("character table is a real table with headers; English renders too", () => {
    const html = render(data([row("win")]), "en");
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    const t = text(html);
    expect(t).toContain("Performance by character");
    expect(t).toContain("These analytics are based only on the matches SST has recorded");
  });

  describe("matchups (6.1)", () => {
    it("own-character filter: labelled select with options; range/mode kept as hidden inputs", () => {
      const html = render(data(pairRows("aki", "ken", "WL"), "30d", "all", "aki"));
      expect(html).toContain('<label for="analytics-character"');
      expect(html).toMatch(/<select[^>]*id="analytics-character"[^>]*name="character"/);
      expect(html).toContain('<option value="">Todos mis personajes</option>');
      expect(html).toMatch(/<option value="aki" selected="">A\.K\.I\.<\/option>/);
      expect(html).toContain('<input type="hidden" name="range" value="30d"/>');
      expect(html).toContain('<input type="hidden" name="mode" value="all"/>');
      expect(text(html)).toContain("Filtrado por personaje: A.K.I.");
    });

    it("URL state: range/mode links keep the character; the character table links keep range/mode", () => {
      const html = render(data(pairRows("aki", "ken", "WL"), "30d", "all", "aki"));
      expect(html).toContain('href="/dashboard/analytics?range=7d&amp;mode=all&amp;character=aki"');
      expect(html).toContain(
        'href="/dashboard/analytics?range=30d&amp;mode=ranked&amp;character=aki"',
      );
      expect(html).toContain(
        'href="/dashboard/analytics?range=30d&amp;mode=all&amp;character=aki"',
      );
      // "Show all characters" drops only the character.
      expect(html).toContain('href="/dashboard/analytics?range=30d&amp;mode=all"');
      expect(analyticsHref("90d", "ranked", "m-bison")).toBe(
        "/dashboard/analytics?range=90d&mode=ranked&character=m-bison",
      );
    });

    it("opponent table: real table, sorted by matches, frequency and sample; context caption", () => {
      const rows = [...pairRows("aki", "ken", "WWLD"), ...pairRows("aki", "jp", "L")];
      const html = render(data(rows));
      const t = text(html);
      expect(t).toContain("Rendimiento contra personajes");
      expect(t).toContain("Suma de todos tus personajes registrados");
      expect(html).toMatch(/data-opponent="ken"[\s\S]*data-opponent="jp"/);
      expect(t).toMatch(/Ken 4 2 – 1 1 empate 66,7 % 80 %/);
      expect(t).toContain("Muestra muy pequeña");
      const filtered = text(render(data(rows, "90d", "ranked", "aki")));
      expect(filtered).toContain("Usando A.K.I., ordenado por partidas.");
    });

    it("strongest / weakest callouts with an eligible sample (sample size visible)", () => {
      const rows = [
        ...pairRows("aki", "ken", "WWWWWWWLLL"),
        ...pairRows("aki", "guile", "WWWLLLLLLLD"),
      ];
      const t = text(render(data(rows)));
      expect(t).toMatch(
        /Mejor rendimiento registrado A\.K\.I\. vs Ken 70 % 10 decididas · 10 registradas/,
      );
      expect(t).toMatch(
        /Menor rendimiento registrado A\.K\.I\. vs Guile 30 % 10 decididas · 11 registradas/,
      );
      expect(t).not.toMatch(/mejor enfrentamiento|peor|counter|ventaja/i);
    });

    it("no callout below 10 decided: neutral message instead", () => {
      const html = render(data(pairRows("aki", "ken", "WWWWWWWWW")));
      expect(html).not.toContain('data-testid="matchup-highlights"');
      expect(text(html)).toContain(
        "Ningún enfrentamiento tiene todavía suficientes partidas decididas registradas para destacarlo (mínimo 10).",
      );
    });

    it("the matchup sample warning is visible; draw-only matchup shows '—'", () => {
      const t = text(render(data(pairRows("aki", "ken", "DD"))));
      expect(t).toContain(
        "Los resultados por enfrentamiento dependen mucho del tamaño de la muestra.",
      );
      expect(t).toMatch(/Ken 2 0 – 0 2 empates — Sin partidas decididas/);
    });

    it("empty matchup state: matches without opponent character data", () => {
      const t = text(render(data(pairRows("aki", null, "WWL"))));
      expect(t).toContain("Estas partidas no tienen dato de personaje rival");
      expect(t).toContain("3 partidas sin dato de personaje rival no se incluyen");
      expect(t).toContain("Partidas registradas 3"); // results still count
    });

    it("selected character without matches in the range: its own empty state, overview kept", () => {
      const html = render(data(pairRows("aki", "ken", "W"), "7d", "ranked", "juri"));
      expect(text(html)).toContain("No hay partidas con Juri en este periodo");
      expect(html).toContain('data-character="aki"');
    });

    it("the character overview marks the selected character", () => {
      const rows = [...pairRows("aki", "ken", "W"), ...pairRows("juri", "ken", "L")];
      const html = render(data(rows, "90d", "ranked", "juri"));
      expect(html).toMatch(/data-character="juri" data-selected="true"/);
      expect(text(html)).toContain("Seleccionado");
      expect(text(html)).toContain("Vista general de todos tus personajes");
    });

    it("English rendering", () => {
      const rows = [...pairRows("aki", "ken", "WWWWWWWLLL"), ...pairRows("aki", "jp", "L")];
      const t = text(render(data(rows), "en"));
      expect(t).toContain("Matchups");
      expect(t).toContain("Performance against characters");
      expect(t).toContain("Strongest recorded performance");
      expect(t).toContain("Matchup results depend heavily on sample size.");
    });
  });
});
