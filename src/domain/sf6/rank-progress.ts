/**
 * Rank progress (Phase 5.4B, pure): where a character's CURRENT rating sits on the Street Fighter
 * 6 ladder and how far it is from the next goal. The single owner of the LP division thresholds
 * and of the progress math; renderers only format what this returns.
 *
 * Input is one rating point (system + value) of ONE character — never a rank label (labels are
 * derived here from the value, deterministically) and never a value of another character or
 * system.
 *
 * LP ladder (fixed, documented by the project owner): Rookie → Diamond, five divisions each, then
 * Master at 25,000 LP. MR (Master League) tiers come from ./master-tier.ts:
 *   < 1600 Master · 1600 High Master · 1700 Grand Master · 1800+ Ultimate Master.
 * Legend is NOT an MR threshold (top-500 leaderboard position only): it is never inferred from MR.
 *
 * Phase 5.4C (dynamic Legend): with the character's AUTHORITATIVE leaderboard position and the
 * latest FRESH Legend cutoff (capcom-core legend.ts), the MR ladder continues past Ultimate Master:
 *   position 1…500                 ⇒ Legend (terminal; position shown, no bar)
 *   ≥ 1800, MR < fresh cutoff      ⇒ legend-chase: bar 1800 → current cutoff, "MR to current cutoff"
 *   ≥ 1800, MR ≥ fresh cutoff      ⇒ legend-boundary: NOT Legend (Top 500 still required), no bar
 *   ≥ 1800, no fresh cutoff        ⇒ ultimate-master terminal (as 5.4B)
 */
import { LEGEND_REFERENCE, isLegendCutoffFresh } from "@sf6/capcom-core/legend";
import { MASTER_MR_THRESHOLDS, MASTER_TIER_LABELS, masterTierFromMr } from "./master-tier";
import type { MasterTier } from "./master-tier";

/** LP families below Master, lowest first. */
export const LP_FAMILIES = [
  "rookie",
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
] as const;
export type LpFamily = (typeof LP_FAMILIES)[number];

/** Display names (official SF6 rank names — game terms, not translated, like MASTER_TIER_LABELS). */
export const LP_FAMILY_LABELS: Readonly<Record<LpFamily, string>> = {
  rookie: "Rookie",
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

/** Start LP of divisions 1…5 of each family. The single place to update them. */
export const LP_DIVISION_THRESHOLDS: Readonly<
  Record<LpFamily, readonly [number, number, number, number, number]>
> = {
  rookie: [0, 200, 400, 600, 800],
  iron: [1000, 1400, 1800, 2200, 2600],
  bronze: [3000, 3400, 3800, 4200, 4600],
  silver: [5000, 5800, 6600, 7400, 8200],
  gold: [9000, 9800, 10600, 11400, 12200],
  platinum: [13000, 14200, 15400, 16600, 17800],
  diamond: [19000, 20200, 21400, 22600, 23800],
};

/** LP needed for Master (the end of the LP ladder). */
export const MASTER_LP = 25000;

/**
 * Presentation baseline of the Master → High Master bar (the MR a player enters Master with). NOT
 * a rank cutoff: a Master can fall below it and is still Master. Below it the bar starts at the
 * current value (0 %) instead of implying "below Master"; the remaining MR stays exact.
 */
export const MASTER_MR_DISPLAY_FLOOR = 1500;

export type RatingSystemId = "lp" | "mr";

/**
 * Stored goal. "auto" = the next step on the character's own ladder (LP: next division; MR: next
 * Master tier). "master" = Road to Master (LP only). The goal a character can use depends on its
 * CURRENT system, which may change (auto character, LP → MR promotion), so an incompatible stored
 * goal is normalized on read (effectiveRankGoal), never rewritten.
 */
export const RANK_PROGRESS_GOALS = ["auto", "master"] as const;
export type RankProgressGoal = (typeof RANK_PROGRESS_GOALS)[number];

/** The goal actually measured. */
export type EffectiveRankGoal = "next-division" | "master" | "next-master-tier";

/** Goals the builder offers for a rating system (never an invalid option). */
export function goalsForSystem(system: RatingSystemId): readonly RankProgressGoal[] {
  return system === "lp" ? RANK_PROGRESS_GOALS : ["auto"];
}

/** Deterministic normalization: MR has only one goal (next tier); "master" there means it. */
export function effectiveRankGoal(
  system: RatingSystemId,
  goal: RankProgressGoal,
): EffectiveRankGoal {
  if (system === "mr") return "next-master-tier";
  return goal === "master" ? "master" : "next-division";
}

export interface RankPoint {
  value: number;
  label: string;
}

export type RankProgressState =
  /** A determinate bar from `start` to `target` (start ≤ current < target). */
  | {
      kind: "progress";
      system: RatingSystemId;
      goal: EffectiveRankGoal;
      current: RankPoint;
      start: RankPoint;
      target: RankPoint;
      /** target − current, > 0. */
      remaining: number;
      /** Fraction of the bar, always within [0, 1]. */
      progress: number;
    }
  /** LP ≥ 25,000: Master reached on the LP ladder (no bar beyond it). */
  | { kind: "goal-reached"; system: "lp"; goal: EffectiveRankGoal; current: RankPoint }
  /** MR ≥ 1800, not Legend, no fresh cutoff: terminal ("Top 500 required"). */
  | { kind: "ultimate-master"; system: "mr"; current: RankPoint; position: number | null }
  /** MR ≥ 1800, not Legend, below the FRESH current cutoff: bar 1800 → cutoff. */
  | {
      kind: "legend-chase";
      system: "mr";
      current: RankPoint;
      position: number | null;
      cutoff: { value: number; observedAt: string };
      start: RankPoint;
      /** MR remaining to the CURRENT cutoff (> 0). Not "to Legend": position decides Legend. */
      remaining: number;
      progress: number;
    }
  /**
   * MR ≥ 1800 and at/above the FRESH current cutoff but NOT authoritatively Legend (position > 500
   * or unknown). No bar and no "0 MR": the remaining condition is positional (Top 500).
   */
  | {
      kind: "legend-boundary";
      system: "mr";
      current: RankPoint;
      position: number | null;
      cutoff: { value: number; observedAt: string };
    }
  /** Authoritative Legend: leaderboard position 1…500 (terminal; no bar). */
  | { kind: "legend"; system: "mr"; current: RankPoint; position: number }
  /** Nothing usable (no character, no rating, invalid value). Never a fabricated zero. */
  | { kind: "no-rating" };

/** Clamp to [0, 1]; NaN ⇒ 0 (never a malformed width). */
export function clampProgress(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return fraction >= 1 ? 1 : fraction;
}

export interface LpPosition {
  family: LpFamily;
  /** 1…5 */
  division: number;
  /** Start LP of the current division / of the current family (division 1). */
  divisionStart: number;
  familyStart: number;
  /** Start of the next division (or Master, from Diamond 5). */
  next: RankPoint;
  label: string;
}

const lpLabel = (family: LpFamily, division: number) => `${LP_FAMILY_LABELS[family]} ${division}`;

/** Position of an LP value below Master; null for ≥ 25,000 or an invalid value. */
export function lpPosition(lp: number): LpPosition | null {
  if (!Number.isFinite(lp) || lp < 0 || lp >= MASTER_LP) return null;
  for (let f = LP_FAMILIES.length - 1; f >= 0; f--) {
    const family = LP_FAMILIES[f]!;
    const thresholds = LP_DIVISION_THRESHOLDS[family];
    if (lp < thresholds[0]) continue;
    for (let d = thresholds.length - 1; d >= 0; d--) {
      if (lp < thresholds[d]!) continue;
      const nextFamily = LP_FAMILIES[f + 1];
      const next: RankPoint =
        d < thresholds.length - 1
          ? { value: thresholds[d + 1]!, label: lpLabel(family, d + 2) }
          : nextFamily
            ? { value: LP_DIVISION_THRESHOLDS[nextFamily][0], label: lpLabel(nextFamily, 1) }
            : { value: MASTER_LP, label: MASTER_TIER_LABELS.master };
      return {
        family,
        division: d + 1,
        divisionStart: thresholds[d]!,
        familyStart: thresholds[0],
        next,
        label: lpLabel(family, d + 1),
      };
    }
  }
  return null;
}

function bar(
  system: RatingSystemId,
  goal: EffectiveRankGoal,
  current: RankPoint,
  start: RankPoint,
  target: RankPoint,
): RankProgressState {
  return {
    kind: "progress",
    system,
    goal,
    current,
    start,
    target,
    remaining: target.value - current.value,
    progress: clampProgress((current.value - start.value) / (target.value - start.value)),
  };
}

/** Next MR tier above a non-terminal tier (from MASTER_MR_THRESHOLDS, lowest first). */
function nextMrTier(value: number): { minMr: number; tier: MasterTier } | null {
  const ascending = [...MASTER_MR_THRESHOLDS].sort((a, b) => a.minMr - b.minMr);
  return ascending.find((t) => value < t.minMr) ?? null;
}

/**
 * THE rank progress of one current rating point.
 *
 * LP · next division   bar from the current division's start to the next division's start
 *                      (Diamond 3 · 21,950 LP: 21,400 → 22,600, 650 remaining, 45.8 %).
 * LP · Road to Master  bar from the current FAMILY's start (division 1) to 25,000 LP: progress
 *                      through the current major rank's climb, not lifetime LP from zero.
 * LP ≥ 25,000          goal reached (Master); no bar beyond it.
 * MR · next tier       Master → 1600, High Master 1600 → 1700, Grand Master 1700 → 1800. The
 *                      Master bar starts at MASTER_MR_DISPLAY_FLOOR (presentation only; below it
 *                      the bar starts at the current value).
 * MR ≥ 1800            Ultimate Master: terminal (Legend needs an authoritative top-500 position,
 *                      which SST does not have).
 */
/** Legend context of ONE character's current observation (Phase 5.4C). */
export interface LegendContext {
  /** Authoritative leaderboard position of the SAME observation as the MR (null = unknown). */
  position?: number | null;
  /** Latest stored Legend boundary of the player (any age; freshness decided here). */
  cutoff?: { cutoffMr: number; observedAt: string } | null;
  /** Injected clock (ms) for the freshness decision. */
  nowMs?: number;
}

const validPosition = (p: number | null | undefined): number | null =>
  typeof p === "number" && Number.isInteger(p) && p > 0 ? p : null;

export function rankProgress(
  point: { system: RatingSystemId; value: number } | null | undefined,
  goal: RankProgressGoal,
  legend: LegendContext = {},
): RankProgressState {
  if (!point || !Number.isFinite(point.value)) return { kind: "no-rating" };
  const effective = effectiveRankGoal(point.system, goal);

  if (point.system === "lp") {
    if (point.value < 0) return { kind: "no-rating" };
    if (point.value >= MASTER_LP) {
      return {
        kind: "goal-reached",
        system: "lp",
        goal: effective,
        current: { value: point.value, label: MASTER_TIER_LABELS.master },
      };
    }
    const pos = lpPosition(point.value);
    if (!pos) return { kind: "no-rating" };
    const current = { value: point.value, label: pos.label };
    if (effective === "master") {
      return bar(
        "lp",
        effective,
        current,
        { value: pos.familyStart, label: lpLabel(pos.family, 1) },
        { value: MASTER_LP, label: MASTER_TIER_LABELS.master },
      );
    }
    return bar("lp", effective, current, { value: pos.divisionStart, label: pos.label }, pos.next);
  }

  // MR. Legend ONLY from the authoritative position (masterTierFromMr), never from MR or cutoff.
  const position = validPosition(legend.position);
  const tier = masterTierFromMr(point.value, { leaderboardPosition: position });
  if (tier === null) return { kind: "no-rating" };
  const current = { value: point.value, label: MASTER_TIER_LABELS[tier] };
  if (tier === "legend" && position !== null) {
    return { kind: "legend", system: "mr", current, position };
  }
  const next = nextMrTier(point.value);
  if (!next) {
    const cutoff = legend.cutoff ?? null;
    const usable =
      cutoff !== null &&
      Number.isInteger(cutoff.cutoffMr) &&
      cutoff.cutoffMr > LEGEND_REFERENCE.eligibleMinMr &&
      isLegendCutoffFresh(cutoff.observedAt, legend.nowMs ?? Date.now());
    if (!usable) return { kind: "ultimate-master", system: "mr", current, position };
    const ref = { value: cutoff.cutoffMr, observedAt: cutoff.observedAt };
    if (point.value >= cutoff.cutoffMr) {
      return { kind: "legend-boundary", system: "mr", current, position, cutoff: ref };
    }
    const start = LEGEND_REFERENCE.eligibleMinMr;
    return {
      kind: "legend-chase",
      system: "mr",
      current,
      position,
      cutoff: ref,
      start: { value: start, label: MASTER_TIER_LABELS["ultimate-master"] },
      remaining: cutoff.cutoffMr - point.value,
      progress: clampProgress((point.value - start) / (cutoff.cutoffMr - start)),
    };
  }
  const startValue =
    tier === "master"
      ? Math.min(MASTER_MR_DISPLAY_FLOOR, point.value)
      : (MASTER_MR_THRESHOLDS.find((t) => t.tier === tier)?.minMr ?? point.value);
  return bar(
    "mr",
    effective,
    current,
    { value: startValue, label: current.label },
    { value: next.minMr, label: MASTER_TIER_LABELS[next.tier] },
  );
}
