/**
 * Review priorities (Phase 6.4A) — presentation only. The signals (facts + evidence) come from
 * domain/analytics/review.ts; this file only words them and attaches PREDEFINED review questions.
 * The questions are prompts for replay review: they never claim SST observed the answer.
 */
import { useLocale, useTranslations } from "next-intl";
import { REVIEW_DESTINATION_KEYS } from "@/components/analytics/review-content";
import { describeReviewSignal, renderReviewPlainText } from "@/components/analytics/review-text";
import { cx } from "@/components/ui/primitives";
import type { ReviewDirection, ReviewSignal } from "@/domain/analytics/review";
import type { ReviewReplaySelection } from "@/domain/analytics/review-replays";
import { buildReviewReport } from "@/domain/analytics/review-report";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsSection, reviewPdfHref } from "./parts";
import { ActionLink } from "@/components/ui/ActionLink";
import { ReviewExportActions } from "./ReviewExportActions";
import { ReplayIdHelp, ReviewReplayDisclosure } from "./ReviewReplays";

/** Direction is carried by an arrow AND words, never colour alone. */
const TONE: Record<ReviewDirection, { border: string; arrow: string }> = {
  down: { border: "border-t-loss/70", arrow: "text-loss" },
  up: { border: "border-t-win/70", arrow: "text-win" },
  neutral: { border: "border-t-cyan/70", arrow: "text-cyan" },
};

export function ReviewSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics.review");
  const ta = useTranslations("Analytics");
  const { signals, totalEligible } = data.summary.review;
  const hidden = totalEligible - signals.length;
  // Replay Selection is aligned with the selected signals (looked up by id, never re-ranked).
  const replays = new Map(data.reviewReplays.map((r) => [r.signalId, r]));
  const anyReplays = data.reviewReplays.some((r) => r.totalCandidates > 0);
  return (
    <AnalyticsSection
      id="review"
      testId="review"
      eyebrow={ta("eyebrows.review")}
      title={t("title")}
      description={<p>{t("subtitle")}</p>}
    >
      {signals.length === 0 ? (
        <div className="hud-panel p-5" data-testid="review-empty">
          <p className="text-sm text-muted">{t("empty")}</p>
        </div>
      ) : (
        <>
          <ul
            className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="review-signals"
          >
            {signals.map((s) => (
              <li key={s.id} className="min-w-0">
                <SignalCard signal={s} replays={replays.get(s.id)} />
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="text-xs text-muted" data-testid="review-more">
              {t("moreEligible", { count: hidden, shown: signals.length })}
            </p>
          )}
          {/* Section level (outside every card): it qualifies all the review questions. */}
          <p
            className="border-l-2 border-line-strong px-4 py-2 text-xs text-muted"
            data-testid="review-disclaimer"
          >
            {t("disclaimer")}
            {anyReplays && (
              <span className="mt-1 block" data-testid="review-replay-disclaimer">
                {t("replays.disclaimer")}
              </span>
            )}
          </p>
          {anyReplays && <ReplayIdHelp />}
          <ReviewExport data={data} />
        </>
      )}
    </AnalyticsSection>
  );
}

function SignalCard({
  signal,
  replays,
}: {
  signal: ReviewSignal;
  replays: ReviewReplaySelection | undefined;
}) {
  const t = useTranslations("Analytics.review");
  const locale = useLocale();
  const tone = TONE[signal.direction];
  const text = describeReviewSignal(signal, t, locale);

  return (
    <article
      className={cx("hud-panel border-t-2 p-5", tone.border)}
      data-signal={signal.id}
      data-signal-type={signal.type}
      data-direction={signal.direction}
    >
      <p className="hud-label text-xs">{text.kind}</p>
      <h3 className="mt-1 font-display text-xl leading-tight font-bold break-words">
        {text.title}
      </h3>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-3xl font-bold tabular">{text.value}</span>
        <span className="text-xs text-muted">{text.valueLabel}</span>
      </p>
      <p
        className="mt-2 flex items-baseline gap-2 text-sm font-semibold tabular"
        data-testid="review-delta"
      >
        <span aria-hidden className={tone.arrow}>
          {text.arrow}
        </span>
        <span>{text.comparison}</span>
      </p>
      <p className="mt-1 text-xs text-muted tabular" data-testid="review-evidence">
        {text.evidence}
      </p>
      <p className="mt-3 text-sm text-muted">{text.statement}</p>

      <details className="group mt-4 border-t border-line pt-3">
        <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 font-display text-sm font-bold tracking-wide text-text uppercase hover:text-cyan">
          <span
            aria-hidden
            className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ▸
          </span>
          {t("questionsTitle")}
        </summary>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted">
          {text.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </details>

      <ReviewReplayDisclosure selection={replays} />

      <ActionLink
        href={signal.destination}
        kind="down"
        className="mt-4 font-display text-sm font-bold tracking-wide uppercase"
      >
        {t(`go.${REVIEW_DESTINATION_KEYS[signal.destination]}`)}
      </ActionLink>
    </article>
  );
}

/**
 * "Prepare review": a preview of the plain-text summary (native <details>) and the two exports. The
 * summary is built HERE, on the server, from the same ReviewReport the PDF route builds; the client
 * component only copies it. Only rendered when there is at least one selected signal.
 */
function ReviewExport({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const report = buildReviewReport(data);
  const plainText = renderReviewPlainText(report, t, locale);
  return (
    <div className="hud-panel space-y-3 p-4" data-testid="review-export">
      <div>
        <p className="hud-label text-xs text-cyan">{t("reviewReport.cta.title")}</p>
        <p className="mt-1 text-sm text-muted">{t("reviewReport.cta.text")}</p>
      </div>
      <details className="group" data-testid="review-export-preview">
        <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 font-display text-sm font-bold tracking-wide uppercase hover:text-cyan">
          <span
            aria-hidden
            className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none"
          >
            ▸
          </span>
          {t("reviewReport.cta.preview")}
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto border border-line bg-bg/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted">
          {plainText}
        </pre>
      </details>
      <ReviewExportActions
        plainText={plainText}
        pdfHref={reviewPdfHref(data.range, data.mode, data.character)}
      />
    </div>
  );
}
