/**
 * Review priorities (Phase 6.4A) — presentation contract. The signals come from
 * domain/analytics/review.ts (unit tested there); here: placement, nav, evidence wording, arrows +
 * text, sample, collapsed questions, the replay disclaimer, the empty state, ES / EN.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeAnalytics, type AnalyticsMatchRow } from "@/domain/analytics/aggregate";
import { computeMatchupSection } from "@/domain/analytics/matchups";
import { newestFirst } from "@/domain/analytics/record";
import { computeSessionAnalytics } from "@/domain/analytics/sessions";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsView } from "./AnalyticsView";

const T0 = Date.parse("2026-10-14T18:00:00Z");
let seq = 0;
const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
  externalMatchId: `v${String(++seq).padStart(6, "0")}`,
  playedAt: new Date(T0 + seq * 4 * 60_000),
  result,
  mode: "ranked",
  characterKey: "aki",
  characterName: "A.K.I.",
  sessionId: null,
  opponentCharacterKey: "ken",
  opponentCharacterName: "Ken",
  ...over,
});
const R: Record<string, MatchResult> = { W: "win", L: "loss", D: "draw" };
const seqOf = (spec: string, over: Partial<AnalyticsMatchRow> = {}) =>
  [...spec].map((c) => row(R[c]!, over));
const pair = (opponent: CharacterKey, name: string, wins: number, losses: number) =>
  seqOf("W".repeat(wins) + "L".repeat(losses), {
    opponentCharacterKey: opponent,
    opponentCharacterName: name,
  });
/** `n` sessions of `spec`, far apart (no 45-min bridging). */
const sessions = (spec: string, n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => {
    seq += 100;
    return seqOf(spec, { sessionId: `${prefix}${i}` });
  }).flat();

function data(rows: AnalyticsMatchRow[]): PlayerAnalytics {
  return {
    range: "90d",
    mode: "ranked",
    character: null,
    characters: [{ characterKey: "aki", characterName: "A.K.I." }],
    from: null,
    generatedAt: new Date(T0),
    summary: computeAnalytics(rows),
  };
}
const render = (rows: AnalyticsMatchRow[], locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <AnalyticsView data={data(rows)} />
    </NextIntlClientProvider>,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const reviewOf = (html: string) => {
  const start = html.indexOf('<section id="review"');
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
const cards = (html: string) => {
  const section = reviewOf(html);
  return [...section.matchAll(/<article[^>]*data-signal="([^"]+)"[\s\S]*?<\/article>/g)].map(
    (m) => ({ id: m[1]!, html: m[0], text: text(m[0]) }),
  );
};

// A.K.I. vs JP 12–22 (35,3 %); A.K.I. overall 59–61 (49,2 %) → −13,9 pp. Ken = high exposure.
const MATCHUP = [...pair("jp", "JP", 12, 22), ...pair("ken", "Ken", 47, 39)];
const RECENT_DOWN = seqOf("W".repeat(20) + "L".repeat(20)); // oldest → newest
const RECENT_UP = seqOf("L".repeat(20) + "W".repeat(20));
const HALVES = sessions("WWWWWWLL", 5, "h");
const POST_LOSS = [...sessions("LL", 10, "l"), ...sessions("WW", 10, "w")];
const MANY = [
  ...pair("jp", "JP", 2, 10),
  ...pair("dee_jay", "Dee Jay", 2, 10),
  ...pair("juri", "Juri", 2, 10),
  ...pair("ken", "Ken", 40, 0),
];

describe("placement and navigation", () => {
  const html = render(MATCHUP);

  it("#review is a section right after #overview (before #recent)", () => {
    const at = (id: string) => html.indexOf(`<section id="${id}"`);
    expect(at("review")).toBeGreaterThan(at("overview"));
    expect(at("review")).toBeLessThan(at("recent"));
    expect(html).toContain('aria-labelledby="review-title"');
    expect(text(reviewOf(html))).toMatch(/^ Revisión Para revisar Señales descriptivas/);
  });

  it("sidebar and mobile strip contain Review in the Summary group", () => {
    const nav = (id: string) => {
      const s = html.indexOf(`data-testid="${id}"`);
      return html.slice(s, html.indexOf("</nav>", s));
    };
    expect(text(nav("analytics-nav-desktop"))).toMatch(/Resumen Resumen Para revisar Rendimiento/);
    expect(nav("analytics-nav-mobile")).toMatch(/href="#review"[^>]*>Revisar</);
    expect(nav("analytics-nav-desktop")).toMatch(
      /href="#overview"[\s\S]*href="#review"[\s\S]*href="#recent"/,
    );
  });
});

describe("signal cards", () => {
  it("matchup card: pair, win rate, signed pp vs the same character, sample, link", () => {
    const [card] = cards(render(MATCHUP));
    expect(card!.id).toBe("matchup:aki:jp");
    expect(card!.html).toContain('data-direction="down"');
    expect(card!.text).toContain("Enfrentamiento");
    expect(card!.text).toContain("A.K.I. vs JP");
    expect(card!.text).toContain("35,3 %");
    expect(card!.text).toContain("-13,9 pp vs A.K.I. en general");
    expect(card!.text).toContain("34 decididas · A.K.I. en general: 49,2 % (120 decididas)");
    expect(card!.text).toContain(
      "Tu rendimiento registrado en este enfrentamiento está 13,9 pp por debajo de tu rendimiento registrado con este personaje.",
    );
    expect(card!.html).toMatch(/href="#matchups"[^>]*>Ver enfrentamientos/);
  });

  it("arrow + text, never colour alone (the arrow is decorative)", () => {
    const [card] = cards(render(MATCHUP));
    expect(card!.html).toMatch(/<span aria-hidden="true" class="text-loss">↓<\/span>/);
    expect(card!.text).toMatch(/-13,9 pp vs/); // the sign and words carry the direction
  });

  it("recent down / recent up cards", () => {
    const down = cards(render(RECENT_DOWN)).find((c) => c.id === "recent:20v20")!;
    expect(down.html).toContain('data-direction="down"');
    expect(down.text).toContain("Últimas 20 partidas");
    expect(down.text).toContain("-100 pp vs las 20 anteriores");
    expect(down.text).toContain("20 decididas · 20 anteriores: 100 % (20 decididas)");
    expect(down.text).toContain("100 pp por debajo de las 20 partidas anteriores");
    expect(down.html).toContain("↓");
    const up = cards(render(RECENT_UP)).find((c) => c.id === "recent:20v20")!;
    expect(up.html).toContain('data-direction="up"');
    expect(up.text).toContain("+100 pp vs las 20 anteriores");
    expect(up.text).toContain("100 pp por encima de las 20 partidas anteriores");
    expect(up.html).toMatch(/class="text-win">↑</);
  });

  it("session-half card", () => {
    const card = cards(render(HALVES)).find((c) => c.id === "session-halves")!;
    expect(card.text).toContain("Segunda mitad de sesión");
    expect(card.text).toContain("-50 pp vs la primera mitad");
    expect(card.text).toContain("20 decididas · Primera mitad: 100 % (20 decididas) · 5 segmentos");
    expect(card.html).toMatch(/href="#sessions"/);
  });

  it("post-loss card", () => {
    const card = cards(render(POST_LOSS)).find((c) => c.id === "post-loss")!;
    expect(card.text).toContain("Resultados tras una derrota");
    expect(card.text).toContain("0 %");
    expect(card.text).toContain("-100 pp vs tras una victoria");
    expect(card.text).toContain(
      "0 de 10 ganadas tras una derrota · Tras una victoria: 100 % (10 de 10)",
    );
  });

  it("exposure card is neutral (cyan, ◆) and descriptive", () => {
    const card = cards(render(MATCHUP)).find((c) => c.id === "exposure:ken")!;
    expect(card.html).toContain('data-direction="neutral"');
    expect(card.html).toMatch(/class="text-cyan">◆</);
    expect(card.text).toContain("Exposición frecuente");
    expect(card.text).toContain("71,7 %");
    expect(card.text).toContain("86 partidas · Récord 47 – 39");
    expect(card.text).toContain("Describe frecuencia, no rendimiento.");
  });

  it("at most three cards; the extra eligible signals are mentioned, not rendered", () => {
    const html = render(MANY);
    const list = cards(html);
    expect(list).toHaveLength(3);
    const review = data(MANY).summary.review;
    expect(review.totalEligible).toBeGreaterThan(3);
    expect(text(reviewOf(html))).toContain(
      `Hay ${review.totalEligible - 3} señal${review.totalEligible - 3 === 1 ? "" : "es"} más con muestra suficiente; se muestran las 3 primeras.`,
    );
    // ≤ 2 of one type.
    expect(list.filter((c) => c.id.startsWith("matchup:")).length).toBeLessThanOrEqual(2);
  });
});

describe("review questions and disclaimer", () => {
  const html = render(MATCHUP);

  it("questions are inside a collapsed native <details> per card", () => {
    for (const card of cards(html)) {
      expect(card.html).toMatch(/<details class="group[^"]*">/);
      expect(card.html).not.toMatch(/<details[^>]*open/);
      expect(card.text).toContain("Preguntas para revisar");
    }
    const [matchup] = cards(html);
    expect(matchup!.text).toContain("¿Qué opciones del rival detienen tu aproximación?");
  });

  it("the replay disclaimer is visible at section level (outside every <details>)", () => {
    const review = reviewOf(html);
    const at = review.indexOf('data-testid="review-disclaimer"');
    // After every card's questions disclosure (the cards list), and not inside any <details>.
    const cardsEnd = review.lastIndexOf("</article>");
    expect(at).toBeGreaterThan(cardsEnd);
    const before = review.slice(0, at);
    expect(before.split("<details").length).toBe(before.split("</details>").length);
    expect(text(review)).toContain(
      "Estas preguntas sirven para orientar la revisión de replays. SST no observa directamente estas situaciones dentro de la partida.",
    );
  });

  it("no causal, diagnostic or statistical-certainty wording (ES / EN)", () => {
    const forbidden =
      /tilt|fatiga|fatigue|cansancio|coach|debilidad|weakness|counter|desventaja|disadvantage|significativ|significant|confianza|confidence|mejorando|improving|empeorando|getting worse|racha|slump|mental|resiliencia|resilience/i;
    for (const rows of [MATCHUP, RECENT_DOWN, RECENT_UP, HALVES, POST_LOSS, MANY, []]) {
      for (const locale of ["es", "en"] as const) {
        expect(text(reviewOf(render(rows, locale)))).not.toMatch(forbidden);
      }
    }
  });
});

describe("empty state, English, unchanged analytics", () => {
  it("no qualifying signal → neutral empty state (never 'no weaknesses')", () => {
    const html = render(seqOf("WLWLW"));
    expect(cards(html)).toHaveLength(0);
    expect(text(reviewOf(html))).toContain(
      "No hay señales con suficiente muestra en este conjunto de datos. SST evita generar prioridades a partir de muestras demasiado pequeñas.",
    );
    // No questions are shown, so the note about them is not either.
    expect(html).not.toContain('data-testid="review-disclaimer"');
  });

  it("an empty dataset has no review section nor link", () => {
    const html = render([]);
    expect(html).not.toContain('id="review"');
    expect(html).not.toContain('href="#review"');
  });

  it("English wording", () => {
    const html = render(MATCHUP, "en");
    const [card] = cards(html);
    expect(text(reviewOf(html))).toMatch(
      /^ Review To review Descriptive signals from your recorded sample/,
    );
    expect(card!.text).toContain("-13.9 pp vs A.K.I. overall");
    expect(card!.text).toContain("34 decided · A.K.I. overall: 49.2% (120 decided)");
    expect(card!.text).toContain(
      "Your recorded performance in this matchup is 13.9 pp below your recorded performance with this character.",
    );
    expect(card!.text).toContain("Questions to review");
    expect(text(reviewOf(html))).toContain(
      "These questions are meant to guide replay review. SST does not directly observe these situations inside a match.",
    );
    expect(text(reviewOf(render(seqOf("WL"), "en")))).toContain(
      "No signal has a large enough sample in this dataset.",
    );
  });

  it("every other analytics value is unchanged by review (same pure functions)", () => {
    for (const rows of [MATCHUP, HALVES, POST_LOSS, MANY]) {
      const sorted = [...rows].sort(newestFirst);
      const summary = computeAnalytics(rows);
      expect(summary.matchups).toEqual(computeMatchupSection(sorted));
      expect(summary.sessionPerformance).toEqual(computeSessionAnalytics(sorted));
    }
    expect(render(MANY)).not.toMatch(/NaN|Infinity/);
  });
});
