/**
 * Phase 5.4C — dynamic Legend: ranking schema, per-character position from play.json, the
 * tie-safe boundary (position field only), the bounded page search, freshness, eligibility, and
 * the additive sync contract. Fixtures: sanitized ranking pages 25 / 26 (no identities) shaped on
 * the 2026-10-19 observation: 493×4 @2197, 497×8 @2196, 505×2 @2195 — there is no row #500.
 */
import { describe, expect, it } from "vitest";
import { bucklerPaths } from "../src/buckler";
import {
  companionLegendReferenceSchema,
  companionSyncRequestSchema,
  findForbiddenKeys,
  toWireLegend,
  toWireProfile,
} from "../src/companion";
import {
  LEGEND_MAX_POSITION,
  LEGEND_REFERENCE,
  findLegendBoundary,
  isLegendCutoffFresh,
  isLegendPosition,
  isLegendReferenceEligible,
  nextLegendSearchStep,
} from "../src/legend";
import {
  normalizeCapcomProfile,
  parseCapcomMasterRankingPayload,
  parseCapcomPlayPayload,
  validLeaderboardPosition,
  type MasterRankingPage,
} from "../src/parse";
import { masterRankingPageSchema } from "../src/schemas";
import type { NormalizedPlayerProfile } from "../src/types";
import { CFN, loadFixture, playFixture } from "./fixtures";

const page25 = () => parseCapcomMasterRankingPayload(loadFixture("ranking-master-page-25.json"));
const page26 = () => parseCapcomMasterRankingPayload(loadFixture("ranking-master-page-26.json"));

/** Synthetic page from [position, rating] pairs (sanitized: numbers only). */
function page(n: number, rows: Array<[number, number]>, totalPages = 1500): MasterRankingPage {
  return {
    page: n,
    totalPages,
    totalCount: totalPages * 20,
    rows: rows.map(([position, rating]) => ({
      position,
      rating,
      masterLeague: position <= 500 ? 37 : 42,
    })),
  };
}

describe("ranking page schema / parser", () => {
  it("parses the sanitized pages and keeps ONLY numbers (no identity survives)", () => {
    const p = page25();
    expect(p).toMatchObject({ page: 25, totalPages: 1500, totalCount: 30000 });
    expect(p.rows).toHaveLength(20);
    expect(Object.keys(p.rows[0]!).sort()).toEqual(["masterLeague", "position", "rating"]);
    expect(JSON.stringify([p, page26()])).not.toMatch(/SANITIZED|fighter|short_id|circle/);
  });

  it("tolerates unknown fields (loose objects)", () => {
    const raw = loadFixture("ranking-master-page-25.json") as {
      pageProps: {
        master_rating_ranking: Record<string, unknown> & {
          ranking_fighter_list: Record<string, unknown>[];
        };
      };
    };
    raw.pageProps.master_rating_ranking.brand_new_field = { x: 1 };
    raw.pageProps.master_rating_ranking.ranking_fighter_list[0]!.another = "y";
    expect(masterRankingPageSchema.safeParse(raw).success).toBe(true);
  });

  type Raw = {
    pageProps: Record<string, unknown> & {
      master_rating_ranking?: Record<string, unknown> & {
        ranking_fighter_list: Array<Record<string, unknown>>;
      };
    };
  };
  const block = (r: Raw) => r.pageProps.master_rating_ranking!;
  const row3 = (r: Raw) => block(r).ranking_fighter_list[3]!;
  it.each<[string, (r: Raw) => void]>([
    ["missing master_rating_ranking block", (r) => delete r.pageProps.master_rating_ranking],
    ["missing row position", (r) => delete row3(r).master_rating_ranking],
    ["missing row rating", (r) => delete row3(r).rating],
    ["rank 0", (r) => (row3(r).master_rating_ranking = 0)],
    ["rank as text", (r) => (row3(r).master_rating_ranking = "497")],
    ["fractional rank", (r) => (row3(r).master_rating_ranking = 497.5)],
    ["negative rating", (r) => (row3(r).rating = -1)],
    ["rating as text", (r) => (row3(r).rating = "2196")],
    ["missing current_page", (r) => delete block(r).current_page],
  ])("rejects a page with %s (a boundary is never proven from odd data)", (_, mutate) => {
    const raw = loadFixture("ranking-master-page-25.json") as Raw;
    mutate(raw);
    expect(() => parseCapcomMasterRankingPayload(raw)).toThrow();
  });
});

describe("own position from play.json (per character)", () => {
  it("MR characters keep master_rating_ranking; LP / unrated characters get null", () => {
    const { profile } = normalizeCapcomProfile(parseCapcomPlayPayload(playFixture()), {
      cfnUserId: CFN,
    });
    const by = (k: string) => profile.characters.find((c) => c.characterKey === k)!;
    expect(by("ryu")).toMatchObject({
      ratingSystem: "mr",
      masterRate: 1341,
      leaderboardPosition: 677769,
    });
    expect(by("honda").leaderboardPosition).toBe(294274);
    expect(by("luke")).toMatchObject({ ratingSystem: "lp", leaderboardPosition: null });
    expect(by("manon").leaderboardPosition).toBeNull(); // unrated
  });

  it("an invalid / zero position on an MR character is null (never fabricated)", () => {
    const raw = playFixture() as {
      pageProps: {
        play: {
          character_league_infos: Array<{
            character_tool_name: string;
            league_info: Record<string, number>;
          }>;
        };
      };
    };
    const ryu = raw.pageProps.play.character_league_infos.find(
      (c) => c.character_tool_name === "ryu",
    )!;
    ryu.league_info.master_rating_ranking = 0;
    const { profile } = normalizeCapcomProfile(parseCapcomPlayPayload(raw), { cfnUserId: CFN });
    expect(
      profile.characters.find((c) => c.characterKey === "ryu")?.leaderboardPosition,
    ).toBeNull();
    for (const bad of [0, -3, 1.5, Number.NaN, "327", null, undefined]) {
      expect(validLeaderboardPosition(bad)).toBeNull();
    }
    expect(validLeaderboardPosition(327)).toBe(327);
  });

  it("the wire profile carries it (whitelist) and the contract validates it", () => {
    const { profile } = normalizeCapcomProfile(parseCapcomPlayPayload(playFixture()), {
      cfnUserId: CFN,
    });
    const wire = toWireProfile(profile);
    expect(wire.characters.find((c) => c.characterKey === "ryu")?.leaderboardPosition).toBe(677769);
  });
});

describe("Legend position rule", () => {
  it("1…500 only", () => {
    expect(LEGEND_MAX_POSITION).toBe(500);
    for (const p of [1, 327, 497, 500]) expect(isLegendPosition(p)).toBe(true);
    for (const p of [0, 501, 505, -1, 1.5, null, undefined])
      expect(isLegendPosition(p)).toBe(false);
  });
});

describe("tie-safe boundary (position field only)", () => {
  it("captured-shape fixture: ties cross page 25 → 26; no row #500 exists", () => {
    const p25 = page25();
    const p26 = page26();
    const all = [...p25.rows, ...p26.rows];
    expect(all.some((r) => r.position === 500)).toBe(false);
    // The 500th row by index is a #497 row: index ≠ position.
    expect(all.findIndex((r) => r.position === 497)).toBeLessThan(20);
    expect(findLegendBoundary([p25, p26])).toEqual({
      cutoffMr: 2196,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
      firstNonLegendMr: 2195,
      leagueConsistent: true,
    });
  });

  it("the exact 14-row sequence (493×4, 497×8, 505×2) inside one page", () => {
    const rows: Array<[number, number]> = [
      ...Array.from({ length: 4 }, () => [493, 2197] as [number, number]),
      ...Array.from({ length: 8 }, () => [497, 2196] as [number, number]),
      [505, 2195],
      [505, 2195],
    ];
    expect(findLegendBoundary([page(25, rows)])).toMatchObject({
      cutoffMr: 2196,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
      firstNonLegendMr: 2195,
    });
  });

  it("transition exactly between pages (last row of N Legend, first row of N+1 not)", () => {
    expect(
      findLegendBoundary([
        page(25, [
          [499, 2201],
          [500, 2200],
        ]),
        page(26, [
          [501, 2199],
          [502, 2198],
        ]),
      ]),
    ).toMatchObject({ cutoffMr: 2200, lastLegendPosition: 500, firstNonLegendPosition: 501 });
  });

  it("not proven: only Legend rows, only non-Legend rows, or non-adjacent pages", () => {
    expect(
      findLegendBoundary([
        page(25, [
          [480, 2210],
          [497, 2196],
        ]),
      ]),
    ).toBeNull();
    expect(
      findLegendBoundary([
        page(26, [
          [505, 2195],
          [520, 2180],
        ]),
      ]),
    ).toBeNull();
    expect(
      findLegendBoundary([
        page(24, [
          [470, 2220],
          [480, 2210],
        ]),
        page(26, [[505, 2195]]),
      ]),
    ).toBeNull();
    expect(findLegendBoundary([])).toBeNull();
  });

  it("unordered / contradictory data is never trusted", () => {
    expect(
      findLegendBoundary([
        page(25, [
          [505, 2195],
          [497, 2196],
        ]),
      ]),
    ).toBeNull();
    expect(
      findLegendBoundary([
        page(25, [
          [497, 2190],
          [505, 2195],
        ]),
      ]),
    ).toBeNull();
    expect(findLegendBoundary([page(25, [[497, 2196]]), page(25, [[505, 2195]])])).toBeNull();
  });

  it("duplicate (tied) rows are fine; master_league disagreement is only diagnostic", () => {
    const b = findLegendBoundary([
      {
        page: 25,
        totalPages: 10,
        totalCount: 200,
        rows: [
          { position: 497, rating: 2196, masterLeague: 42 },
          { position: 497, rating: 2196, masterLeague: 42 },
          { position: 505, rating: 2195, masterLeague: 42 },
        ],
      },
    ]);
    expect(b).toMatchObject({ cutoffMr: 2196, leagueConsistent: false });
  });
});

describe("bounded page search", () => {
  it("starts on the page that should hold #500, then follows the fixture to page 26", () => {
    expect(nextLegendSearchStep([])).toEqual({ kind: "fetch", page: 25 });
    expect(nextLegendSearchStep([page25()])).toEqual({ kind: "fetch", page: 26 });
    expect(nextLegendSearchStep([page25(), page26()])).toMatchObject({
      kind: "found",
      boundary: { cutoffMr: 2196 },
    });
  });

  it("a page with only non-Legend rows ⇒ the previous page", () => {
    expect(
      nextLegendSearchStep([
        page(25, [
          [505, 2195],
          [506, 2194],
        ]),
      ]),
    ).toEqual({
      kind: "fetch",
      page: 24,
    });
  });

  it("a changed page size is corrected with one jump (50 rows/page ⇒ page 10)", () => {
    const rows = Array.from({ length: 50 }, (_, i) => [1201 + i, 2000 - i] as [number, number]);
    expect(nextLegendSearchStep([page(25, rows, 600)])).toEqual({ kind: "fetch", page: 10 });
    const rows10 = Array.from({ length: 50 }, (_, i) => [451 + i, 2250 - i] as [number, number]);
    expect(nextLegendSearchStep([page(25, rows, 600), page(10, rows10, 600)])).toEqual({
      kind: "fetch",
      page: 11,
    });
  });

  it("smaller pages (10 rows) start at page 50 when hinted", () => {
    expect(nextLegendSearchStep([], { pageSizeHint: 10 })).toEqual({ kind: "fetch", page: 50 });
  });

  it("never more than the cap: an unproven boundary is unavailable, not guessed", () => {
    const legendOnly = (n: number) => page(n, [[480 + n, 2300 - n]]);
    const fetched = [25, 26, 27, 28, 29].map(legendOnly);
    expect(LEGEND_REFERENCE.maxPages).toBe(5);
    expect(nextLegendSearchStep(fetched)).toEqual({ kind: "unavailable", reason: "page_cap" });
  });

  it("empty page / out of range / inconsistent page are unavailable", () => {
    expect(nextLegendSearchStep([page(25, [])])).toEqual({
      kind: "unavailable",
      reason: "empty_page",
    });
    expect(nextLegendSearchStep([page(1, [[505, 2195]])])).toEqual({
      kind: "unavailable",
      reason: "out_of_range",
    });
    expect(
      nextLegendSearchStep([
        page(25, [
          [497, 2190],
          [505, 2195],
        ]),
      ]),
    ).toEqual({
      kind: "unavailable",
      reason: "inconsistent",
    });
  });
});

describe("freshness (injected clock)", () => {
  const at = Date.parse("2026-10-19T12:00:00Z");
  const iso = (msAgo: number) => new Date(at - msAgo).toISOString();
  it("≤ 30 min fresh (inclusive), > 30 min stale", () => {
    expect(isLegendCutoffFresh(iso(10 * 60_000), at)).toBe(true);
    expect(isLegendCutoffFresh(iso(30 * 60_000), at)).toBe(true);
    expect(isLegendCutoffFresh(iso(30 * 60_000 + 1), at)).toBe(false);
    expect(isLegendCutoffFresh(null, at)).toBe(false);
    expect(isLegendCutoffFresh("garbage", at)).toBe(false);
    expect(isLegendCutoffFresh(iso(-60 * 60_000), at)).toBe(false); // far future: distrusted
  });
});

describe("eligibility (no ranking traffic below Ultimate Master)", () => {
  const profile = (mr: number | null, system: "lp" | "mr" = "mr", position: number | null = null) =>
    ({
      cfnUserId: CFN,
      displayName: "x",
      characters: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          rank: null,
          rankTier: null,
          ratingSystem: system,
          leaguePoints: system === "lp" ? 21950 : 0,
          masterRate: mr,
          leaderboardPosition: position,
        },
      ],
    }) satisfies NormalizedPlayerProfile;
  it("only MR ≥ 1800 that is not already Legend", () => {
    expect(isLegendReferenceEligible(profile(1799))).toBe(false);
    expect(isLegendReferenceEligible(profile(1642))).toBe(false);
    expect(isLegendReferenceEligible(profile(null, "lp"))).toBe(false);
    expect(isLegendReferenceEligible(profile(1800))).toBe(true);
    expect(isLegendReferenceEligible(profile(2189, "mr", 530))).toBe(true);
    expect(isLegendReferenceEligible(profile(2241, "mr", 327))).toBe(false);
    expect(isLegendReferenceEligible(null)).toBe(false);
  });
});

describe("sync contract (additive, derived numbers only)", () => {
  const base = {
    cfnUserId: CFN,
    observedAt: "2026-10-19T12:00:00.000Z",
    profile: null,
    matches: [],
    gapSuspected: false,
    client: { version: "0.3.0", transport: "service_worker" },
  };
  const boundary = findLegendBoundary([page25(), page26()])!;

  it("an old payload without `legend` is accepted", () => {
    expect(companionSyncRequestSchema.safeParse(base).success).toBe(true);
  });
  it("a payload with the derived boundary is accepted; the wire form drops diagnostics", () => {
    const legend = toWireLegend(boundary);
    expect(legend).toEqual({
      cutoffMr: 2196,
      lastLegendPosition: 497,
      firstNonLegendPosition: 505,
      firstNonLegendMr: 2195,
    });
    expect(companionSyncRequestSchema.safeParse({ ...base, legend }).success).toBe(true);
    expect(findForbiddenKeys({ ...base, legend })).toEqual([]);
  });
  it("rows, identities or out-of-range values in `legend` are rejected", () => {
    const legend = toWireLegend(boundary);
    for (const bad of [
      { ...legend, rows: [] },
      { ...legend, ranking_fighter_list: [] },
      { ...legend, fighterId: "x" },
      { ...legend, lastLegendPosition: 501 },
      { ...legend, firstNonLegendPosition: 500 },
      { ...legend, firstNonLegendMr: 2300 },
      { ...legend, cutoffMr: 0 },
    ]) {
      expect(companionLegendReferenceSchema.safeParse(bad).success).toBe(false);
      expect(companionSyncRequestSchema.safeParse({ ...base, legend: bad }).success).toBe(false);
    }
  });
  it("credentials are still rejected", () => {
    expect(companionSyncRequestSchema.safeParse({ ...base, cookies: "x" }).success).toBe(false);
  });
});

describe("ranking path", () => {
  it("dynamic buildId + page locale, current phase", () => {
    expect(bucklerPaths.masterRanking("abc123XYZ", 25, "es-es")).toBe(
      "/6/buckler/_next/data/abc123XYZ/es-es/ranking/master.json?page=25&season_type=1",
    );
    expect(bucklerPaths.masterRanking("abc123XYZ", 1)).toContain(
      "/en/ranking/master.json?page=1&season_type=1",
    );
    expect(() => bucklerPaths.masterRanking("abc123XYZ", 0)).toThrow();
    expect(() => bucklerPaths.masterRanking("abc123XYZ", 2, "../x")).toThrow();
  });
});
