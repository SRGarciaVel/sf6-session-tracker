/**
 * Review wording shared by the web cards, the plain-text summary and the PDF. Pure: a translator
 * (next-intl `useTranslations` / `createTranslator`) and a locale in, strings out. No analytics
 * here: every number is read from the signal's evidence or the report snapshot and only FORMATTED.
 */
import type { MatchRecord } from "@/domain/analytics/record";
import type { ReviewSignal } from "@/domain/analytics/review";
import type { ReviewReport } from "@/domain/analytics/review-report";
import {
  formatDecimal,
  formatInteger,
  formatSignedDecimal,
  formatUtcDate,
  formatWinRate,
} from "@/domain/format";
import { BRAND_FULL_NAME, BRAND_NAME } from "@/components/brand/names";
import { REVIEW_ARROWS, REVIEW_TYPE_KEYS, reviewQuestionKeys } from "./review-content";

/** Any next-intl translator scoped to a namespace (keys are relative to it). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface ReviewSignalText {
  /** Signal type label ("Enfrentamiento"). */
  kind: string;
  title: string;
  /** Headline value (a win rate or a share). */
  value: string;
  valueLabel: string;
  arrow: string;
  /** Signed pp + comparator ("-13,8 pp vs A.K.I. en general"). */
  comparison: string;
  /** Samples and the comparator's value. */
  evidence: string;
  /** Neutral descriptive sentence (never a cause). */
  statement: string;
  questions: string[];
}

export const pctOf = (value: number | null, locale: string) =>
  value === null ? "—" : formatWinRate(Math.round(value * 10) / 10, locale);
export const winRateOf = (r: MatchRecord, locale: string) => pctOf(r.winRate, locale);

/** `t` is scoped to "Analytics.review". */
export function describeReviewSignal(
  signal: ReviewSignal,
  t: Translate,
  locale: string,
): ReviewSignalText {
  const key = REVIEW_TYPE_KEYS[signal.type];
  const n = (value: number) => formatInteger(value, locale);
  const pp = (delta: number) => t("pp", { value: formatSignedDecimal(delta, locale) });
  const abs = (delta: number) => formatDecimal(Math.abs(delta), locale);
  const wr = (r: MatchRecord) => winRateOf(r, locale);
  const dir = signal.direction === "up" ? "up" : "down";
  const base = {
    kind: t(`${key}.kind`),
    valueLabel: t(`${key}.valueLabel`),
    arrow: REVIEW_ARROWS[signal.direction],
    questions: reviewQuestionKeys(signal.type).map((q) => t(q)),
  };
  switch (signal.type) {
    case "matchup-underperformance":
      return {
        ...base,
        title: t("matchup.title", { own: signal.characterName, opponent: signal.opponentName }),
        value: wr(signal.matchup),
        comparison: t("matchup.comparison", {
          delta: pp(signal.deltaPp),
          own: signal.characterName,
        }),
        evidence: t("matchup.evidence", {
          decided: n(signal.matchup.decided),
          own: signal.characterName,
          baseline: wr(signal.baseline),
          baselineDecided: n(signal.baseline.decided),
        }),
        statement: t("matchup.statement", { delta: abs(signal.deltaPp) }),
      };
    case "recent-form-shift":
      return {
        ...base,
        title: t("recent.title", { n: signal.window }),
        value: wr(signal.recent),
        comparison: t("recent.comparison", { delta: pp(signal.deltaPp), n: signal.window }),
        evidence: t("recent.evidence", {
          decided: n(signal.recent.decided),
          n: signal.window,
          previous: wr(signal.previous),
          previousDecided: n(signal.previous.decided),
        }),
        statement: t(`recent.statement.${dir}`, { delta: abs(signal.deltaPp), n: signal.window }),
      };
    case "session-half-shift":
      return {
        ...base,
        title: t("halves.title"),
        value: wr(signal.second),
        comparison: t("halves.comparison", { delta: pp(signal.deltaPp) }),
        evidence: t("halves.evidence", {
          decided: n(signal.second.decided),
          first: wr(signal.first),
          firstDecided: n(signal.first.decided),
          segments: n(signal.eligibleSegments),
        }),
        statement: t(`halves.statement.${dir}`, {
          delta: abs(signal.deltaPp),
          segments: n(signal.eligibleSegments),
        }),
      };
    case "post-loss-transition":
      return {
        ...base,
        title: t("postLoss.title"),
        value: pctOf(signal.postLoss.rate, locale),
        comparison: t("postLoss.comparison", { delta: pp(signal.deltaPp) }),
        evidence: t("postLoss.evidence", {
          wins: n(signal.postLoss.nextWins),
          total: n(signal.postLoss.total),
          afterWin: pctOf(signal.postWin.rate, locale),
          winWins: n(signal.postWin.nextWins),
          winTotal: n(signal.postWin.total),
        }),
        statement: t("postLoss.statement", { delta: abs(signal.deltaPp) }),
      };
    case "high-exposure-opponent":
      return {
        ...base,
        title: signal.opponentName,
        value: pctOf(signal.share, locale),
        comparison: t("exposure.comparison"),
        evidence: t("exposure.evidence", {
          matches: n(signal.record.matches),
          wins: n(signal.record.wins),
          losses: n(signal.record.losses),
        }),
        statement: t("exposure.statement"),
      };
  }
}

export interface ReviewReportText {
  /** "A.K.I." or "Vista general" — never "All characters" posing as a character. */
  identity: string;
  /** "Todos mis personajes" when no character is selected; null otherwise. */
  identityNote: string | null;
  range: string;
  mode: string;
  characterLabel: string;
  coverage: string;
  matches: string;
  record: string;
  draws: string | null;
  winRate: string;
  sessions: string;
  found: string;
  included: string;
  omitted: string | null;
  limitation: string;
  priorities: Array<{ index: number; total: number; text: ReviewSignalText }>;
}

/** `t` is scoped to "Analytics". */
export function describeReviewReport(
  report: ReviewReport,
  t: Translate,
  locale: string,
): ReviewReportText {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const review: Translate = (key, values) => t(`review.${key}`, values);
  const { context, snapshot } = report;
  const rec = snapshot.record;
  const total = report.priorities.length;
  const eligible = total + report.omittedPriorities;
  return {
    identity: context.characterName ?? r("overviewTitle"),
    identityNote: context.characterName ? null : t("characterAll"),
    range: t(`ranges.${context.range}`),
    mode: t(`modes.${context.mode}`),
    characterLabel: context.characterName ?? t("characterAll"),
    coverage:
      snapshot.firstPlayedAt && snapshot.lastPlayedAt
        ? r("coverageRange", {
            from: formatUtcDate(snapshot.firstPlayedAt, locale),
            to: formatUtcDate(snapshot.lastPlayedAt, locale),
          })
        : r("coverageNone"),
    matches: formatInteger(rec.matches, locale),
    record: `${formatInteger(rec.wins, locale)}–${formatInteger(rec.losses, locale)}`,
    draws: rec.draws > 0 ? t("draws", { count: rec.draws }) : null,
    winRate: winRateOf(rec, locale),
    sessions: formatInteger(snapshot.sessions, locale),
    found: r("overview.found", { count: eligible }),
    included: r("overview.included", { count: total }),
    omitted:
      report.omittedPriorities > 0 ? r("omitted", { count: report.omittedPriorities }) : null,
    limitation: r("overview.limitation"),
    priorities: report.priorities.map((p) => ({
      index: p.index,
      total,
      text: describeReviewSignal(p.signal, review, locale),
    })),
  };
}

/** "01" — the report's editorial numbering. */
export const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * Plain-text summary (Discord / WhatsApp / e-mail / notes). Built from the SAME ReviewReport as the
 * PDF. No Markdown: no #, *, _, `, > or "- " list markers — "•" and numbered lines only.
 * `t` is scoped to "Analytics".
 */
export function renderReviewPlainText(report: ReviewReport, t: Translate, locale: string): string {
  const x = describeReviewReport(report, t, locale);
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const lines: string[] = [];
  lines.push(`${BRAND_NAME} — ${r("title").toUpperCase()}`, "");
  lines.push(x.identity);
  if (x.identityNote) lines.push(x.identityNote);
  lines.push(`${x.mode} · ${x.range}`, "");
  lines.push(r("plain.matches", { count: report.snapshot.record.matches }));
  lines.push(
    [x.record, x.draws, r("plain.winRate", { value: x.winRate })].filter(Boolean).join(" · "),
  );
  lines.push(r("plain.sessions", { count: report.snapshot.sessions }), "");
  lines.push(r("plain.prioritiesTitle").toUpperCase(), "");
  for (const p of x.priorities) {
    const s = p.text;
    lines.push(`${p.index}. ${s.kind.toUpperCase()} — ${s.title}`);
    lines.push(`${s.value} ${s.valueLabel}`);
    lines.push(`${s.arrow} ${s.comparison}`);
    lines.push(s.evidence);
    lines.push(s.statement);
    lines.push(`${t("review.questionsTitle")}:`);
    for (const q of s.questions) lines.push(`  • ${q}`);
    lines.push("");
  }
  if (x.omitted) lines.push(x.omitted, "");
  lines.push(x.limitation);
  lines.push(t("review.disclaimer"), "");
  lines.push(r("plain.generatedBy", { brand: `${BRAND_NAME} · ${BRAND_FULL_NAME}` }));
  return lines.join("\n");
}
