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
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/security/rate-limit";
import { createWorkGate, type WorkGate } from "@/server/security/work-gate";
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

/**
 * Admission limits for report renders. A render is CPU-bound and runs in the web process, which
 * also serves pages, SSE and (embedded mode) the tracker; renders are already serialised by
 * renderReviewPdf, so admitting more only builds a queue that keeps the event loop busy.
 *   - per process: 2 accepted at once (one rendering, one waiting) and 6 started per minute;
 *   - per account: one in flight, and 5 per 10 minutes across instances (shared limiter).
 * A legitimate export is one render per filter change; these limits leave room for that.
 */
export const REVIEW_PDF_LIMITS = {
  maxInFlight: 2,
  maxPerMinute: 6,
  perAccount: 5,
  perAccountWindowMs: 10 * 60_000,
  busyRetrySeconds: 5,
} as const;

interface GateGlobal {
  __sstReviewPdfGate?: WorkGate;
}
const g = globalThis as GateGlobal;

function processGate(): WorkGate {
  return (g.__sstReviewPdfGate ??= createWorkGate({
    maxInFlight: REVIEW_PDF_LIMITS.maxInFlight,
    maxPerWindow: REVIEW_PDF_LIMITS.maxPerMinute,
    windowMs: 60_000,
    busyRetrySeconds: REVIEW_PDF_LIMITS.busyRetrySeconds,
  }));
}

/** Tests: start from an empty process gate. */
export function resetReviewPdfGate(): void {
  g.__sstReviewPdfGate = undefined;
}

function refused(status: 429 | 503, body: string, retryAfterSeconds: number): Response {
  return new Response(body, {
    status,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

/**
 * The route's entry point: bounded admission, then the per-account quota, then the report.
 * Refusals happen before any database read and carry only a localized message and Retry-After.
 */
export async function guardedReviewPdfResponse(
  db: DbExecutor,
  input: { userId: string; locale: Locale; searchParams: URLSearchParams; now?: Date },
  gate: WorkGate = processGate(),
): Promise<Response> {
  const t = analyticsTranslator(input.locale);
  const entry = gate.tryEnter(input.userId);
  if (!entry.ok) {
    logger.info("report.review_pdf_refused", { reason: entry.reason });
    return entry.reason === "subject_busy"
      ? refused(429, t("reviewReport.errors.inProgress"), entry.retryAfterSeconds)
      : refused(503, t("reviewReport.errors.busy"), entry.retryAfterSeconds);
  }
  try {
    const quota = await rateLimit(
      `review-pdf:${input.userId}`,
      REVIEW_PDF_LIMITS.perAccount,
      REVIEW_PDF_LIMITS.perAccountWindowMs,
    );
    if (!quota.ok) {
      logger.info("report.review_pdf_refused", { reason: "account_quota" });
      return refused(429, t("reviewReport.errors.tooMany"), quota.retryAfterSeconds);
    }
    return await reviewPdfResponse(db, input);
  } finally {
    entry.release();
  }
}
