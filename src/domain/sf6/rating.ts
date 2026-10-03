/**
 * Rating rules (LP vs MR). Pure functions — UI components must use these instead of
 * re-implementing rank logic.
 */

export type RatingSystem = "lp" | "mr";

export interface RatingSnapshot {
  rank: string | null;
  leaguePoints: number | null;
  masterRate: number | null;
}

export interface MetricDelta {
  initial: number | null;
  current: number | null;
  /** current - initial, or null when either side is unknown. */
  delta: number | null;
}

export interface RatingView {
  /** Primary metric to display. */
  system: RatingSystem;
  rank: string | null;
  initialRank: string | null;
  lp: MetricDelta;
  mr: MetricDelta;
  /** Shortcut for the primary metric. */
  primary: MetricDelta;
}

export const EMPTY_RATING: RatingSnapshot = { rank: null, leaguePoints: null, masterRate: null };

/** A player is on the MR system when the source reports a Master Rate or a Master rank label. */
export function resolveRatingSystem(snapshot: RatingSnapshot): RatingSystem {
  if (snapshot.masterRate !== null && snapshot.masterRate > 0) return "mr";
  if (snapshot.rank !== null && /master/i.test(snapshot.rank)) return "mr";
  return "lp";
}

function metricDelta(initial: number | null, current: number | null): MetricDelta {
  return {
    initial,
    current,
    delta: initial !== null && current !== null ? current - initial : null,
  };
}

export function buildRatingView(initial: RatingSnapshot, current: RatingSnapshot): RatingView {
  const system = resolveRatingSystem(current);
  const lp = metricDelta(initial.leaguePoints, current.leaguePoints);
  const mr = metricDelta(initial.masterRate, current.masterRate);
  return {
    system,
    rank: current.rank,
    initialRank: initial.rank,
    lp,
    mr,
    primary: system === "mr" ? mr : lp,
  };
}

export function ratingSnapshotEquals(a: RatingSnapshot, b: RatingSnapshot): boolean {
  return a.rank === b.rank && a.leaguePoints === b.leaguePoints && a.masterRate === b.masterRate;
}
