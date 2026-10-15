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
  ...over,
});

function data(
  rows: AnalyticsMatchRow[],
  range: AnalyticsRange = "90d",
  mode: AnalyticsMode = "ranked",
): PlayerAnalytics {
  return {
    range,
    mode,
    from: null,
    generatedAt: new Date(T0),
    summary: computeAnalytics(rows),
  };
}

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
});
