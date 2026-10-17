/**
 * PDF document contracts (Phase 6.4B). No pixel assertions: a valid A4 PDF, the intentional page
 * plan, size bounds and robustness. Rendering runs the real react-pdf pipeline with the committed
 * fonts.
 */
import { Document, Page, renderToBuffer } from "@react-pdf/renderer";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { computeAnalytics } from "@/domain/analytics/aggregate";
import type { ReviewReport } from "@/domain/analytics/review-report";
import { registerReportFonts, resetReportFontData } from "./fonts";
import { analyticsTranslator, renderReviewPdf } from "./render-review-pdf";
import { ReportBrandLockup, ReportBrandMark } from "./report-brand";
import { REPORT_NOW, scenarioReport } from "./report-fixtures";
import { planReportPages } from "./report-layout";
import { SSTReviewDocument } from "./SSTReviewDocument";

/** Characters mapped by each embedded font's ToUnicode CMap (inflated from the PDF streams). */
function toUnicodeMaps(pdf: Buffer): Array<Set<string>> {
  const raw = pdf.toString("latin1");
  const maps: Array<Set<string>> = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let text: string;
    try {
      text = inflateSync(pdf.subarray(start, raw.indexOf("endstream", start))).toString("latin1");
    } catch {
      continue; // not a Flate stream
    }
    if (!text.includes("begincmap")) continue;
    const chars = new Set<string>();
    for (const [, hex] of text.matchAll(/<[0-9a-fA-F]+>\s*<([0-9a-fA-F]{4})>/g)) {
      chars.add(String.fromCharCode(parseInt(hex!, 16)));
    }
    maps.push(chars);
  }
  return maps;
}

/** Page count from the PDF page tree (`/Type /Pages … /Count N`). */
const pageCount = (pdf: Buffer) => {
  const m = /\/Type \/Pages[\s\S]*?\/Count (\d+)/.exec(pdf.toString("latin1"));
  return m ? Number(m[1]) : 0;
};
const isPdf = (pdf: Buffer) =>
  pdf.subarray(0, 5).toString() === "%PDF-" && pdf.toString("latin1").trimEnd().endsWith("%%EOF");

describe("page plan (intentional layouts)", () => {
  it("1 / 2 / 3 priorities → 3 / 3 / 4 pages; priorities never split", () => {
    const kinds = (n: number) => planReportPages(n).map((page) => page.map((b) => b.kind));
    expect(kinds(1)).toEqual([["cover"], ["priority"], ["worksheet", "notes", "methodology"]]);
    expect(kinds(2)).toEqual([
      ["cover"],
      ["priority", "priority"],
      ["worksheet", "notes", "methodology"],
    ]);
    expect(kinds(3)).toEqual([
      ["cover"],
      ["priority", "priority"],
      ["priority", "worksheet"],
      ["notes", "methodology"],
    ]);
    // 39. one block per selected priority, in order.
    for (const n of [1, 2, 3]) {
      const indexes = planReportPages(n)
        .flat()
        .flatMap((b) => (b.kind === "priority" ? [b.index] : []));
      expect(indexes).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});

describe("rendered PDF", () => {
  const cases: Array<[string, ReviewReport, "es" | "en", number]> = [
    ["41. 1 signal (recent up)", scenarioReport("oneRecentUp"), "es", 3],
    ["recent down", scenarioReport("oneRecentDown"), "en", 3],
    ["42. 2 signals (matchup + exposure)", scenarioReport("matchupExposure"), "es", 3],
    ["43. 3 signals (halves, matchup, post-loss)", scenarioReport("threeOfFive"), "en", 4],
    ["selected character", scenarioReport("threeOfFive", { character: "aki" }), "es", 4],
    ["46. long names", scenarioReport("longNames"), "es", 3],
  ];

  for (const [name, report, locale, pages] of cases) {
    it(`37/38/44/45. ${name} (${locale}) → valid A4 PDF, ${pages} pages`, async () => {
      const pdf = await renderReviewPdf(report, locale);
      expect(isPdf(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(10_000);
      expect(pdf.length).toBeLessThan(400_000); // vector only, subset fonts
      expect(pageCount(pdf)).toBe(pages);
      expect(pageCount(pdf)).toBeLessThanOrEqual(5);
      expect(pdf.toString("latin1")).toMatch(/\/MediaBox \[0 0 595\.2\d+ 841\.8\d+\]/);
      expect(pdf.toString("latin1")).not.toMatch(/NaN|Infinity/);
    }, 30_000);
  }

  it("47/48. a draws-only snapshot renders without a ratio bar or invalid numbers", async () => {
    const withSignals = scenarioReport("oneRecentUp");
    const drawsOnly = computeAnalytics([]).overall;
    const report: ReviewReport = {
      ...withSignals,
      snapshot: { ...withSignals.snapshot, record: { ...drawsOnly, draws: 4, matches: 4 } },
    };
    const pdf = await renderReviewPdf(report, "en");
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.toString("latin1")).not.toMatch(/NaN|Infinity/);
  }, 30_000);

  it("40. the brand mark and lockup render from the shared geometry", async () => {
    registerReportFonts();
    const pdf = await renderToBuffer(
      <Document>
        <Page size="A4">
          <ReportBrandMark width={120} />
          <ReportBrandLockup height={40} />
        </Page>
      </Document>,
    );
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.toString("latin1")).toMatch(/BarlowCondensed-SemiBold/); // the lockup's words
  });

  it("glyph regression: a document rendered AFTER another keeps every glyph", async () => {
    // Without the per-render font reset, a document rendered after one that did not use "A.K.I."
    // in Barlow Condensed lost "A" / "." from its font subsets (text layer read "K I vs JP").
    // Reference: the same document from freshly loaded fonts; then render another document first.
    const target = scenarioReport("matchupExposure");
    registerReportFonts();
    resetReportFontData();
    const reference = toUnicodeMaps(await renderReviewPdf(target, "es"));
    resetReportFontData(); // same fresh start, but another document is rendered first
    await renderReviewPdf(scenarioReport("oneRecentUp"), "es");
    const after = toUnicodeMaps(await renderReviewPdf(target, "es"));
    const signature = (maps: Array<Set<string>>) => maps.map((m) => [...m].sort().join("")).sort();
    expect(reference.length).toBeGreaterThan(3);
    expect(signature(after)).toEqual(signature(reference));
    expect(signature(reference).some((chars) => /A/.test(chars) && /\./.test(chars))).toBe(true);
  }, 60_000);

  it("concurrent renders are serialised and all succeed", async () => {
    const pdfs = await Promise.all([
      renderReviewPdf(scenarioReport("matchupExposure"), "es"),
      renderReviewPdf(scenarioReport("threeOfFive"), "en"),
      renderReviewPdf(scenarioReport("oneRecentUp"), "es"),
    ]);
    expect(pdfs.every(isPdf)).toBe(true);
    expect(pdfs.map(pageCount)).toEqual([3, 4, 3]);
  }, 60_000);

  it("39. the document gets one page per planned page and the selected priorities only", () => {
    const report = scenarioReport("threeOfFive");
    const element = SSTReviewDocument({ report, t: analyticsTranslator("es"), locale: "es" });
    const pages = (element.props as { children: unknown[] }).children;
    expect(pages).toHaveLength(planReportPages(report.priorities.length).length);
    expect(report.priorities).toHaveLength(3);
    expect(report.context.generatedAt).toEqual(REPORT_NOW);
  });
});
