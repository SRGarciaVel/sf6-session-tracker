/**
 * Review report (Phase 6.4B) — a pure, stable PROJECTION of what the Analytics page already
 * computed, shared by the PDF renderer and the plain-text summary. It adds no metric and no
 * selection logic:
 *
 *   - priorities are EXACTLY `summary.review.signals` (same order, same evidence objects): what the
 *     user sees in "To review" is what is exported — never re-ranked, never all eligible signals;
 *   - the snapshot copies recorded matches / record / sessions from the summary;
 *   - no ratings, no opponent player names (the analytics projection never had them).
 *
 * Facts only: wording lives in the i18n catalogs and the renderers.
 */
import type { CharacterKey } from "@/domain/sf6/types";
import type { AnalyticsMode, AnalyticsRange, AnalyticsSummary, MatchRecord } from "./aggregate";
import type { ReviewSignal } from "./review";

export interface ReviewReportContext {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  /** Own-character filter; null = all own characters (never presented as a character name). */
  character: CharacterKey | null;
  /** Display name of the selected character (null without a filter). */
  characterName: string | null;
  /** Start of the rolling window (null = all recorded history). */
  from: Date | null;
  generatedAt: Date;
}

export interface ReviewReportSnapshot {
  /** Overall record of the dataset (matches, W / L / D, decided, win rate, sample band). */
  record: MatchRecord;
  /** Distinct sessions with at least one match of the dataset. */
  sessions: number;
  /** Matches recorded outside any session. */
  outsideSessions: number;
  firstPlayedAt: Date | null;
  lastPlayedAt: Date | null;
}

export interface ReviewReportPriority {
  /** 1-based position (01 / 03). */
  index: number;
  /** The selected review signal, untouched (same object as summary.review.signals[i]). */
  signal: ReviewSignal;
}

export interface ReviewReport {
  context: ReviewReportContext;
  snapshot: ReviewReportSnapshot;
  priorities: ReviewReportPriority[];
  /** Signals that met the gates but are not among the selected ones (totalEligible − selected). */
  omittedPriorities: number;
}

export interface ReviewReportInput {
  range: AnalyticsRange;
  mode: AnalyticsMode;
  character: CharacterKey | null;
  characters: ReadonlyArray<{ characterKey: CharacterKey; characterName: string }>;
  from: Date | null;
  generatedAt: Date;
  summary: AnalyticsSummary;
}

export function buildReviewReport(input: ReviewReportInput): ReviewReport {
  const { summary } = input;
  const characterName = input.character
    ? (input.characters.find((c) => c.characterKey === input.character)?.characterName ??
      input.character)
    : null;
  const { signals, totalEligible } = summary.review;
  return {
    context: {
      range: input.range,
      mode: input.mode,
      character: input.character,
      characterName,
      from: input.from,
      generatedAt: input.generatedAt,
    },
    snapshot: {
      record: summary.overall,
      sessions: summary.sessions.sessions,
      outsideSessions: summary.sessions.outsideSessions,
      firstPlayedAt: summary.firstPlayedAt,
      lastPlayedAt: summary.lastPlayedAt,
    },
    priorities: signals.map((signal, i) => ({ index: i + 1, signal })),
    omittedPriorities: Math.max(0, totalEligible - signals.length),
  };
}

/** A report is only offered / generated when there is at least one selected priority. */
export function hasReviewPriorities(report: Pick<ReviewReport, "priorities">): boolean {
  return report.priorities.length > 0;
}

/** YYYY-MM-DD of an instant in UTC (deterministic; no locale, no server timezone). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Safe, deterministic download name:
 *   sst-review-<character | all-characters>-<mode>-<range>-<YYYY-MM-DD>.pdf
 * Only [a-z0-9-]; never a user id, e-mail, UUID or opponent name.
 */
export function reviewReportFilename(context: ReviewReportContext): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "x";
  const who = context.character ? slug(context.character) : "all-characters";
  return `sst-review-${who}-${slug(context.mode)}-${slug(context.range)}-${isoDate(context.generatedAt)}.pdf`;
}
