import { describe, expect, it } from "vitest";
import { rankPrestige } from "./rank-prestige";

describe("rankPrestige (SF6 label → generic prestige)", () => {
  it.each([
    ["Rookie 2", "lp", "rookie", 1, "2"],
    ["Iron 5", "lp", "iron", 1, "5"],
    ["Bronze 3", "lp", "bronze", 1, "3"],
    ["Silver 1", "lp", "silver", 2, "1"],
    ["Gold 4", "lp", "gold", 2, "4"],
    ["Platinum 3", "lp", "platinum", 3, "3"],
    ["Diamond 1", "lp", "diamond", 4, "1"],
    ["Master", "mr", "master", 5, null],
    ["High Master", "mr", "high-master", 6, null],
    ["Grand Master", "mr", "grand-master", 6, null],
    ["Ultimate Master", "mr", "ultimate-master", 6, null],
    ["  diamond 2 ", "lp", "diamond", 4, "2"],
  ] as const)("%s → %s (level %i)", (label, system, family, level, division) => {
    expect(rankPrestige(label, system)).toMatchObject({ family, level, division });
  });

  it("never invents a rank: unknown label uses the system, else unranked", () => {
    expect(rankPrestige(null, "mr")).toMatchObject({ family: "master", level: 5 });
    expect(rankPrestige("—", "lp")).toMatchObject({ family: "unranked", level: 0 });
    expect(rankPrestige("Legend", null)).toMatchObject({ family: "unranked", level: 0 });
    expect(rankPrestige(undefined, undefined)).toMatchObject({ family: "unranked", level: 0 });
  });

  it("colors are fixed #rrggbb tokens (no data-driven CSS)", () => {
    for (const label of ["Rookie 1", "Gold 2", "Diamond 5", "Master", "Grand Master", null]) {
      expect(rankPrestige(label, "lp").color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
