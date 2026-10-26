/**
 * Master League display tiers (pure). A DISPLAY concept, separate from the rating system:
 *
 *   rating system   "lp" | "mr"          — how a character is rated (domain/sf6/types.ts)
 *   master tier     Master · High Master · Grand Master · Ultimate Master · Legend
 *
 * Thresholds (current Street Fighter 6 Master League, documented by the project owner):
 *   MR < 1600        Master
 *   1600 – 1699      High Master
 *   1700 – 1799      Grand Master
 *   1800 +           Ultimate Master
 *   Legend           NOT an MR threshold: it depends on the global leaderboard position (top
 *                    500). It is only produced from an AUTHORITATIVE leaderboard position, never
 *                    from MR alone. Since Phase 5.4C the position comes per character from
 *                    play.json (`master_rating_ranking`) for CURRENT presentation only.
 *
 * Tiers are DERIVED ON READ for current/live presentation only; persisted raw ranks are never
 * rewritten, and ended sessions keep their frozen labels (thresholds may change between phases;
 * an old session must not be relabelled by today's constants). An ended session whose stored MR
 * rank is MISSING shows the tier of its own MR instead of «—» (resolveDisplayRank `fillMissing`).
 */
import { LEGEND_MAX_POSITION } from "@sf6/capcom-core/legend";

export const MASTER_TIERS = [
  "master",
  "high-master",
  "grand-master",
  "ultimate-master",
  "legend",
] as const;
export type MasterTier = (typeof MASTER_TIERS)[number];

/** Display labels (official SF6 rank names — game terms, not translated). */
export const MASTER_TIER_LABELS: Readonly<Record<MasterTier, string>> = {
  master: "Master",
  "high-master": "High Master",
  "grand-master": "Grand Master",
  "ultimate-master": "Ultimate Master",
  legend: "Legend",
};

/** Minimum MR of each MR-based tier, highest first. The single place to update them. */
export const MASTER_MR_THRESHOLDS: ReadonlyArray<{ minMr: number; tier: MasterTier }> = [
  { minMr: 1800, tier: "ultimate-master" },
  { minMr: 1700, tier: "grand-master" },
  { minMr: 1600, tier: "high-master" },
];

/** Legend = this many best players on the global leaderboard (single source: capcom-core). */
export { LEGEND_MAX_POSITION };

/**
 * Master tier of a character known to be rated in MR.
 *
 * @param mr  the character's current Master Rate. null / non-finite / ≤ 0 ⇒ no tier (an MR of
 *            0 is Capcom's "no MR yet", not a rating).
 * @param opts.leaderboardPosition  AUTHORITATIVE global leaderboard position, if one exists.
 *            Only a position in 1…500 yields Legend; nothing else ever does.
 */
export function masterTierFromMr(
  mr: number | null | undefined,
  opts: { leaderboardPosition?: number | null } = {},
): MasterTier | null {
  if (mr === null || mr === undefined || !Number.isFinite(mr) || mr <= 0) return null;
  const position = opts.leaderboardPosition;
  if (
    typeof position === "number" &&
    Number.isInteger(position) &&
    position >= 1 &&
    position <= LEGEND_MAX_POSITION
  ) {
    return "legend";
  }
  for (const { minMr, tier } of MASTER_MR_THRESHOLDS) {
    if (mr >= minMr) return tier;
  }
  return "master";
}

/** What a rank is resolved from (the parts of a rating point it needs). */
export interface RankSourcePoint {
  system: "lp" | "mr";
  value: number;
  rank: string | null;
}

/**
 * Rank to DISPLAY for a rating point. Precedence:
 *  1. an authoritative, system-compatible Capcom label — for MR none is stored today (the
 *     normalizer never keeps Capcom text in the MR branch; the stored MR rank is SST's own
 *     `master_league` mapping), so for MR this step is not reachable yet;
 *  2. MR with a valid value and derivation allowed ⇒ the documented Master tier;
 *  3. otherwise the stored rank as is (LP: evidence-backed labels only; frozen history);
 *  4. otherwise null.
 *
 * `derive: false` is used for ended sessions: their stored/frozen labels are preserved.
 * `fillMissing` (ended sessions) adds ONE presentation fallback after step 3: an MR point whose
 * stored rank is MISSING shows the Master tier of its own MR. Capcom's higher Master leagues
 * carry no evidence-backed label, so their snapshots store `rank: null` (capcom-core league.ts)
 * and a finished session would otherwise show «—». A stored label always wins; nothing is
 * persisted or rewritten. Limitation: the tier uses TODAY's thresholds, so if they change, an old
 * session without a stored label is shown with the new mapping (labelled sessions never are).
 */
export function resolveDisplayRank(
  point: RankSourcePoint | null,
  opts: {
    derive: boolean;
    /** Ended sessions: derive a tier only when the stored rank is missing (see above). */
    fillMissing?: boolean;
    /**
     * Authoritative leaderboard position of the SAME observation as `point` (Phase 5.4C):
     * 1…500 ⇒ Legend. Never inferred: without one, MR alone never yields Legend.
     */
    leaderboardPosition?: number | null;
  },
): string | null {
  if (!point) return null;
  const tierOf = () =>
    point.system === "mr"
      ? masterTierFromMr(point.value, { leaderboardPosition: opts.leaderboardPosition ?? null })
      : null;
  if (opts.derive) {
    const tier = tierOf();
    if (tier) return MASTER_TIER_LABELS[tier];
  }
  if (point.rank !== null) return point.rank;
  if (opts.fillMissing) {
    const tier = tierOf();
    if (tier) return MASTER_TIER_LABELS[tier];
  }
  return null;
}
