/**
 * UX contract of the Analytics workspace (navigation, anchors, toolbar, methodology). The metric
 * values themselves are covered by AnalyticsView.test.tsx; here we only check they are unchanged
 * where the layout moved them.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeAnalyticsDetailed,
  type AnalyticsMatchRow,
  type AnalyticsMode,
  type AnalyticsRange,
} from "@/domain/analytics/aggregate";
import type { MatchResult } from "@/domain/sf6/types";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsSectionNav, pickActiveSection } from "./AnalyticsSectionNav";
import { AnalyticsView } from "./AnalyticsView";
import { ANALYTICS_SECTIONS } from "./parts";

const T0 = Date.parse("2026-10-14T18:00:00Z");
let seq = 0;
const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
  externalMatchId: `w${++seq}`,
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
const rows = (s: string, over: Partial<AnalyticsMatchRow> = {}) =>
  [...s].map((c) => row(c === "W" ? "win" : c === "L" ? "loss" : "draw", over));

function data(
  r: AnalyticsMatchRow[],
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
    ...computeAnalyticsDetailed(r, { character }),
  };
}

const render = (d: PlayerAnalytics, locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <AnalyticsView data={d} />
    </NextIntlClientProvider>,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
/** The HTML of the element carrying data-testid=`id` (up to its closing tag name, rough). */
const region = (html: string, testId: string, tag: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) return "";
  const open = html.lastIndexOf(`<${tag}`, start);
  const close = html.indexOf(`</${tag}>`, start);
  return html.slice(open, close);
};

const FULL = [
  ...rows("WWWWWWWLLL"),
  ...rows("WLWLWLD", {
    characterKey: "juri",
    characterName: "Juri",
    opponentCharacterKey: "jp",
    opponentCharacterName: "JP",
  }),
];

describe("anchors and section navigation", () => {
  it("1. all six section anchors exist; 15. no duplicate ids anywhere", () => {
    const html = render(data(FULL));
    for (const id of ANALYTICS_SECTIONS) expect(html).toContain(`id="${id}"`);
    expect(ANALYTICS_SECTIONS).toEqual([
      "overview",
      "review",
      "recent",
      "characters",
      "matchups",
      "sessions",
    ]);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("2/14. desktop nav lists every section (grouped); 13. the mobile strip renders too", () => {
    const html = render(data(FULL));
    const desktop = region(html, "analytics-nav-desktop", "nav");
    const mobile = region(html, "analytics-nav-mobile", "nav");
    for (const id of ANALYTICS_SECTIONS) {
      expect(desktop).toContain(`href="#${id}"`);
      expect(mobile).toContain(`href="#${id}"`);
    }
    const d = text(desktop);
    expect(d).toMatch(
      /Resumen Resumen Para revisar Rendimiento Forma reciente Personajes Enfrentamientos Enfrentamientos Sesiones Rendimiento en sesión/,
    );
    expect(text(mobile)).toMatch(/Resumen Revisar Forma Personajes Rivales Sesiones/);
    // 16. labelled navigation landmarks; desktop sidebar hidden below lg, strip hidden from lg.
    expect(html).toContain('aria-label="Secciones de analíticas"');
    expect(desktop).toMatch(/class="[^"]*hidden[^"]*lg:block/);
    expect(mobile).toMatch(/class="[^"]*lg:hidden/);
  });

  it("3/4. nav hrefs are pure fragments, so the current ?range&mode&character is kept", () => {
    const html = render(data(FULL, "30d", "all", "aki"));
    const hrefs = [...region(html, "analytics-nav-desktop", "nav").matchAll(/href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual([
      "#overview",
      "#review",
      "#recent",
      "#characters",
      "#matchups",
      "#sessions",
    ]);
  });

  it("the first section is current on the server render (aria-current=location)", () => {
    const html = renderToString(
      <AnalyticsSectionNav
        label="Secciones"
        context="90 días · Ranked · Todos mis personajes"
        groups={[
          { label: "A", items: [{ id: "overview", label: "Resumen", shortLabel: "Resumen" }] },
          { label: "B", items: [{ id: "recent", label: "Forma reciente", shortLabel: "Forma" }] },
        ]}
      />,
    );
    expect(html.match(/aria-current="location"/g)).toHaveLength(2); // strip + sidebar
    expect(html).toMatch(/href="#overview"[^>]*aria-current="location"/);
    expect(html).not.toMatch(/href="#recent"[^>]*aria-current/);
  });

  it("an empty dataset only navigates to the sections that exist", () => {
    const html = render(data([]));
    const hrefs = [...region(html, "analytics-nav-desktop", "nav").matchAll(/href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual(["#overview"]);
    expect(html).toContain('id="overview"');
    expect(html).not.toContain('id="matchups"');
  });
});

describe("pickActiveSection (scroll-spy)", () => {
  const order = ["overview", "review", "recent", "characters", "matchups", "sessions"];
  it("first visible section in document order wins", () => {
    expect(pickActiveSection(order, new Set(["matchups", "characters"]), "overview")).toBe(
      "characters",
    );
    expect(pickActiveSection(order, new Set(["sessions"]), "overview")).toBe("sessions");
  });
  it("nothing in the reading band keeps the previous section", () => {
    expect(pickActiveSection(order, new Set(), "matchups")).toBe("matchups");
  });
  it("page top → first section; page bottom → last section (whatever is in the band)", () => {
    expect(pickActiveSection(order, new Set(["characters"]), "sessions", "top")).toBe("overview");
    expect(pickActiveSection(order, new Set(["matchups"]), "overview", "bottom")).toBe("sessions");
    expect(pickActiveSection(order, new Set(["matchups"]), "overview", null)).toBe("matchups");
  });
  it("unknown ids are ignored", () => {
    expect(pickActiveSection(order, new Set(["nope"]), "recent")).toBe("recent");
  });
});

describe("filter toolbar", () => {
  it("5. range / mode links keep the other filters; the GET form keeps range + mode", () => {
    const html = render(data(FULL, "30d", "all", "aki"));
    const toolbar = region(html, "analytics-filters", "section");
    expect(toolbar).toContain(
      'href="/dashboard/analytics?range=7d&amp;mode=all&amp;character=aki"',
    );
    expect(toolbar).toContain(
      'href="/dashboard/analytics?range=30d&amp;mode=ranked&amp;character=aki"',
    );
    const form = /<form [^>]*>/.exec(toolbar)?.[0] ?? "";
    expect(form).toContain('action="/dashboard/analytics"');
    expect(form).toContain('method="get"');
    expect(toolbar).toContain('<input type="hidden" name="range" value="30d"/>');
    expect(toolbar).toContain('<input type="hidden" name="mode" value="all"/>');
  });

  it("6. reset appears only off-defaults and targets 90d · ranked · all characters", () => {
    expect(render(data(FULL))).not.toContain('data-testid="analytics-reset"');
    const html = render(data(FULL, "7d", "ranked", null));
    const reset = /<a [^>]*data-testid="analytics-reset"[^>]*>/.exec(html)?.[0] ?? "";
    expect(reset).toContain('href="/dashboard/analytics?range=90d&amp;mode=ranked"');
    expect(text(html)).toContain("Restablecer filtros");
  });

  it("7. the active-data context renders in the toolbar and in both navs", () => {
    const html = render(data(FULL, "30d", "all", "aki"));
    const context = "30 días · Todas las registradas · A.K.I.";
    expect(text(region(html, "analytics-context", "p"))).toContain(context);
    expect(text(region(html, "analytics-nav-context", "p"))).toContain(context);
    expect(text(region(html, "analytics-nav-context-mobile", "p"))).toContain(context);
    expect(text(html)).toContain("Filtrado por personaje: A.K.I.");
    expect(text(render(data(FULL)))).toContain("90 días · Ranked · Todos mis personajes");
  });
});

describe("values unchanged by the layout", () => {
  const html = render(data(FULL));
  const t = text(html);

  it("8. overview: one stats surface with the same metrics", () => {
    const overview = text(region(html, "overview-stats", "dl"));
    expect(overview).toMatch(/Partidas registradas 17 Récord 10 – 6 1 empate Win rate 62,5 %/);
    expect(overview).toContain("Sesiones con partidas 1");
  });

  it("9. recent form: same 5 / 10 / 20 records; one sequence of the latest results", () => {
    expect(t).toMatch(/Últimas 5 2 – 2 50 % 1 empate 5 partidas registradas/);
    expect(t).toMatch(/Últimas 20 10 – 6 62,5 % 1 empate 17 de 20 partidas registradas/);
    expect(html.match(/aria-label="Resultados, del más reciente al más antiguo"/g)).toHaveLength(1);
  });

  it("10. matchups: same highlights and opponent table", () => {
    expect(t).toMatch(
      /Mejor rendimiento registrado A\.K\.I\. vs Ken 70 % 10 decididas · 10 registradas/,
    );
    expect(t).toContain("Rendimiento contra personajes");
    expect(html).toContain('data-opponent="ken"');
  });

  it("11. sessions: grouped (activity · sequences · within) with the same values", () => {
    expect(t).toMatch(/Actividad Segmentos de sesión analizados 1/);
    expect(t).toMatch(/Secuencias Racha de victorias más larga 7/);
    expect(t).toMatch(/Dentro de la sesión Primera y segunda mitad de la sesión/);
    expect(html).toContain('data-position="10"');
  });

  it("12. coverage stays visible; secondary methodology sits in a native disclosure", () => {
    expect(html).toMatch(/<aside role="note"[^>]*>[\s\S]*Estas analíticas se basan solo/);
    const details = region(html, "methodology", "details");
    expect(details).toContain("<summary");
    expect(text(details)).toContain("Cómo se calculan estas analíticas");
    expect(text(details)).toContain("no es una garantía estadística");
    expect(text(details)).toContain("ventanas móviles");
    // Local warnings stay next to their sections.
    expect(t).toMatch(/Enfrentamientos Los resultados por enfrentamiento dependen mucho/);
    expect(t).toMatch(/Rendimiento en sesión Las métricas de sesión usan únicamente/);
  });

  it("16. table semantics intact (captions, column and row headers)", () => {
    expect(html.match(/<table/g)?.length).toBe(3);
    expect(html.match(/<caption/g)?.length).toBe(3);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });

  it("English", () => {
    const e = text(render(data(FULL), "en"));
    expect(html).not.toContain("Analytics sections");
    expect(render(data(FULL), "en")).toContain('aria-label="Analytics sections"');
    expect(e).toContain("How these analytics are calculated");
    expect(e).toContain("90 days · Ranked · All my characters");
  });
});
