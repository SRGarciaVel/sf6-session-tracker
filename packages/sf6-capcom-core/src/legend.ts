/**
 * Dynamic Legend reference (Phase 5.4C). Pure: the single home of the Legend constants, the
 * tie-safe leaderboard boundary, the low-request page search and cutoff freshness.
 *
 *   Legend         authoritative leaderboard POSITION 1…500 (Buckler `master_rating_ranking`).
 *                  Never an MR threshold, never a row index: tied players share a position and
 *                  the next position skips (observed 2026-10-19: eight rows at #497 with
 *                  2196 MR, then #505 with 2195 MR — there is no row #500).
 *   Legend cutoff  the MR of the lowest-ranked Legend rows at the observed boundary. Context for
 *                  "how far am I", never proof of Legend: reaching it does not make anyone Legend.
 */
import type { MasterRankingPage, MasterRankingRow } from "./parse";
import type { NormalizedPlayerProfile } from "./types";

/** Legend = this many best positions on the global Master leaderboard. */
export const LEGEND_MAX_POSITION = 500;

export const LEGEND_REFERENCE = {
  /** Companion: look the cutoff up again at most this often (never on the 30 s battlelog beat). */
  refreshMs: 15 * 60_000,
  /** A stored cutoff is shown while its age is ≤ this (inclusive); older = stale = not shown. */
  freshMs: 30 * 60_000,
  /** Only a profile with an MR character at/above this (Ultimate Master) triggers a lookup. */
  eligibleMinMr: 1800,
  /** Hard cap of leaderboard pages per lookup; the boundary must be proven within it. */
  maxPages: 5,
  /** First guess of rows per page (observed: 20). Corrected from the actual responses. */
  assumedPageSize: 20,
  /** Clock skew tolerated for a cutoff observed "in the future" before it is distrusted. */
  futureToleranceMs: 5 * 60_000,
} as const;

export function isLegendPosition(position: number | null | undefined): boolean {
  return (
    typeof position === "number" &&
    Number.isInteger(position) &&
    position >= 1 &&
    position <= LEGEND_MAX_POSITION
  );
}

/**
 * Should this profile look the Legend cutoff up? Only when one of its characters is MR-rated at
 * Ultimate Master level (≥ 1800) and not already authoritatively Legend.
 */
export function isLegendReferenceEligible(profile: NormalizedPlayerProfile | null): boolean {
  return (
    profile?.characters.some(
      (c) =>
        c.ratingSystem === "mr" &&
        c.masterRate !== null &&
        c.masterRate >= LEGEND_REFERENCE.eligibleMinMr &&
        !isLegendPosition(c.leaderboardPosition),
    ) ?? false
  );
}

/** What a lookup proves. Derived numbers only: no row, identity or raw payload survives. */
export interface LegendBoundary {
  /** MR of the lowest-ranked Legend rows observed at the boundary. */
  cutoffMr: number;
  /** Highest position ≤ 500 observed at the boundary (e.g. 497 when tied rows skip 498–504). */
  lastLegendPosition: number;
  /** First position > 500 observed right after it (e.g. 505). */
  firstNonLegendPosition: number;
  firstNonLegendMr: number;
  /** Diagnostic: `master_league` separates the two sides (never the Legend rule). */
  leagueConsistent: boolean;
}

const isOrdered = (rows: readonly MasterRankingRow[]) =>
  rows.every(
    (r, i) => i === 0 || (r.position >= rows[i - 1]!.position && r.rating <= rows[i - 1]!.rating),
  );

/**
 * Tie-safe Legend boundary from fetched leaderboard pages (any order, any subset).
 *
 * Proven ONLY when the transition from a position ≤ 500 to a position > 500 is observed inside one
 * page, or between the last row of page N and the first row of page N + 1 (both fetched). Uses the
 * position FIELD only — never a row index, never "the 500th row", never `position === 500` —
 * and rejects pages whose positions / ratings are not ordered (no guessing from odd data).
 */
export function findLegendBoundary(pages: readonly MasterRankingPage[]): LegendBoundary | null {
  const sorted = [...pages].sort((a, b) => a.page - b.page);
  if (new Set(sorted.map((p) => p.page)).size !== sorted.length) return null;
  // The whole fetched sequence must be ordered (page order = leaderboard order).
  if (!isOrdered(sorted.flatMap((p) => p.rows))) return null;

  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i]!;
    const next = sorted[i + 1]?.page === page.page + 1 ? sorted[i + 1]! : null;
    // Window = this page (+ the next one when it is the adjacent page).
    const window = next ? [...page.rows, ...next.rows] : page.rows;
    const split = window.findIndex((r) => r.position > LEGEND_MAX_POSITION);
    if (split <= 0) continue; // no non-Legend row, or no Legend row before it
    // Only accept a transition that starts on THIS page (the next page's own one is next turn).
    if (split > page.rows.length) continue;
    const legend = window.slice(0, split);
    const first = window[split]!;
    const lastLegend = legend[legend.length - 1]!;
    const cutoffMr = Math.min(...legend.map((r) => r.rating));
    if (first.rating > cutoffMr) return null; // inconsistent ordering at the boundary
    const legendLeagues = new Set(legend.map((r) => r.masterLeague));
    const outside = window.slice(split).map((r) => r.masterLeague);
    return {
      cutoffMr,
      lastLegendPosition: lastLegend.position,
      firstNonLegendPosition: first.position,
      firstNonLegendMr: first.rating,
      leagueConsistent: legendLeagues.size === 1 && !outside.some((l) => legendLeagues.has(l)),
    };
  }
  return null;
}

export type LegendSearchStep =
  | { kind: "fetch"; page: number }
  | { kind: "found"; boundary: LegendBoundary }
  | {
      kind: "unavailable";
      reason: "page_cap" | "empty_page" | "out_of_range" | "inconsistent";
    };

/**
 * Deterministic low-request search for the boundary. Start on the page that should hold position
 * 500 for the assumed page size; then, from what was actually fetched:
 *   - a page with only Legend rows ⇒ the boundary is later (next page);
 *   - a page with only non-Legend rows ⇒ it is earlier (previous page);
 *   - the real page size (rows of a full page) corrects a wrong first guess with one jump.
 * Never more than `maxPages` pages; when the transition is not proven within them: unavailable.
 */
export function nextLegendSearchStep(
  pages: readonly MasterRankingPage[],
  options: { maxPages?: number; pageSizeHint?: number } = {},
): LegendSearchStep {
  const maxPages = options.maxPages ?? LEGEND_REFERENCE.maxPages;
  const hint = Math.max(1, options.pageSizeHint ?? LEGEND_REFERENCE.assumedPageSize);
  if (pages.length === 0) {
    return { kind: "fetch", page: Math.max(1, Math.ceil(LEGEND_MAX_POSITION / hint)) };
  }
  const boundary = findLegendBoundary(pages);
  if (boundary) return { kind: "found", boundary };
  if (pages.length >= maxPages) return { kind: "unavailable", reason: "page_cap" };

  const last = pages[pages.length - 1]!;
  if (last.rows.length === 0) return { kind: "unavailable", reason: "empty_page" };
  const fetched = new Set(pages.map((p) => p.page));
  const allLegend = last.rows.every((r) => r.position <= LEGEND_MAX_POSITION);
  const noneLegend = last.rows.every((r) => r.position > LEGEND_MAX_POSITION);
  if (!allLegend && !noneLegend) return { kind: "unavailable", reason: "inconsistent" };

  // Real page size: rows of a full (non-last) fetched page.
  const full = pages.filter((p) => p.page < p.totalPages).map((p) => p.rows.length);
  const pageSize = full.length > 0 ? Math.max(...full) : null;
  const estimate = pageSize ? Math.max(1, Math.ceil(LEGEND_MAX_POSITION / pageSize)) : null;

  let target = allLegend ? last.page + 1 : last.page - 1;
  if (
    estimate !== null &&
    !fetched.has(estimate) &&
    (allLegend ? estimate > last.page + 1 : estimate < last.page - 1)
  ) {
    target = estimate; // the first guess assumed a wrong page size: jump once
  }
  if (target < 1 || target > last.totalPages || fetched.has(target)) {
    return { kind: "unavailable", reason: "out_of_range" };
  }
  return { kind: "fetch", page: target };
}

/**
 * Freshness of a stored cutoff (server acceptance time). Fresh while 0 ≤ age ≤ freshMs (the
 * boundary itself is fresh); older, unparsable, or too far in the future = stale.
 */
export function isLegendCutoffFresh(observedAt: string | Date | null, nowMs: number): boolean {
  if (observedAt === null) return false;
  const t = typeof observedAt === "string" ? Date.parse(observedAt) : observedAt.getTime();
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= -LEGEND_REFERENCE.futureToleranceMs && age <= LEGEND_REFERENCE.freshMs;
}
