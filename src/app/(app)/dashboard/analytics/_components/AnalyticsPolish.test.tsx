/**
 * Long-page polish: background contract, progressive disclosure of the long tables, eyebrows,
 * overview ratio bar, sequence blocks and the page end. Values come from domain/analytics and
 * must be unchanged; only presentation is asserted here.
 */
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeAnalyticsDetailed, type AnalyticsMatchRow } from "@/domain/analytics/aggregate";
import type { MatchResult } from "@/domain/sf6/types";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsView } from "./AnalyticsView";
import { OPPONENT_ROWS_INITIAL } from "./MatchupsSection";
import { ANALYTICS_SECTIONS } from "./parts";
import { CHARACTER_ROWS_INITIAL } from "./PerformanceSections";

const T0 = Date.parse("2026-10-14T18:00:00Z");
let seq = 0;
const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
  externalMatchId: `p${++seq}`,
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

const pad = (i: number) => String(i).padStart(2, "0");
/** `n` own characters with strictly decreasing match counts (so the order is known: c00, c01…). */
function manyCharacters(n: number): AnalyticsMatchRow[] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 2 - i }, (__, j) =>
      row(j % 3 === 0 ? "loss" : "win", {
        characterKey: `c${pad(i)}`,
        characterName: `Char ${pad(i)}`,
      }),
    ),
  ).flat();
}
/** `n` opponent characters with strictly decreasing match counts (o00, o01…). */
function manyOpponents(n: number): AnalyticsMatchRow[] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 2 - i }, (__, j) =>
      row(j % 2 === 0 ? "win" : "loss", {
        opponentCharacterKey: `o${pad(i)}`,
        opponentCharacterName: `Opp ${pad(i)}`,
      }),
    ),
  ).flat();
}

function data(rows: AnalyticsMatchRow[], character: string | null = null): PlayerAnalytics {
  const { summary, reviewReplays } = computeAnalyticsDetailed(rows, { character });
  return {
    range: "90d",
    mode: "ranked",
    character,
    characters: summary.characters.map((c) => ({
      characterKey: c.characterKey,
      characterName: c.characterName,
    })),
    from: null,
    generatedAt: new Date(T0),
    summary,
    reviewReplays,
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
    .replace(/\s+/g, " ");
/** The panel with data-testid=`id` (up to the next section). */
const panel = (html: string, id: string) => {
  const start = html.indexOf(`data-testid="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
const tablePart = (html: string, part: "primary" | "continuation") => {
  const start = html.indexOf(`data-part="${part}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</table>", start));
};
const attrs = (html: string, attr: string) =>
  [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]);

describe("background contract (globals.css)", () => {
  const css = readFileSync("src/app/(app)/globals.css", "utf8");
  const block = (selector: string) => {
    const i = css.indexOf(`\n${selector} {`);
    return i < 0 ? "" : css.slice(i, css.indexOf("\n}", i));
  };

  it("1. the texture never fades to fully transparent (continuous on long pages)", () => {
    const texture = block("body::before");
    expect(texture).toContain("position: fixed");
    expect(texture).toMatch(
      /mask-image: linear-gradient\(180deg, #000 0%, rgb\(0 0 0 \/ 0\.6\) 100%\)/,
    );
    expect(texture).not.toMatch(/mask-image:[^;]*transparent/);
  });

  it("2. large glows are not tiled nor anchored to the first viewport", () => {
    const body = block("body");
    expect(body).not.toContain("radial-gradient"); // body = one continuous base color
    const glow = block("body::after");
    expect(glow).toContain("position: fixed");
    expect(glow).toContain("background-repeat: no-repeat");
    expect(glow).toContain("radial-gradient(1100px 520px");
    expect(css).not.toMatch(/background-repeat:\s*repeat(?!-)/);
  });
});

describe("characters: progressive disclosure (first 8, existing order)", () => {
  it("3. ≤ 8 characters → no disclosure", () => {
    const html = panel(render(data(manyCharacters(CHARACTER_ROWS_INITIAL))), "characters-table");
    expect(CHARACTER_ROWS_INITIAL).toBe(8);
    expect(html).not.toContain('data-part="continuation"');
    expect(html).not.toContain("<details");
    expect(attrs(html, "data-character")).toHaveLength(8);
  });

  it("4–6/8. 17 characters → 8 visible, 'Show 9 more', all rows available, order unchanged", () => {
    const d = data(manyCharacters(17));
    const html = panel(render(d), "characters-table");
    const primary = attrs(tablePart(html, "primary"), "data-character");
    const continuation = attrs(tablePart(html, "continuation"), "data-character");
    expect(primary).toHaveLength(8);
    expect(continuation).toHaveLength(9);
    expect([...primary, ...continuation]).toEqual(d.summary.characters.map((c) => c.characterKey));
    expect(text(html)).toContain("Mostrar 9 personajes más");
    expect(text(html)).toContain("Ocultar personajes adicionales");
    expect(html).toMatch(/<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*open/); // collapsed by default
    // Continuation: own caption + column headers for screen readers.
    const cont = tablePart(html, "continuation");
    expect(cont).toContain("Rendimiento por personaje, filas 9 a 17 (continuación)");
    expect(cont.match(/scope="col"/g)).toHaveLength(6);
  });

  it("7. a selected character below the cutoff opens the disclosure (order unchanged)", () => {
    const below = render(data(manyCharacters(17), "c12"));
    const html = panel(below, "characters-table");
    expect(html).toMatch(/<details[^>]*open/);
    expect(tablePart(html, "continuation")).toMatch(/data-character="c12" data-selected="true"/);
    const above = panel(render(data(manyCharacters(17), "c03")), "characters-table");
    expect(above).not.toMatch(/<details[^>]*open/);
    expect(tablePart(above, "primary")).toMatch(/data-character="c03" data-selected="true"/);
  });

  it("singular wording for one extra character", () => {
    expect(text(render(data(manyCharacters(9))))).toContain("Mostrar 1 personaje más");
  });
});

describe("matchups: progressive disclosure (first 10, existing order)", () => {
  it("9. ≤ 10 opponents → no disclosure", () => {
    const html = panel(render(data(manyOpponents(OPPONENT_ROWS_INITIAL))), "opponents-table");
    expect(OPPONENT_ROWS_INITIAL).toBe(10);
    expect(html).not.toContain('data-part="continuation"');
    expect(attrs(html, "data-opponent")).toHaveLength(10);
  });

  it("10–13. 25 opponents → 10 visible, 'Show 15 more', continuation accessible, order unchanged", () => {
    const d = data(manyOpponents(25));
    const html = panel(render(d), "opponents-table");
    const primary = attrs(tablePart(html, "primary"), "data-opponent");
    const continuation = attrs(tablePart(html, "continuation"), "data-opponent");
    expect(primary).toHaveLength(10);
    expect(continuation).toHaveLength(15);
    expect([...primary, ...continuation]).toEqual(
      d.summary.matchups.opponents.map((o) => o.opponentKey),
    );
    expect(text(html)).toContain("Mostrar 15 enfrentamientos más");
    const cont = tablePart(html, "continuation");
    expect(cont).toContain("filas 11 a 25 (continuación)");
    expect(cont.match(/scope="col"/g)).toHaveLength(6);
    expect(cont.match(/scope="row"/g)).toHaveLength(15);
    // Highlights and sample warning stay outside the disclosure.
    const full = render(d);
    expect(full).toContain('data-testid="matchup-highlights"');
    expect(text(full)).toContain("Los resultados por enfrentamiento dependen mucho");
  });
});

describe("navigation and eyebrows", () => {
  const html = render(data(manyCharacters(3)));

  it("14/15. anchors and nav links (6.4A adds #review after #overview; others unchanged)", () => {
    expect(ANALYTICS_SECTIONS).toEqual([
      "overview",
      "review",
      "recent",
      "characters",
      "matchups",
      "sessions",
    ]);
    for (const id of ANALYTICS_SECTIONS) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
  });

  it("16. eyebrows group sections without repeating the title (ES / EN)", () => {
    const eyebrow = (h: string, id: string) => {
      const open = h.indexOf(">", h.indexOf(`id="${id}"`)) + 1;
      return text(h.slice(open, h.indexOf(`<h2 id="${id}-title"`))).trim();
    };
    expect(ANALYTICS_SECTIONS.map((id) => eyebrow(html, id))).toEqual([
      "Vista general",
      "Revisión",
      "Rendimiento",
      "Por personaje",
      "Rivales",
      "Sesiones",
    ]);
    const enHtml = render(data(manyCharacters(3)), "en");
    expect(ANALYTICS_SECTIONS.map((id) => eyebrow(enHtml, id))).toEqual([
      "At a glance",
      "Review",
      "Performance",
      "By character",
      "Opponents",
      "Sessions",
    ]);
  });
});

describe("overview ratio bar, sequence blocks, page end", () => {
  it("17/18. values unchanged; the bar uses decided matches only, finite numbers", () => {
    const rows = [row("win"), row("win"), row("win"), row("loss"), row("draw")];
    const html = render(data(rows));
    const overview = html.slice(html.indexOf('data-testid="overview-stats"'));
    expect(text(overview)).toMatch(/Partidas registradas 5 Récord 3 – 1 1 empate Win rate 75 %/);
    const bar = /<span class="ratio-bar[^"]*" aria-hidden="true">(.*?)<\/span><\/span>/.exec(
      overview,
    );
    expect(bar?.[1]).toContain("flex-grow:3");
    expect(bar?.[1]).toContain("flex-grow:1");
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("19. no decided match (draws only) → no misleading bar", () => {
    const html = render(data([row("draw"), row("draw")]));
    const overview = html.slice(
      html.indexOf('data-testid="overview-stats"'),
      html.indexOf("</dl>"),
    );
    expect(overview).not.toContain("ratio-bar");
  });

  it("the latest sequence is grouped in blocks of five (one list, order unchanged)", () => {
    const html = render(data(Array.from({ length: 20 }, (_, i) => row(i % 2 ? "loss" : "win"))));
    const list = html.slice(html.indexOf('aria-label="Resultados, del más reciente'));
    const items = list.slice(0, list.indexOf("</ol>"));
    expect(items.match(/<li/g)).toHaveLength(20);
    expect(items.match(/data-block-end="true"/g)).toHaveLength(3);
  });

  it("the page ends with a subtle meta line using already-available numbers", () => {
    const html = render(data(manyCharacters(3)));
    const end = text(html.slice(html.indexOf('data-testid="analytics-end"')));
    expect(end).toMatch(/SST Analytics Basado en 12 partidas registradas · 90 días · Ranked/);
    expect(end).toContain("Cómo se calculan estas analíticas");
  });
});
