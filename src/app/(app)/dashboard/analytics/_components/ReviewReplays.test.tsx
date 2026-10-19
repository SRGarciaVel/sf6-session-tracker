/**
 * Replay Selection UI (Phase 6.4C): a collapsed "Replays to review (N)" disclosure per review
 * card, groups kept distinct, loss → next pairs in order, Replay ID + copy, one section-level help
 * and the no-causal-analysis disclaimer. Replay ids never reach the plain-text export.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeAnalyticsDetailed, type AnalyticsMatchRow } from "@/domain/analytics/aggregate";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { REPORT_SCENARIOS } from "@/server/analytics/report/report-fixtures";
import { AnalyticsView } from "./AnalyticsView";

function data(rows: AnalyticsMatchRow[], character: string | null = null): PlayerAnalytics {
  return {
    range: "90d",
    mode: "ranked",
    character,
    characters: [{ characterKey: "aki", characterName: "A.K.I." }],
    from: null,
    generatedAt: new Date("2026-10-16T06:43:00Z"),
    ...computeAnalyticsDetailed(rows, { character }),
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
/** The <article> of one signal. */
const card = (html: string, signalId: string) => {
  // The article carries data-signal before its replay <details> does.
  const at = html.indexOf(`data-signal="${signalId}"`);
  const open = html.lastIndexOf("<article", at);
  return html.slice(open, html.indexOf("</article>", at) + "</article>".length);
};
const disclosure = (cardHtml: string) => {
  const at = cardHtml.indexOf('data-testid="review-replays"');
  return at < 0
    ? ""
    : cardHtml.slice(cardHtml.lastIndexOf("<details", at), cardHtml.indexOf("</details>", at));
};
const replayIds = (html: string) =>
  [...html.matchAll(/data-testid="replay-id">([^<]+)</g)].map((m) => m[1]!);

const THREE = data(REPORT_SCENARIOS.threeOfFive()); // halves · matchup · post-loss
const TWO = data(REPORT_SCENARIOS.matchupExposure()); // matchup · exposure
const RECENT = data(REPORT_SCENARIOS.oneRecentUp()); // recent

describe("replay disclosure per review card", () => {
  it("collapsed by default, with the candidate count; separate from the questions", () => {
    const html = render(TWO);
    const c = card(html, "matchup:aki:jp");
    const d = disclosure(c);
    expect(d).toMatch(/^<details class="group\/replays/);
    expect(d).not.toMatch(/^<details[^>]*open/);
    expect(text(d)).toContain("Replays para revisar (3)");
    expect(c.indexOf("Preguntas para revisar")).toBeLessThan(
      c.indexOf('data-testid="review-replays"'),
    );
  });

  it("matchup: the selection's exact replay ids, with Replay ID and a copy button each", () => {
    const sel = TWO.reviewReplays.find((r) => r.signalId === "matchup:aki:jp")!;
    const d = disclosure(card(render(TWO), "matchup:aki:jp"));
    expect(replayIds(d)).toEqual(
      sel.groups.flatMap((g) => g.candidates.map((c) => c.externalMatchId)),
    );
    expect(d.match(/data-testid="replay-copy"/g)).toHaveLength(3);
    expect(text(d)).toContain("A.K.I. vs JP");
    expect(text(d)).toContain("las más recientes de este enfrentamiento, ganadas y perdidas");
  });

  it("recent: the two windows are separate labelled groups", () => {
    const d = disclosure(card(render(RECENT), "recent:20v20"));
    expect(d).toMatch(
      /data-group="recent"[\s\S]*Ventana reciente[\s\S]*data-group="previous"[\s\S]*Ventana anterior/,
    );
    expect(d).toContain('role="group"');
    expect(text(d)).toContain("Compara ejemplos de ambas ventanas.");
  });

  it("session halves: first and second half groups, framed as an example", () => {
    const d = disclosure(card(render(THREE), "session-halves"));
    expect(d).toMatch(/Primera mitad[\s\S]*Segunda mitad/);
    expect(replayIds(d)).toHaveLength(2);
    expect(text(d)).toContain("Es un ejemplo, no explica la diferencia global.");
  });

  it("post-loss: pairs in order (loss, then the immediately next match)", () => {
    const sel = THREE.reviewReplays.find((r) => r.signalId === "post-loss")!;
    const d = disclosure(card(render(THREE), "post-loss"));
    expect(d).toMatch(/Transición 1[\s\S]*Derrota[\s\S]*Partida siguiente[\s\S]*Transición 2/);
    expect(replayIds(d)).toEqual(
      sel.groups.flatMap((g) => g.candidates.map((c) => c.externalMatchId)),
    );
    expect(sel.groups[0]!.candidates.map((c) => c.role)).toEqual([
      "transition-loss",
      "transition-next",
    ]);
  });

  it("high exposure: neutral copy (no weakness wording)", () => {
    const d = disclosure(card(render(TWO), "exposure:ken"));
    expect(text(d)).toContain("Partidas recientes contra este personaje.");
    expect(text(d)).not.toMatch(/debilidad|problema|peor|mejor|error|fallo/i);
  });

  it("an empty selection renders no disclosure; the priority itself stays", () => {
    const empty: PlayerAnalytics = {
      ...TWO,
      reviewReplays: TWO.reviewReplays.map((r) =>
        r.signalId === "exposure:ken" ? { ...r, groups: [], totalCandidates: 0 } : r,
      ),
    };
    const html = render(empty);
    expect(card(html, "exposure:ken")).not.toContain('data-testid="review-replays"');
    expect(card(html, "exposure:ken")).toContain("Ken");
    expect(card(html, "matchup:aki:jp")).toContain('data-testid="review-replays"');
  });
});

describe("section-level help, disclaimer, privacy, ES / EN", () => {
  it("one Replay ID help disclosure (collapsed) and the no-causal-analysis disclaimer", () => {
    const html = render(THREE);
    expect(html.match(/data-testid="replay-id-help"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*data-testid="replay-id-help"[^>]*open/);
    expect(text(html)).toContain("¿Cómo abro un Replay ID?");
    expect(text(html)).toContain("CFN → Replays → Search → Keyword Search → Replay ID");
    expect(text(html)).toContain(
      "SST selecciona partidas por su relación con la señal. No analiza lo ocurrido dentro del replay ni determina la causa del resultado.",
    );
    // No links anywhere in the replay UI (no Buckler deep links, no third-party sites).
    const all = THREE.reviewReplays.map((r) => disclosure(card(html, r.signalId))).join("");
    expect(all).not.toMatch(/<a\s|href=/);
  });

  it("no help / replay disclaimer when no selection has candidates", () => {
    const none: PlayerAnalytics = {
      ...TWO,
      reviewReplays: TWO.reviewReplays.map((r) => ({ ...r, groups: [], totalCandidates: 0 })),
    };
    const html = render(none);
    expect(html).not.toContain('data-testid="replay-id-help"');
    expect(html).not.toContain('data-testid="review-replay-disclaimer"');
  });

  it("English copy", () => {
    const html = render(THREE, "en");
    expect(text(html)).toContain("Replays to review (");
    expect(text(html)).toContain("How do I open a Replay ID?");
    expect(text(html)).toMatch(/First half[\s\S]*Second half/);
    expect(text(html)).toMatch(/Transition 1 Loss .* Next match/);
    expect(text(html)).toContain(
      "SST selects matches based on their relationship to the signal. It does not analyze what happened inside the replay or determine the cause of the result.",
    );
  });

  it("replay ids never reach the plain-text summary preview (export boundary)", () => {
    const html = render(THREE);
    const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "";
    expect(pre.length).toBeGreaterThan(100);
    const ids = THREE.reviewReplays.flatMap((r) =>
      r.groups.flatMap((g) => g.candidates.map((c) => c.externalMatchId)),
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(pre).not.toContain(id);
  });
});
