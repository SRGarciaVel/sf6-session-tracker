/**
 * "Prepare review" export area (Phase 6.4B) inside #review: only with selected signals, the PDF
 * link carries the page's filters only, the preview is the server-built plain-text summary.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderReviewPlainText } from "@/components/analytics/review-text";
import { computeAnalyticsDetailed, type AnalyticsMatchRow } from "@/domain/analytics/aggregate";
import { buildReviewReport } from "@/domain/analytics/review-report";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { analyticsTranslator } from "@/server/analytics/report/render-review-pdf";
import { REPORT_SCENARIOS } from "@/server/analytics/report/report-fixtures";
import { AnalyticsView } from "./AnalyticsView";

function data(
  rows: AnalyticsMatchRow[],
  opts: {
    character?: string | null;
    range?: PlayerAnalytics["range"];
    mode?: PlayerAnalytics["mode"];
  } = {},
): PlayerAnalytics {
  const character = opts.character ?? null;
  return {
    range: opts.range ?? "90d",
    mode: opts.mode ?? "ranked",
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
const region = (html: string, testId: string) => {
  const start = html.indexOf(`data-testid="${testId}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const pdfHref = (html: string) =>
  decode(/<a href="([^"]*)"[^>]*data-testid="review-pdf"/.exec(html)?.[1] ?? "");

const WITH = REPORT_SCENARIOS.matchupExposure();
const NONE = REPORT_SCENARIOS.none();

describe("export area", () => {
  it("49/51. shown with signals: title, text, preview, copy and download", () => {
    const html = render(data(WITH));
    const area = region(html, "review-export");
    expect(area).not.toBe("");
    expect(text(area)).toContain("Preparar revisión");
    expect(text(area)).toContain(
      "Convierte estas señales en un resumen para revisar tus replays o compartirlo.",
    );
    expect(area).toMatch(/<button[^>]*data-testid="review-copy"[^>]*>Copiar resumen<\/button>/);
    expect(area).toMatch(/data-testid="review-pdf"[^>]*>(<svg[\s\S]*?<\/svg>)?Descargar PDF<\/a>/);
    expect(area).toMatch(/<details class="group" data-testid="review-export-preview">/);
    expect(area).not.toMatch(/<details[^>]*open/);
  });

  it("50. no export at all with zero signals", () => {
    const html = render(data(NONE));
    expect(html).not.toContain('data-testid="review-export"');
    expect(html).not.toContain("review.pdf");
    expect(html).toContain('data-testid="review-empty"');
  });

  it("52–55. the PDF link carries range, mode and (only when selected) character", () => {
    expect(pdfHref(render(data(WITH, { range: "30d", mode: "all" })))).toBe(
      "/dashboard/analytics/review.pdf?range=30d&mode=all",
    );
    expect(pdfHref(render(data(WITH, { character: "aki" })))).toBe(
      "/dashboard/analytics/review.pdf?range=90d&mode=ranked&character=aki",
    );
    const all = pdfHref(render(data(WITH)));
    expect(all).toBe("/dashboard/analytics/review.pdf?range=90d&mode=ranked");
    expect(all).not.toContain("character");
    // 33. nothing identifying or computed travels in the link.
    expect(all).not.toMatch(/player|user|signal|winRate|delta/i);
  });

  it("56. the copy feedback is a polite live region (text, not colour or icon)", () => {
    const area = region(render(data(WITH)), "review-export");
    expect(area).toMatch(
      /<p role="status" aria-live="polite"[^>]*data-testid="review-copy-status"/,
    );
  });

  it("the preview is exactly the server-built plain-text summary of the same report", () => {
    const d = data(WITH);
    const expected = renderReviewPlainText(buildReviewReport(d), analyticsTranslator("es"), "es");
    const preview = region(render(d), "review-export-preview");
    const pre = decode(/<pre[^>]*>([\s\S]*?)<\/pre>/.exec(preview)?.[1] ?? "");
    expect(pre).toBe(expected);
  });

  it("57/58. ES / EN labels", () => {
    const area = text(region(render(data(WITH), "en"), "review-export"));
    expect(area).toContain("Prepare review");
    expect(area).toContain("Copy summary");
    expect(area).toContain("Download PDF");
    expect(area).toContain("View summary");
  });

  it("59. existing #review content is unchanged (cards, disclaimer, more note)", () => {
    const review = region(render(data(WITH)), "review");
    expect(review).toMatch(/data-signal="matchup:aki:jp"/);
    expect(review).toMatch(/data-signal="exposure:ken"/);
    expect(text(review)).toContain("-13,9 pp vs A.K.I. en general");
    expect(review).toContain('data-testid="review-disclaimer"');
    // The export comes after the cards and the disclaimer.
    expect(review.indexOf('data-testid="review-export"')).toBeGreaterThan(
      review.indexOf('data-testid="review-disclaimer"'),
    );
  });
});
