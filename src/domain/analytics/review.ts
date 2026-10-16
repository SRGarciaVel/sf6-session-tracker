/**
 * Review priorities (Phase 6.4A) — pure, deterministic REVIEW SIGNALS over the analytics dataset.
 *
 * Product question: "where should I look first when reviewing my play?". A signal is a recorded
 * difference (or a frequent area) backed by a minimum sample; it points at a page section to look
 * at in replays. It never claims a cause: SST does not observe what happens inside a match (no
 * neutral, anti-air, Drive, corner, wake-up, punish or execution data), nor mental state (no tilt,
 * fatigue or adaptation). No ratings are used (Phase 6.3 is blocked on segmented baselines).
 *
 * Deterministic: no AI, no randomness, no clock. Same rows ⇒ same signals, ids and order. The
 * domain returns FACTS only; wording and review questions live in the UI / i18n catalogs.
 *
 * Gates are PRODUCT thresholds, not statistical significance. Every comparative signal carries its
 * comparator, its samples and the signed difference in percentage points (pp).
 */
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import type { MatchupSection, OpponentPerformance } from "./matchups";
import { computeRecord, type AnalyticsMatchRow, type MatchRecord } from "./record";
import type { AnalyticsSessionSegment, SessionHalves } from "./sessions";

/* ───────────────────────── Gates ───────────────────────── */

/** Minimum decided matches of an own × opponent pair. */
export const REVIEW_MATCHUP_MIN_DECIDED = 10;
/** Minimum decided matches of the SAME own character's baseline. */
export const REVIEW_CHARACTER_BASELINE_MIN_DECIDED = 30;
/** Minimum |difference| (pp) of every comparative signal. */
export const REVIEW_DELTA_THRESHOLD_PP = 10;
/** Size of each of the two non-overlapping recent windows (latest N vs the N before them). */
export const REVIEW_RECENT_WINDOW = 20;
/** Minimum decided matches inside EACH recent window. */
export const REVIEW_RECENT_MIN_DECIDED = 10;
/** Minimum segments split into halves (sessions.ts semantics). */
export const REVIEW_HALVES_MIN_SEGMENTS = 5;
/** Minimum decided matches in EACH half. */
export const REVIEW_HALVES_MIN_DECIDED = 20;
/** Minimum observed transitions after a loss AND after a win. */
export const REVIEW_TRANSITION_MIN_OBSERVATIONS = 10;
/** High exposure: minimum matches against one opponent character… */
export const REVIEW_EXPOSURE_MIN_MATCHES = 20;
/** …and minimum share (0–100) of the matches with a known opponent character. */
export const REVIEW_EXPOSURE_MIN_SHARE = 10;
/** Signals rendered, and the cap per signal type among them. */
export const REVIEW_MAX_SIGNALS = 3;
export const REVIEW_MAX_PER_TYPE = 2;

/**
 * Tolerance for the pp gates: win rates are floating point (e.g. 40 − 50 may not be exactly −10),
 * so "exactly 10 pp" qualifies while 9.9 pp never does.
 */
const GATE_EPSILON = 1e-9;
const reachesDelta = (absDelta: number) => absDelta >= REVIEW_DELTA_THRESHOLD_PP - GATE_EPSILON;

/* ───────────────────────── Model ───────────────────────── */

export type ReviewDirection = "down" | "up" | "neutral";
export type ReviewDestination = "#recent" | "#matchups" | "#sessions";

interface ReviewSignalBase {
  /** Deterministic: the same evidence always yields the same id (no randomness). */
  id: string;
  direction: ReviewDirection;
  destination: ReviewDestination;
  /**
   * Evidence size used for ranking ties: the SMALLER side of a comparison (decided matches or
   * observed transitions); matches for the descriptive exposure signal.
   */
  sample: number;
}

/** A pair's recorded win rate ≥ 10 pp below the SAME own character's recorded win rate. */
export interface MatchupUnderperformanceSignal extends ReviewSignalBase {
  type: "matchup-underperformance";
  direction: "down";
  destination: "#matchups";
  characterKey: CharacterKey;
  characterName: string;
  opponentKey: CharacterKey;
  opponentName: string;
  matchup: MatchRecord;
  /** Every match of that own character in the dataset (any opponent, known or not). */
  baseline: MatchRecord;
  /** matchup − baseline win rate, pp (negative). */
  deltaPp: number;
}

/** Latest 20 matches vs the 20 before them (non-overlapping), ≥ 10 pp apart. */
export interface RecentFormShiftSignal extends ReviewSignalBase {
  type: "recent-form-shift";
  direction: "down" | "up";
  destination: "#recent";
  window: number;
  recent: MatchRecord;
  previous: MatchRecord;
  /** recent − previous win rate, pp. */
  deltaPp: number;
}

/** Second vs first half of session segments (sessions.ts halves), ≥ 10 pp apart. */
export interface SessionHalfShiftSignal extends ReviewSignalBase {
  type: "session-half-shift";
  direction: "down" | "up";
  destination: "#sessions";
  eligibleSegments: number;
  first: MatchRecord;
  second: MatchRecord;
  /** second − first win rate, pp. */
  deltaPp: number;
}

export interface TransitionCount {
  /** Current matches of that result with an immediate next match in the same segment. */
  total: number;
  /** …whose next match was a win (a loss or a draw is not). */
  nextWins: number;
  /** nextWins / total × 100; null when total = 0. */
  rate: number | null;
}

/** Next-match win rate after a loss ≥ 10 pp BELOW the one after a win (negative only in v1). */
export interface PostLossTransitionSignal extends ReviewSignalBase {
  type: "post-loss-transition";
  direction: "down";
  destination: "#sessions";
  postLoss: TransitionCount;
  postWin: TransitionCount;
  /** postLoss − postWin rate, pp (negative). */
  deltaPp: number;
}

/** The opponent character met most often (descriptive: says nothing about performance). */
export interface HighExposureOpponentSignal extends ReviewSignalBase {
  type: "high-exposure-opponent";
  direction: "neutral";
  destination: "#matchups";
  opponentKey: CharacterKey;
  opponentName: string;
  record: MatchRecord;
  /** 0–100 of the matches with a known opponent character. */
  share: number;
}

export type ReviewSignal =
  | MatchupUnderperformanceSignal
  | RecentFormShiftSignal
  | SessionHalfShiftSignal
  | PostLossTransitionSignal
  | HighExposureOpponentSignal;

export type ReviewSignalType = ReviewSignal["type"];

export interface ReviewSection {
  /** Selected signals (≤ REVIEW_MAX_SIGNALS, ≤ REVIEW_MAX_PER_TYPE per type), ranked. */
  signals: ReviewSignal[];
  /** Every qualifying signal before the top-3 selection. */
  totalEligible: number;
}

/* ───────────────────────── Signals ───────────────────────── */

const compareKeys = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pairs whose recorded win rate is ≥ 10 pp below the SAME own character's win rate in the same
 * dataset (never the cross-character account record). Rows without an opponent character never
 * form a pair (matchups.ts) but do belong to their character's baseline.
 */
export function matchupUnderperformanceSignals(
  newest: readonly AnalyticsMatchRow[],
  matchups: MatchupSection,
): MatchupUnderperformanceSignal[] {
  const byCharacter = new Map<CharacterKey, MatchResult[]>();
  for (const m of newest) {
    const list = byCharacter.get(m.characterKey);
    if (list) list.push(m.result);
    else byCharacter.set(m.characterKey, [m.result]);
  }
  const baselines = new Map<CharacterKey, MatchRecord>();
  for (const [key, results] of byCharacter) baselines.set(key, computeRecord(results));

  const out: MatchupUnderperformanceSignal[] = [];
  for (const pair of matchups.matchups) {
    const baseline = baselines.get(pair.characterKey);
    if (!baseline) continue;
    if (pair.record.decided < REVIEW_MATCHUP_MIN_DECIDED) continue;
    if (baseline.decided < REVIEW_CHARACTER_BASELINE_MIN_DECIDED) continue;
    if (pair.record.winRate === null || baseline.winRate === null) continue;
    const deltaPp = pair.record.winRate - baseline.winRate;
    if (deltaPp >= 0 || !reachesDelta(-deltaPp)) continue;
    out.push({
      id: `matchup:${pair.characterKey}:${pair.opponentKey}`,
      type: "matchup-underperformance",
      direction: "down",
      destination: "#matchups",
      sample: pair.record.decided,
      characterKey: pair.characterKey,
      characterName: pair.characterName,
      opponentKey: pair.opponentKey,
      opponentName: pair.opponentName,
      matchup: pair.record,
      baseline,
      deltaPp,
    });
  }
  return out;
}

/**
 * Latest REVIEW_RECENT_WINDOW matches vs the REVIEW_RECENT_WINDOW immediately before them, both
 * from the dataset in canonical newest-first order (newestFirst). The windows never overlap and
 * the comparison is never "latest 20 vs the whole range". Draws stay in their window but are not in
 * the win-rate denominator. Session membership is not required.
 */
export function recentFormShiftSignal(
  newest: readonly AnalyticsMatchRow[],
): RecentFormShiftSignal | null {
  const n = REVIEW_RECENT_WINDOW;
  const recent = computeRecord(newest.slice(0, n).map((m) => m.result));
  const previous = computeRecord(newest.slice(n, 2 * n).map((m) => m.result));
  if (recent.decided < REVIEW_RECENT_MIN_DECIDED || previous.decided < REVIEW_RECENT_MIN_DECIDED) {
    return null;
  }
  if (recent.winRate === null || previous.winRate === null) return null;
  const deltaPp = recent.winRate - previous.winRate;
  if (!reachesDelta(Math.abs(deltaPp))) return null;
  return {
    id: `recent:${n}v${n}`,
    type: "recent-form-shift",
    direction: deltaPp < 0 ? "down" : "up",
    destination: "#recent",
    sample: Math.min(recent.decided, previous.decided),
    window: n,
    recent,
    previous,
    deltaPp,
  };
}

/** Phase 6.2 halves as they are (segmentation and the split are NOT redefined here). */
export function sessionHalfShiftSignal(halves: SessionHalves): SessionHalfShiftSignal | null {
  const { first, second, eligibleSegments } = halves;
  if (eligibleSegments < REVIEW_HALVES_MIN_SEGMENTS) return null;
  if (first.decided < REVIEW_HALVES_MIN_DECIDED || second.decided < REVIEW_HALVES_MIN_DECIDED) {
    return null;
  }
  if (first.winRate === null || second.winRate === null) return null;
  const deltaPp = second.winRate - first.winRate;
  if (!reachesDelta(Math.abs(deltaPp))) return null;
  return {
    id: "session-halves",
    type: "session-half-shift",
    direction: deltaPp < 0 ? "down" : "up",
    destination: "#sessions",
    sample: Math.min(first.decided, second.decided),
    eligibleSegments,
    first,
    second,
    deltaPp,
  };
}

export interface NextMatchTransitions {
  postLoss: TransitionCount;
  postWin: TransitionCount;
}

const transition = (total: number, nextWins: number): TransitionCount => ({
  total,
  nextWins,
  rate: total > 0 ? (nextWins / total) * 100 : null,
});

/**
 * Next-match results after a loss vs after a win, INSIDE one analytics segment
 * (segmentSessionMatches: a real session, split at ≥ 45 min gaps). A transition never crosses a
 * segment or session boundary; a segment's last match has no next match; a draw as the CURRENT
 * match belongs to neither group; a draw as the NEXT match is a non-win. The post-loss side equals
 * computeRecoveryAfterLoss (same rule, same counts).
 */
export function computeNextMatchTransitions(
  segments: readonly AnalyticsSessionSegment[],
): NextMatchTransitions {
  let lossTotal = 0;
  let lossNextWins = 0;
  let winTotal = 0;
  let winNextWins = 0;
  for (const s of segments) {
    for (let i = 0; i < s.results.length - 1; i++) {
      const current = s.results[i];
      const nextWin = s.results[i + 1] === "win" ? 1 : 0;
      if (current === "loss") {
        lossTotal++;
        lossNextWins += nextWin;
      } else if (current === "win") {
        winTotal++;
        winNextWins += nextWin;
      }
    }
  }
  return {
    postLoss: transition(lossTotal, lossNextWins),
    postWin: transition(winTotal, winNextWins),
  };
}

export function postLossTransitionSignal(
  segments: readonly AnalyticsSessionSegment[],
): PostLossTransitionSignal | null {
  const { postLoss, postWin } = computeNextMatchTransitions(segments);
  if (
    postLoss.total < REVIEW_TRANSITION_MIN_OBSERVATIONS ||
    postWin.total < REVIEW_TRANSITION_MIN_OBSERVATIONS
  ) {
    return null;
  }
  if (postLoss.rate === null || postWin.rate === null) return null;
  const deltaPp = postLoss.rate - postWin.rate;
  // v1: only the "lower after losses" direction is a review signal.
  if (deltaPp >= 0 || !reachesDelta(-deltaPp)) return null;
  return {
    id: "post-loss",
    type: "post-loss-transition",
    direction: "down",
    destination: "#sessions",
    sample: Math.min(postLoss.total, postWin.total),
    postLoss,
    postWin,
    deltaPp,
  };
}

/**
 * The single opponent character with the highest exposure among those with ≥ 20 matches and
 * ≥ 10 % share. Ties: more matches, higher share, key order. Rows without an opponent character
 * are never an opponent (no "Unknown").
 */
export function highExposureOpponentSignal(
  opponents: readonly OpponentPerformance[],
): HighExposureOpponentSignal | null {
  const eligible = opponents.filter(
    (o) =>
      o.record.matches >= REVIEW_EXPOSURE_MIN_MATCHES &&
      Number.isFinite(o.share) &&
      o.share >= REVIEW_EXPOSURE_MIN_SHARE,
  );
  const top = [...eligible].sort(
    (a, b) =>
      b.record.matches - a.record.matches ||
      b.share - a.share ||
      compareKeys(a.opponentKey, b.opponentKey),
  )[0];
  if (!top) return null;
  return {
    id: `exposure:${top.opponentKey}`,
    type: "high-exposure-opponent",
    direction: "neutral",
    destination: "#matchups",
    sample: top.record.matches,
    opponentKey: top.opponentKey,
    opponentName: top.opponentName,
    record: top.record,
    share: top.share,
  };
}

/* ───────────────────────── Ranking ───────────────────────── */

const DIRECTION_TIER: Record<ReviewDirection, number> = { down: 0, up: 1, neutral: 2 };
const absDelta = (s: ReviewSignal) =>
  s.type === "high-exposure-opponent" ? 0 : Math.abs(s.deltaPp);

/**
 * Total order (no score): 1. direction tier — negative comparative, then positive comparative,
 * then the neutral exposure signal; 2. larger |deltaPp|; 3. larger evidence sample; 4. id.
 */
export function compareReviewSignals(a: ReviewSignal, b: ReviewSignal): number {
  return (
    DIRECTION_TIER[a.direction] - DIRECTION_TIER[b.direction] ||
    absDelta(b) - absDelta(a) ||
    b.sample - a.sample ||
    compareKeys(a.id, b.id)
  );
}

/**
 * Walks the ranked list and keeps a signal unless its type already has REVIEW_MAX_PER_TYPE
 * selected, until REVIEW_MAX_SIGNALS are selected (a skipped signal still counts as eligible).
 */
export function selectReviewSignals(eligible: readonly ReviewSignal[]): ReviewSection {
  const ranked = [...eligible].sort(compareReviewSignals);
  const perType = new Map<ReviewSignalType, number>();
  const signals: ReviewSignal[] = [];
  for (const s of ranked) {
    if (signals.length >= REVIEW_MAX_SIGNALS) break;
    const used = perType.get(s.type) ?? 0;
    if (used >= REVIEW_MAX_PER_TYPE) continue;
    perType.set(s.type, used + 1);
    signals.push(s);
  }
  return { signals, totalEligible: eligible.length };
}

export interface ReviewInput {
  /** The page's dataset (range + mode + character), NEWEST first (newestFirst). */
  newest: readonly AnalyticsMatchRow[];
  /** computeMatchupSection(newest). */
  matchups: MatchupSection;
  /** segmentSessionMatches(newest). */
  segments: readonly AnalyticsSessionSegment[];
  /** computeSessionHalves(segments). */
  halves: SessionHalves;
}

/** Every review signal of the dataset, ranked and capped. Pure; reuses the computed analytics. */
export function computeReviewSection(input: ReviewInput): ReviewSection {
  const eligible: ReviewSignal[] = [
    ...matchupUnderperformanceSignals(input.newest, input.matchups),
  ];
  const singles = [
    recentFormShiftSignal(input.newest),
    sessionHalfShiftSignal(input.halves),
    postLossTransitionSignal(input.segments),
    highExposureOpponentSignal(input.matchups.opponents),
  ];
  for (const s of singles) if (s) eligible.push(s);
  return selectReviewSignals(eligible);
}
