/**
 * The SST review report (Phase 6.4B): an A4, dark, digital-first PDF document. Pages follow the
 * intentional plan of report-layout.ts; header / footer / accent line repeat via `fixed`.
 */
import { Document, Page, View } from "@react-pdf/renderer";
import { describeReviewReport, type Translate } from "@/components/analytics/review-text";
import { BRAND_FULL_NAME, BRAND_NAME } from "@/components/brand/names";
import type { ReviewReport } from "@/domain/analytics/review-report";
import { formatUtcDateTime } from "@/domain/format";
import {
  ReportAccentLine,
  ReportCover,
  ReportFooter,
  ReportGlow,
  ReportHeader,
  ReportMethodology,
  ReportPageNumber,
  ReportNotes,
  ReportPriority,
  ReportWorksheet,
} from "./report-components";
import { planReportPages, type ReportBlock } from "./report-layout";
import { S } from "./report-styles";

export function SSTReviewDocument({
  report,
  t,
  locale,
}: {
  report: ReviewReport;
  /** Scoped to "Analytics". */
  t: Translate;
  locale: string;
}) {
  const x = describeReviewReport(report, t, locale);
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const generated = report.context.generatedAt;
  const reportDate = generated.toISOString().slice(0, 10).replaceAll("-", ".");
  const footerMeta = `${r("generated", { date: formatUtcDateTime(generated, locale) })} · ${r("version")}`;
  const pages = planReportPages(report.priorities.length);

  const block = (b: ReportBlock, key: number) => {
    switch (b.kind) {
      case "cover":
        return <ReportCover key={key} report={report} x={x} t={t} reportDate={reportDate} />;
      case "priority": {
        const p = report.priorities[b.index];
        const text = x.priorities[b.index];
        if (!p || !text) return null;
        return <ReportPriority key={key} priority={text} signal={p.signal} t={t} locale={locale} />;
      }
      case "worksheet":
        return <ReportWorksheet key={key} x={x} t={t} />;
      case "notes":
        return <ReportNotes key={key} title={r("notesTitle")} lines={b.lines} />;
      case "methodology":
        return <ReportMethodology key={key} t={t} />;
    }
  };

  return (
    <Document
      title={`${BRAND_NAME} — ${r("title")} — ${x.identity}`}
      author={BRAND_NAME}
      subject={`${x.mode} · ${x.range}`}
      creator={`${BRAND_NAME} | ${BRAND_FULL_NAME}`}
      producer={`${BRAND_NAME} | ${BRAND_FULL_NAME}`}
      language={locale}
    >
      {pages.map((blocks, i) => {
        const cover = blocks[0]?.kind === "cover";
        return (
          <Page key={i} size="A4" style={[S.page, cover ? { paddingTop: 40 } : {}]}>
            <ReportGlow />
            <ReportAccentLine />
            {!cover && <ReportHeader label={r("header")} />}
            <View>{blocks.map(block)}</View>
            <ReportFooter meta={footerMeta} />
            <ReportPageNumber at={cover ? "bottom" : "top"} />
          </Page>
        );
      })}
    </Document>
  );
}
