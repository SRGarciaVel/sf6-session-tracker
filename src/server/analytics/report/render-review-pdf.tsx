/**
 * Server-side PDF rendering of a ReviewReport (react-pdf, in-process: no browser, no network, no
 * storage). The report's language is the account / UI locale resolved by the caller.
 */
import { renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import type { Translate } from "@/components/analytics/review-text";
import type { ReviewReport } from "@/domain/analytics/review-report";
import type { Locale } from "@/i18n/locale";
import { getAppMessages } from "@/i18n/messages";
import { registerReportFonts, resetReportFontData } from "./fonts";
import { SSTReviewDocument } from "./SSTReviewDocument";

/** Concrete catalog shape (every locale has the same keys; i18n tests enforce it). */
type AppCatalog = typeof import("@/i18n/messages/en.json");

/**
 * The "Analytics" translator of a locale, outside a React tree (route handler). Keys are built
 * dynamically by the shared review wording (e.g. `review.${type}.kind`), hence the key widening.
 */
export function analyticsTranslator(locale: Locale): Translate {
  const t = createTranslator({
    locale,
    messages: getAppMessages(locale) as unknown as AppCatalog,
    namespace: "Analytics",
  });
  type Key = Parameters<typeof t>[0];
  return (key, values) => t(key as Key, values);
}

/**
 * Renders are SERIALISED per process and start from freshly loaded fonts. react-pdf keeps one
 * fontkit font object per registered source across documents; reusing it after another document
 * was subset with it dropped glyphs (e.g. "A.K.I." rendered as "K I" in Barlow Condensed — found in
 * local QA and covered by a test). resetReportFontData() drops the loaded data of the report fonts
 * (the registration stays), so each document re-reads the local TTFs (~0.8 MB, no network); the queue keeps a concurrent
 * request from resetting fonts in the middle of another render.
 */
let queue: Promise<unknown> = Promise.resolve();

export function renderReviewPdf(report: ReviewReport, locale: Locale): Promise<Buffer> {
  const run = queue.then(async () => {
    registerReportFonts();
    resetReportFontData();
    return renderToBuffer(
      <SSTReviewDocument report={report} t={analyticsTranslator(locale)} locale={locale} />,
    );
  });
  queue = run.catch(() => undefined);
  return run;
}
