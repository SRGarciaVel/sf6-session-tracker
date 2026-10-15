/**
 * Matchup analytics (Phase 6.1) — pure, descriptive aggregation over RECORDED matches.
 *
 * A matchup is OWN character × OPPONENT character (A.K.I. vs Ken ≠ Juri vs Ken), grouped by
 * stable keys, named after the most recent row. Mirror matches are matchups like any other.
 * Only characters are used: never opponent names, ranks or ratings.
 *
 * Rows without a usable opponent character (opponent_character_key is nullable: the normalizer
 * leaves it null when Capcom's id is not a valid key) are never assigned to a made-up character:
 * they are excluded from every matchup table and counted in `unavailable`.
 *
 * Highlights ("strongest / weakest RECORDED performance") are a product threshold, not
 * statistics: only pairs with ≥ MATCHUP_CALLOUT_MIN_DECIDED decided matches are eligible.
 */
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import { computeRecord, newestFirst, type AnalyticsMatchRow, type MatchRecord } from "./record";

/** Minimum DECIDED matches for a matchup to be surfaced as a highlight. */
export const MATCHUP_CALLOUT_MIN_DECIDED = 10;

export interface MatchupPerformance {
  characterKey: CharacterKey;
  characterName: string;
  opponentKey: CharacterKey;
  opponentName: string;
  record: MatchRecord;
  /** Share of the matches with a known opponent character, 0–100. */
  share: number;
}

export interface OpponentPerformance {
  opponentKey: CharacterKey;
  opponentName: string;
  record: MatchRecord;
  /** Share of the matches with a known opponent character, 0–100. */
  share: number;
}

export interface MatchupHighlights {
  /** Highest win rate among eligible pairs; null when none is eligible. */
  strongest: MatchupPerformance | null;
  /** Lowest win rate among eligible pairs; null unless ≥ 2 pairs are eligible. */
  weakest: MatchupPerformance | null;
  /** Pairs with ≥ MATCHUP_CALLOUT_MIN_DECIDED decided matches. */
  eligible: number;
}

export interface MatchupSection {
  /** Per opponent character, across the dataset's own characters. */
  opponents: OpponentPerformance[];
  /** Per own × opponent pair. */
  matchups: MatchupPerformance[];
  highlights: MatchupHighlights;
  /** Matches with a known opponent character (the denominator of `share`). */
  considered: number;
  /** Matches without a usable opponent character (excluded from the tables above). */
  unavailable: number;
}

/** Rows with a usable opponent character key (the only ones matchups can describe). */
function withOpponent(
  rows: readonly AnalyticsMatchRow[],
): Array<AnalyticsMatchRow & { opponentCharacterKey: CharacterKey }> {
  // Newest first, whatever the input order: the first row of a group names it.
  return [...rows]
    .sort(newestFirst)
    .filter(
      (m): m is AnalyticsMatchRow & { opponentCharacterKey: CharacterKey } =>
        typeof m.opponentCharacterKey === "string" && m.opponentCharacterKey.length > 0,
    );
}

const byMatchesThenName = (
  a: { record: MatchRecord; name: string; key: string },
  b: { record: MatchRecord; name: string; key: string },
) =>
  b.record.matches - a.record.matches ||
  a.name.localeCompare(b.name) ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

interface Bucket {
  /** First (= most recent) row of the group. */
  first: AnalyticsMatchRow & { opponentCharacterKey: CharacterKey };
  /** Most recent non-empty opponent display name. */
  opponentName: string | null;
  results: MatchResult[];
}

/** Groups rows (already NEWEST FIRST, see withOpponent) by `keyOf`. */
function bucket(
  rows: ReadonlyArray<AnalyticsMatchRow & { opponentCharacterKey: CharacterKey }>,
  keyOf: (m: AnalyticsMatchRow & { opponentCharacterKey: CharacterKey }) => string,
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const m of rows) {
    const key = keyOf(m);
    const b = map.get(key);
    if (b) {
      b.results.push(m.result);
      b.opponentName ||= m.opponentCharacterName;
    } else {
      map.set(key, { first: m, opponentName: m.opponentCharacterName, results: [m.result] });
    }
  }
  return [...map.values()];
}

export function computeOpponentPerformance(
  newest: readonly AnalyticsMatchRow[],
): OpponentPerformance[] {
  const known = withOpponent(newest);
  return bucket(known, (m) => m.opponentCharacterKey)
    .map((b) => ({
      opponentKey: b.first.opponentCharacterKey,
      opponentName: b.opponentName || b.first.opponentCharacterKey,
      record: computeRecord(b.results),
      share: (b.results.length / known.length) * 100,
    }))
    .sort((a, b) =>
      byMatchesThenName(
        { record: a.record, name: a.opponentName, key: a.opponentKey },
        { record: b.record, name: b.opponentName, key: b.opponentKey },
      ),
    );
}

// "\u0000" cannot appear in a character key (CHARACTER_KEY_PATTERN): an unambiguous separator.
const pairKeyOf = (own: CharacterKey, opponent: CharacterKey) => `${own}\u0000${opponent}`;

export function computeMatchups(newest: readonly AnalyticsMatchRow[]): MatchupPerformance[] {
  const known = withOpponent(newest);
  return bucket(known, (m) => pairKeyOf(m.characterKey, m.opponentCharacterKey))
    .map((b) => ({
      characterKey: b.first.characterKey,
      characterName: b.first.characterName,
      opponentKey: b.first.opponentCharacterKey,
      opponentName: b.opponentName || b.first.opponentCharacterKey,
      record: computeRecord(b.results),
      share: (b.results.length / known.length) * 100,
    }))
    .sort((a, b) =>
      byMatchesThenName(
        { record: a.record, name: `${a.characterName} ${a.opponentName}`, key: pairKey(a) },
        { record: b.record, name: `${b.characterName} ${b.opponentName}`, key: pairKey(b) },
      ),
    );
}

const pairKey = (m: MatchupPerformance) => pairKeyOf(m.characterKey, m.opponentKey);

/**
 * Deterministic ranking for highlights: win rate (desc for strongest, asc for weakest), then the
 * larger decided sample, then more matches, then stable key order.
 */
function rank(direction: 1 | -1) {
  return (a: MatchupPerformance, b: MatchupPerformance) =>
    direction * ((b.record.winRate ?? 0) - (a.record.winRate ?? 0)) ||
    b.record.decided - a.record.decided ||
    b.record.matches - a.record.matches ||
    (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0);
}

export function computeMatchupHighlights(
  matchups: readonly MatchupPerformance[],
  minDecided: number = MATCHUP_CALLOUT_MIN_DECIDED,
): MatchupHighlights {
  const eligible = matchups.filter(
    (m) => m.record.decided >= minDecided && m.record.winRate !== null,
  );
  const strongest = [...eligible].sort(rank(1))[0] ?? null;
  // One eligible pair is not "the weakest" of anything: only compare two or more.
  const weakest = eligible.length >= 2 ? ([...eligible].sort(rank(-1))[0] ?? null) : null;
  return { strongest, weakest, eligible: eligible.length };
}

export function computeMatchupSection(newest: readonly AnalyticsMatchRow[]): MatchupSection {
  const matchups = computeMatchups(newest);
  const considered = withOpponent(newest).length;
  return {
    opponents: computeOpponentPerformance(newest),
    matchups,
    highlights: computeMatchupHighlights(matchups),
    considered,
    unavailable: newest.length - considered,
  };
}
