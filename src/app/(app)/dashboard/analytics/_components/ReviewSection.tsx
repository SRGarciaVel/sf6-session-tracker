/**
 * Review priorities (Phase 6.4A) — presentation only. The signals (facts + evidence) come from
 * domain/analytics/review.ts; this file only words them and attaches PREDEFINED review questions.
 * The questions are prompts for replay review: they never claim SST observed the answer.
 */
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/primitives";
import type { MatchRecord } from "@/domain/analytics/record";
import type { ReviewDirection, ReviewSignal, ReviewSignalType } from "@/domain/analytics/review";
import { formatDecimal, formatInteger, formatSignedDecimal, formatWinRate } from "@/domain/format";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsSection, WinRate } from "./parts";

/** Predefined review questions per signal type (keys of Analytics.review.questions.<type>). */
const QUESTIONS: Record<ReviewSignalType, readonly string[]> = {
  "matchup-underperformance": ["situations", "approach", "stops", "knockdowns"],
  "recent-form-shift": ["decisions", "situations", "context", "errors"],
  "session-half-shift": ["compare", "risk", "repeated", "execution"],
  "post-loss-transition": ["compare", "pace", "risk", "repeat", "opponent"],
  "high-exposure-opponent": ["lab", "interactions", "knowledge"],
};

/** i18n key segment of each type (Analytics.review.<key>.*). */
const TYPE_KEY: Record<ReviewSignalType, string> = {
  "matchup-underperformance": "matchup",
  "recent-form-shift": "recent",
  "session-half-shift": "halves",
  "post-loss-transition": "postLoss",
  "high-exposure-opponent": "exposure",
};

/** Direction is carried by an arrow AND words, never colour alone. */
const ARROW: Record<ReviewDirection, string> = { down: "↓", up: "↑", neutral: "◆" };
const TONE: Record<ReviewDirection, { border: string; arrow: string }> = {
  down: { border: "border-t-loss/70", arrow: "text-loss" },
  up: { border: "border-t-win/70", arrow: "text-win" },
  neutral: { border: "border-t-cyan/70", arrow: "text-cyan" },
};

const DESTINATION_KEY: Record<ReviewSignal["destination"], string> = {
  "#recent": "recent",
  "#matchups": "matchups",
  "#sessions": "sessions",
};

export function ReviewSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics.review");
  const ta = useTranslations("Analytics");
  const { signals, totalEligible } = data.summary.review;
  const hidden = totalEligible - signals.length;
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
                <SignalCard signal={s} />
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
          </p>
        </>
      )}
    </AnalyticsSection>
  );
}

function SignalCard({ signal }: { signal: ReviewSignal }) {
  const t = useTranslations("Analytics.review");
  const locale = useLocale();
  const key = TYPE_KEY[signal.type];
  const tone = TONE[signal.direction];
  const n = (value: number) => formatInteger(value, locale);
  const pct = (value: number) => formatWinRate(Math.round(value * 10) / 10, locale);
  const pp = (delta: number) => t("pp", { value: formatSignedDecimal(delta, locale) });
  const abs = (delta: number) => formatDecimal(Math.abs(delta), locale);
  const wr = (r: MatchRecord) => (r.winRate === null ? "—" : pct(r.winRate));
  const dir = signal.direction === "up" ? "up" : "down";

  let title: string;
  let value: ReactNode;
  let comparison: string | null = null;
  let evidence: string;
  let statement: string;
  switch (signal.type) {
    case "matchup-underperformance":
      title = t("matchup.title", { own: signal.characterName, opponent: signal.opponentName });
      value = <WinRate record={signal.matchup} />;
      comparison = t("matchup.comparison", {
        delta: pp(signal.deltaPp),
        own: signal.characterName,
      });
      evidence = t("matchup.evidence", {
        decided: n(signal.matchup.decided),
        own: signal.characterName,
        baseline: wr(signal.baseline),
        baselineDecided: n(signal.baseline.decided),
      });
      statement = t("matchup.statement", { delta: abs(signal.deltaPp) });
      break;
    case "recent-form-shift":
      title = t("recent.title", { n: signal.window });
      value = <WinRate record={signal.recent} />;
      comparison = t("recent.comparison", { delta: pp(signal.deltaPp), n: signal.window });
      evidence = t("recent.evidence", {
        decided: n(signal.recent.decided),
        n: signal.window,
        previous: wr(signal.previous),
        previousDecided: n(signal.previous.decided),
      });
      statement = t(`recent.statement.${dir}`, { delta: abs(signal.deltaPp), n: signal.window });
      break;
    case "session-half-shift":
      title = t("halves.title");
      value = <WinRate record={signal.second} />;
      comparison = t("halves.comparison", { delta: pp(signal.deltaPp) });
      evidence = t("halves.evidence", {
        decided: n(signal.second.decided),
        first: wr(signal.first),
        firstDecided: n(signal.first.decided),
        segments: n(signal.eligibleSegments),
      });
      statement = t(`halves.statement.${dir}`, {
        delta: abs(signal.deltaPp),
        segments: n(signal.eligibleSegments),
      });
      break;
    case "post-loss-transition":
      title = t("postLoss.title");
      value = signal.postLoss.rate === null ? "—" : pct(signal.postLoss.rate);
      comparison = t("postLoss.comparison", { delta: pp(signal.deltaPp) });
      evidence = t("postLoss.evidence", {
        wins: n(signal.postLoss.nextWins),
        total: n(signal.postLoss.total),
        afterWin: signal.postWin.rate === null ? "—" : pct(signal.postWin.rate),
        winWins: n(signal.postWin.nextWins),
        winTotal: n(signal.postWin.total),
      });
      statement = t("postLoss.statement", { delta: abs(signal.deltaPp) });
      break;
    case "high-exposure-opponent":
      title = signal.opponentName;
      value = pct(signal.share);
      evidence = t("exposure.evidence", {
        matches: n(signal.record.matches),
        wins: n(signal.record.wins),
        losses: n(signal.record.losses),
      });
      statement = t("exposure.statement");
      break;
  }

  return (
    <article
      className={cx("hud-panel border-t-2 p-5", tone.border)}
      data-signal={signal.id}
      data-signal-type={signal.type}
      data-direction={signal.direction}
    >
      <p className="hud-label text-xs">{t(`${key}.kind`)}</p>
      <h3 className="mt-1 font-display text-xl leading-tight font-bold break-words">{title}</h3>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-3xl font-bold tabular">{value}</span>
        <span className="text-xs text-muted">{t(`${key}.valueLabel`)}</span>
      </p>
      <p
        className="mt-2 flex items-baseline gap-2 text-sm font-semibold tabular"
        data-testid="review-delta"
      >
        <span aria-hidden className={tone.arrow}>
          {ARROW[signal.direction]}
        </span>
        <span>{comparison ?? t("exposure.comparison")}</span>
      </p>
      <p className="mt-1 text-xs text-muted tabular" data-testid="review-evidence">
        {evidence}
      </p>
      <p className="mt-3 text-sm text-muted">{statement}</p>

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
          {QUESTIONS[signal.type].map((q) => (
            <li key={q}>{t(`questions.${key}.${q}`)}</li>
          ))}
        </ul>
      </details>

      <a
        href={signal.destination}
        className="mt-4 inline-flex min-h-9 items-center font-display text-sm font-bold tracking-wide text-cyan uppercase hover:text-text"
      >
        {t(`go.${DESTINATION_KEY[signal.destination]}`)}
        <span aria-hidden className="ml-1">
          →
        </span>
      </a>
    </article>
  );
}
