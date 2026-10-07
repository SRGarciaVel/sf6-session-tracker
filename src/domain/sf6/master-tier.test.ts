import { describe, expect, it } from "vitest";
import {
  LEGEND_MAX_POSITION,
  MASTER_TIER_LABELS,
  masterTierFromMr,
  resolveDisplayRank,
} from "./master-tier";

describe("masterTierFromMr — documented thresholds", () => {
  it.each([
    [1500, "master"],
    [1599, "master"],
    [1600, "high-master"],
    [1605, "high-master"],
    [1699, "high-master"],
    [1700, "grand-master"],
    [1799, "grand-master"],
    [1800, "ultimate-master"],
    [2000, "ultimate-master"],
    [1, "master"],
  ] as const)("MR %i → %s", (mr, tier) => {
    expect(masterTierFromMr(mr)).toBe(tier);
  });

  it("no MR ⇒ no tier (null, undefined, 0, negative, non-finite)", () => {
    for (const mr of [null, undefined, 0, -1, -1600, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(masterTierFromMr(mr)).toBeNull();
    }
  });

  it("Legend is NEVER inferred from MR alone", () => {
    for (const mr of [1800, 2200, 2500, 9999]) {
      expect(masterTierFromMr(mr)).not.toBe("legend");
      expect(masterTierFromMr(mr, { leaderboardPosition: null })).not.toBe("legend");
    }
  });

  it("Legend only from an authoritative leaderboard position 1…500", () => {
    expect(masterTierFromMr(1800, { leaderboardPosition: 1 })).toBe("legend");
    expect(masterTierFromMr(1650, { leaderboardPosition: LEGEND_MAX_POSITION })).toBe("legend");
    expect(masterTierFromMr(2100, { leaderboardPosition: LEGEND_MAX_POSITION + 1 })).toBe(
      "ultimate-master",
    );
    for (const bad of [0, -3, 12.5, Number.NaN]) {
      expect(masterTierFromMr(1900, { leaderboardPosition: bad })).toBe("ultimate-master");
    }
    // A position without a valid MR is not a Master tier at all.
    expect(masterTierFromMr(0, { leaderboardPosition: 3 })).toBeNull();
  });

  it("labels are the official SF6 names", () => {
    expect(MASTER_TIER_LABELS).toEqual({
      master: "Master",
      "high-master": "High Master",
      "grand-master": "Grand Master",
      "ultimate-master": "Ultimate Master",
      legend: "Legend",
    });
  });
});

describe("resolveDisplayRank — precedence", () => {
  it("MR with a valid value (current presentation) ⇒ the derived tier, over SST's own mapping", () => {
    expect(resolveDisplayRank({ system: "mr", value: 1605, rank: null }, { derive: true })).toBe(
      "High Master",
    );
    // The stored "Master" is SST's master_league mapping, not Capcom text: the MR tier wins.
    expect(
      resolveDisplayRank({ system: "mr", value: 1712, rank: "Master" }, { derive: true }),
    ).toBe("Grand Master");
  });

  it("LP never gets a Master tier: evidence-backed label or null", () => {
    expect(
      resolveDisplayRank({ system: "lp", value: 19704, rank: "Diamond 1" }, { derive: true }),
    ).toBe("Diamond 1");
    expect(resolveDisplayRank({ system: "lp", value: 26000, rank: null }, { derive: true })).toBe(
      null,
    );
  });

  it("frozen (ended session) ⇒ the stored label as is, never relabelled", () => {
    expect(
      resolveDisplayRank({ system: "mr", value: 1605, rank: "Master" }, { derive: false }),
    ).toBe("Master");
    expect(resolveDisplayRank({ system: "mr", value: 1605, rank: null }, { derive: false })).toBe(
      null,
    );
  });

  it("no point ⇒ null; MR without a usable value keeps the stored label", () => {
    expect(resolveDisplayRank(null, { derive: true })).toBeNull();
    expect(resolveDisplayRank({ system: "mr", value: 0, rank: "Master" }, { derive: true })).toBe(
      "Master",
    );
  });
});
