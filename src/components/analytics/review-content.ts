/**
 * Review priorities — stable presentation METADATA shared by every surface that words a review
 * signal (the web "To review" cards, the plain-text summary and the PDF report). Keys only: the
 * prose lives in the i18n catalogs (Analytics.review.*), never here.
 */
import type { ReviewDirection, ReviewSignal, ReviewSignalType } from "@/domain/analytics/review";

/** Predefined replay-review questions per signal type (Analytics.review.questions.<type>.<key>). */
export const REVIEW_QUESTION_KEYS: Readonly<Record<ReviewSignalType, readonly string[]>> = {
  "matchup-underperformance": ["situations", "approach", "stops", "knockdowns"],
  "recent-form-shift": ["decisions", "situations", "context", "errors"],
  "session-half-shift": ["compare", "risk", "repeated", "execution"],
  "post-loss-transition": ["compare", "pace", "risk", "repeat", "opponent"],
  "high-exposure-opponent": ["lab", "interactions", "knowledge"],
};

/** i18n key segment of each signal type (Analytics.review.<key>.*). */
export const REVIEW_TYPE_KEYS: Readonly<Record<ReviewSignalType, string>> = {
  "matchup-underperformance": "matchup",
  "recent-form-shift": "recent",
  "session-half-shift": "halves",
  "post-loss-transition": "postLoss",
  "high-exposure-opponent": "exposure",
};

/** Direction glyph: always shown WITH the signed number and words, never as the only cue. */
export const REVIEW_ARROWS: Readonly<Record<ReviewDirection, string>> = {
  down: "↓",
  up: "↑",
  neutral: "◆",
};

/** i18n key of the section each signal links to (Analytics.review.go.<key>). */
export const REVIEW_DESTINATION_KEYS: Readonly<Record<ReviewSignal["destination"], string>> = {
  "#recent": "recent",
  "#matchups": "matchups",
  "#sessions": "sessions",
};

/** Question i18n keys (relative to Analytics.review) of one signal, in display order. */
export function reviewQuestionKeys(type: ReviewSignalType): string[] {
  return REVIEW_QUESTION_KEYS[type].map((q) => `questions.${REVIEW_TYPE_KEYS[type]}.${q}`);
}
