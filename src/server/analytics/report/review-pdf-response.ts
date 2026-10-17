/**
 * GET /dashboard/analytics/review.pdf — response logic (the route only authenticates and resolves
 * the locale). Everything is RECOMPUTED on the server from the authenticated user + the page's
 * filters: the request can carry nothing else (no player / user id, no signals, no metrics), and
 * any other query parameter is ignored by parseAnalyticsSearchParams.
 *
 * Ownership: getPlayerAnalyticsForUser(userId) — the same entry point (and the same queries) as the
 * Analytics page. Nothing is stored: the PDF is rendered in memory and streamed once.
 */
import { parseAnalyticsSearchParams } from "@/domain/analytics/aggregate";
import {
  buildReviewReport,
  hasReviewPriorities,
  reviewReportFilename,
} from "@/domain/analytics/review-report";
import type { Locale } from "@/i18n/locale";
import { getPlayerAnalyticsForUser } from "@/server/analytics/service";
import type { DbExecutor } from "@/server/db/client";
import { analyticsTranslator, renderReviewPdf } from "./render-review-pdf";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** Repeated keys keep every value; the parsers take the first (same as the page). */
function searchParamsRecord(params: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of ["range", "mode", "character"]) {
    const values = params.getAll(key);
    if (values.length > 0) out[key] = values;
  }
  return out;
}

export async function reviewPdfResponse(
  db: DbExecutor,
  input: { userId: string; locale: Locale; searchParams: URLSearchParams; now?: Date },
): Promise<Response> {
  const query = parseAnalyticsSearchParams(searchParamsRecord(input.searchParams));
  const data = await getPlayerAnalyticsForUser(db, input.userId, { ...query, now: input.now });
  if (!data) return textResponse(404, "no player");

  const report = buildReviewReport(data);
  if (!hasReviewPriorities(report)) {
    // Never an empty branded PDF: the page does not offer the export in this state either.
    return textResponse(409, analyticsTranslator(input.locale)("reviewReport.errors.noSignals"));
  }

  const pdf = await renderReviewPdf(report, input.locale);
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${reviewReportFilename(report.context)}"`,
      "Content-Length": String(pdf.length),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
