/**
 * Replay Selection (Phase 6.4C) — pure, deterministic. For each SELECTED review signal, the
 * concrete recorded matches that are part of that signal's evidence:
 *
 *   ReviewSignal      = WHAT recorded pattern deserves review (aggregated evidence)
 *   ReplaySelection   = WHICH concrete matches belong to that evidence
 *
 * It never says WHY a match was won or lost: SST does not observe replay content (neutral, anti-
 * airs, Drive, corner, punishes, combos, execution, mental state…). There is no score, no
 * ranking by "importance", no ratings and no opponent player identity — only the analytics row
 * fields already loaded for the page (opponent CHARACTER only).
 *
 * Inputs are the SAME dataset the signals were computed from (range + mode + character filter):
 * `newest` (newest first, `newestFirst`) and the row-aware session segments of that dataset.
 *
 * Export boundary (intentional, v1): replay ids are shown only on the authenticated Analytics
 * page. They are NOT part of ReviewReport, the plain-text summary or the PDF (shareable artifacts
 * with a different privacy surface).
 */
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import { newestFirst, type AnalyticsMatchRow } from "./record";
import type { ReviewSignal, ReviewSignalType } from "./review";
import { HALVES_MIN_MATCHES, type AnalyticsSessionMatchSegment } from "./sessions";

export type ReviewReplayRole =
  | "focus"
  | "recent"
  | "previous"
  | "first-half"
  | "second-half"
  | "transition-loss"
  | "transition-next";

export interface ReviewReplayCandidate {
  /** Buckler replay_id (the Street Fighter 6 Replay ID). */
  externalMatchId: string;
  playedAt: Date;
  result: MatchResult;
  characterKey: CharacterKey;
  characterName: string;
  opponentCharacterKey: CharacterKey | null;
  opponentCharacterName: string | null;
  role: ReviewReplayRole;
}

/**
 * `matchup` / `exposure`: one list · `recent` + `previous` · `first-half` + `second-half` ·
 * `transition-1`, `transition-2` (each a loss → immediate-next pair, in play order).
 */
export interface ReviewReplayGroup {
  id: string;
  candidates: ReviewReplayCandidate[];
}

export interface ReviewReplaySelection {
  signalId: string;
  signalType: ReviewSignalType;
  /** Empty when no match qualifies under the candidate rules (the signal itself still shows). */
  groups: ReviewReplayGroup[];
  totalCandidates: number;
}

/** Per-type maxima (not one arbitrary equal count). */
export const REPLAY_LIMITS = {
  matchup: 3,
  recentPerWindow: 2,
  halvesPerHalf: 1,
  transitions: 2,
  exposure: 3,
} as const;

const decided = (m: AnalyticsMatchRow) => m.result === "win" || m.result === "loss";

const candidate = (m: AnalyticsMatchRow, role: ReviewReplayRole): ReviewReplayCandidate => ({
  externalMatchId: m.externalMatchId,
  playedAt: m.playedAt,
  result: m.result,
  characterKey: m.characterKey,
  characterName: m.characterName,
  opponentCharacterKey: m.opponentCharacterKey,
  opponentCharacterName: m.opponentCharacterKey ? m.opponentCharacterName : null,
  role,
});

/** First `n` rows of an already newest-first list that pass `keep`. */
function take(
  rows: readonly AnalyticsMatchRow[],
  n: number,
  keep: (m: AnalyticsMatchRow) => boolean,
): AnalyticsMatchRow[] {
  const out: AnalyticsMatchRow[] = [];
  for (const m of rows) {
    if (out.length >= n) break;
    if (keep(m)) out.push(m);
  }
  return out;
}

const group = (
  id: string,
  rows: readonly AnalyticsMatchRow[],
  role: ReviewReplayRole,
): ReviewReplayGroup => ({ id, candidates: rows.map((m) => candidate(m, role)) });

/** Most recent first: by last match, then session id / index (deterministic). */
const segmentRecency = (a: AnalyticsSessionMatchSegment, b: AnalyticsSessionMatchSegment) =>
  newestFirst(a.rows[a.rows.length - 1]!, b.rows[b.rows.length - 1]!) ||
  (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0) ||
  b.segmentIndex - a.segmentIndex;

/** Most recent decided row of a play-ordered list (scans from the end). */
function lastDecided(rows: readonly AnalyticsMatchRow[]): AnalyticsMatchRow | null {
  for (let i = rows.length - 1; i >= 0; i--) if (decided(rows[i]!)) return rows[i]!;
  return null;
}

function groupsFor(
  signal: ReviewSignal,
  newest: readonly AnalyticsMatchRow[],
  segments: readonly AnalyticsSessionMatchSegment[],
): ReviewReplayGroup[] {
  switch (signal.type) {
    case "matchup-underperformance": {
      // Exact own × opponent pair, decided only, newest first — wins AND losses (not losses-only).
      const rows = take(
        newest,
        REPLAY_LIMITS.matchup,
        (m) =>
          m.characterKey === signal.characterKey &&
          m.opponentCharacterKey === signal.opponentKey &&
          decided(m),
      );
      return [group("matchup", rows, "focus")];
    }
    case "recent-form-shift": {
      // The signal's exact, non-overlapping windows. Membership is fixed BEFORE filtering decided
      // matches: a draw is skipped, never back-filled from outside its window.
      const n = signal.window;
      const recent = take(newest.slice(0, n), REPLAY_LIMITS.recentPerWindow, decided);
      const previous = take(newest.slice(n, 2 * n), REPLAY_LIMITS.recentPerWindow, decided);
      return [group("recent", recent, "recent"), group("previous", previous, "previous")];
    }
    case "session-half-shift": {
      // Phase 6.2 halves: segments with ≥ HALVES_MIN_MATCHES rows, first = ceil(N/2). The most
      // recent such segment with a decided match in BOTH halves; its most recent decided match
      // in each half. Candidates never leave that segment.
      const eligible = segments
        .filter((s) => s.rows.length >= HALVES_MIN_MATCHES)
        .sort(segmentRecency);
      for (const s of eligible) {
        const cut = Math.ceil(s.rows.length / 2);
        const first = lastDecided(s.rows.slice(0, cut));
        const second = lastDecided(s.rows.slice(cut));
        if (first && second) {
          return [
            group("first-half", [first], "first-half"),
            group("second-half", [second], "second-half"),
          ];
        }
      }
      return [];
    }
    case "post-loss-transition": {
      // Loss → the IMMEDIATELY next row of the same segment (never across a session or a ≥ 45 min
      // split, never searching further; the next result may be anything).
      const pairs: Array<[AnalyticsMatchRow, AnalyticsMatchRow]> = [];
      for (const s of segments) {
        for (let i = 0; i < s.rows.length - 1; i++) {
          if (s.rows[i]!.result === "loss") pairs.push([s.rows[i]!, s.rows[i + 1]!]);
        }
      }
      pairs.sort((a, b) => newestFirst(a[0], b[0]));
      return pairs.slice(0, REPLAY_LIMITS.transitions).map(([loss, next], i) => ({
        id: `transition-${i + 1}`,
        candidates: [candidate(loss, "transition-loss"), candidate(next, "transition-next")],
      }));
    }
    case "high-exposure-opponent": {
      // Exact opponent character, any result (neutral signal).
      const rows = take(
        newest,
        REPLAY_LIMITS.exposure,
        (m) => m.opponentCharacterKey === signal.opponentKey,
      );
      return [group("exposure", rows, "focus")];
    }
  }
}

export interface ReviewReplayInput {
  /** The selected review signals (summary.review.signals), in their order. */
  signals: readonly ReviewSignal[];
  /** The analytics dataset, NEWEST first (newestFirst). */
  newest: readonly AnalyticsMatchRow[];
  /** segmentSessionMatchRows(newest) — session_id NULL is already excluded there. */
  segments: readonly AnalyticsSessionMatchSegment[];
}

/** One selection per selected signal, aligned with `signals` (never re-ranked). */
export function computeReviewReplaySelections(input: ReviewReplayInput): ReviewReplaySelection[] {
  return input.signals.map((signal) => {
    const groups = groupsFor(signal, input.newest, input.segments).filter(
      (g) => g.candidates.length > 0,
    );
    return {
      signalId: signal.id,
      signalType: signal.type,
      groups,
      totalCandidates: groups.reduce((n, g) => n + g.candidates.length, 0),
    };
  });
}
