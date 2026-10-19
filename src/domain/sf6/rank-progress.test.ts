/**
 * Phase 5.4B — rank progress domain: every LP division boundary, Road to Master, the fixed MR
 * Master tiers, clamping, and "Legend is never inferred from MR".
 */
import { describe, expect, it } from "vitest";
import {
  LP_DIVISION_THRESHOLDS,
  LP_FAMILIES,
  LP_FAMILY_LABELS,
  MASTER_LP,
  MASTER_MR_DISPLAY_FLOOR,
  clampProgress,
  effectiveRankGoal,
  goalsForSystem,
  lpPosition,
  rankProgress,
  type RankProgressState,
} from "./rank-progress";

const lp = (value: number, goal: "auto" | "master" = "auto") =>
  rankProgress({ system: "lp", value }, goal);
const mr = (value: number, goal: "auto" | "master" = "auto") =>
  rankProgress({ system: "mr", value }, goal);

function progressOf(s: RankProgressState) {
  if (s.kind !== "progress") throw new Error(`expected progress, got ${s.kind}`);
  return s;
}

/** Every division start, in ladder order, followed by Master. */
const LADDER = [
  ...LP_FAMILIES.flatMap((f) =>
    LP_DIVISION_THRESHOLDS[f].map((value, i) => ({
      value,
      label: `${LP_FAMILY_LABELS[f]} ${i + 1}`,
      familyStart: LP_DIVISION_THRESHOLDS[f][0],
      familyLabel: `${LP_FAMILY_LABELS[f]} 1`,
    })),
  ),
];

describe("LP ladder data", () => {
  it("is exactly the documented model (35 divisions, then Master at 25,000)", () => {
    expect(LADDER.map((d) => d.value)).toEqual([
      0, 200, 400, 600, 800, 1000, 1400, 1800, 2200, 2600, 3000, 3400, 3800, 4200, 4600, 5000, 5800,
      6600, 7400, 8200, 9000, 9800, 10600, 11400, 12200, 13000, 14200, 15400, 16600, 17800, 19000,
      20200, 21400, 22600, 23800,
    ]);
    expect(MASTER_LP).toBe(25000);
  });
});

describe("LP · next division — every boundary", () => {
  LADDER.forEach((div, i) => {
    const next = LADDER[i + 1] ?? { value: MASTER_LP, label: "Master" };
    const width = next.value - div.value;
    it(`${div.label} (${div.value} → ${next.value})`, () => {
      // Exactly at the division start: this division, 0 %.
      const at = progressOf(lp(div.value));
      expect(at.current).toEqual({ value: div.value, label: div.label });
      expect(at.start).toEqual({ value: div.value, label: div.label });
      expect(at.target).toEqual({ value: next.value, label: next.label });
      expect(at.remaining).toBe(width);
      expect(at.progress).toBe(0);
      expect(at.goal).toBe("next-division");
      // One point below the next start: still this division, 1 remaining.
      const last = progressOf(lp(next.value - 1));
      expect(last.current.label).toBe(div.label);
      expect(last.remaining).toBe(1);
      expect(last.progress).toBeCloseTo((width - 1) / width, 10);
      // One point below this start: the previous division (or nothing below 0).
      if (i > 0) expect(progressOf(lp(div.value - 1)).current.label).toBe(LADDER[i - 1]!.label);
    });
  });

  it("the documented example: Diamond 3 · 21,950 LP ⇒ 650 to Diamond 4, 45.83 %", () => {
    const s = progressOf(lp(21950));
    expect(s.current).toEqual({ value: 21950, label: "Diamond 3" });
    expect(s.start.value).toBe(21400);
    expect(s.target).toEqual({ value: 22600, label: "Diamond 4" });
    expect(s.remaining).toBe(650);
    expect(s.progress).toBeCloseTo(550 / 1200, 12);
    expect(s.progress).toBeCloseTo(0.458333, 5);
  });

  it("family transitions: Rookie 5 → Iron 1, Diamond 5 → Master", () => {
    expect(progressOf(lp(999)).target).toEqual({ value: 1000, label: "Iron 1" });
    expect(progressOf(lp(1000)).current.label).toBe("Iron 1");
    expect(progressOf(lp(24999)).target).toEqual({ value: 25000, label: "Master" });
  });

  it("non-integer LP is placed by value (no label parsing)", () => {
    expect(progressOf(lp(21400.5)).current.label).toBe("Diamond 3");
  });
});

describe("LP · Road to Master", () => {
  it.each([
    [9000, 9000, "Gold 1"],
    [12199, 9000, "Gold 1"],
    [13000, 13000, "Platinum 1"],
    [19000, 19000, "Diamond 1"],
    [21950, 19000, "Diamond 1"],
    [24999, 19000, "Diamond 1"],
    [0, 0, "Rookie 1"],
    [4999, 3000, "Bronze 1"],
  ])("%d LP: bar from the current family's start (%d) to 25,000", (value, start, startLabel) => {
    const s = progressOf(lp(value, "master"));
    expect(s.goal).toBe("master");
    expect(s.start).toEqual({ value: start, label: startLabel });
    expect(s.target).toEqual({ value: 25000, label: "Master" });
    expect(s.remaining).toBe(25000 - value);
    expect(s.progress).toBeCloseTo((value - start) / (25000 - start), 12);
  });

  it("is not lifetime LP / 25,000", () => {
    expect(progressOf(lp(21950, "master")).progress).not.toBeCloseTo(21950 / 25000, 3);
  });
});

describe("LP ≥ Master", () => {
  it.each([25000, 25001, 31000])("%d LP ⇒ goal reached (Master), no bar", (value) => {
    for (const goal of ["auto", "master"] as const) {
      const s = lp(value, goal);
      expect(s).toEqual({
        kind: "goal-reached",
        system: "lp",
        goal: goal === "master" ? "master" : "next-division",
        current: { value, label: "Master" },
      });
    }
  });
});

describe("LP invalid input", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("%d ⇒ no rating", (value) => {
    expect(lp(value)).toEqual({ kind: "no-rating" });
  });
  it("no point ⇒ no rating (never a fabricated Rookie 0 %)", () => {
    expect(rankProgress(null, "auto")).toEqual({ kind: "no-rating" });
    expect(rankProgress(undefined, "master")).toEqual({ kind: "no-rating" });
    expect(lpPosition(-5)).toBeNull();
    expect(lpPosition(25000)).toBeNull();
  });
});

describe("MR · fixed Master tiers", () => {
  it.each([
    [1499, "Master", 1499, 1600, "High Master"],
    [1500, "Master", 1500, 1600, "High Master"],
    [1542, "Master", 1500, 1600, "High Master"],
    [1599, "Master", 1500, 1600, "High Master"],
    [1600, "High Master", 1600, 1700, "Grand Master"],
    [1642, "High Master", 1600, 1700, "Grand Master"],
    [1699, "High Master", 1600, 1700, "Grand Master"],
    [1700, "Grand Master", 1700, 1800, "Ultimate Master"],
    [1742, "Grand Master", 1700, 1800, "Ultimate Master"],
    [1799, "Grand Master", 1700, 1800, "Ultimate Master"],
  ])("%d MR ⇒ %s, bar %d → %d (%s)", (value, label, start, target, targetLabel) => {
    const s = progressOf(mr(value));
    expect(s.system).toBe("mr");
    expect(s.goal).toBe("next-master-tier");
    expect(s.current).toEqual({ value, label });
    expect(s.start.value).toBe(start);
    expect(s.target).toEqual({ value: target, label: targetLabel });
    expect(s.remaining).toBe(target - value);
    expect(s.progress).toBeCloseTo((value - start) / (target - start), 12);
  });

  it("documented examples: 1642 ⇒ 58 to Grand Master; 1742 ⇒ 58 to Ultimate Master", () => {
    expect(progressOf(mr(1642)).remaining).toBe(58);
    expect(progressOf(mr(1742)).remaining).toBe(58);
  });

  it("below 1500 is still Master: 1500 is a presentation floor, never a cutoff", () => {
    expect(MASTER_MR_DISPLAY_FLOOR).toBe(1500);
    for (const value of [1499, 1420, 1001]) {
      const s = progressOf(mr(value));
      expect(s.current.label).toBe("Master");
      expect(s.progress).toBe(0); // starts at the current value: never "below Master"
      expect(s.start.value).toBe(value);
      expect(s.remaining).toBe(1600 - value);
    }
  });

  it.each([1800, 1801, 2134, 2195, 2196, 2241, 3000])(
    "%d MR ⇒ Ultimate Master, terminal (no Legend inference, no progress to Legend)",
    (value) => {
      expect(mr(value)).toEqual({
        kind: "ultimate-master",
        system: "mr",
        current: { value, label: "Ultimate Master" },
      });
    },
  );

  it("2196 MR (a past rank-500 snapshot) is NOT Legend without an authoritative position", () => {
    const s = mr(2196);
    expect(s.kind).toBe("ultimate-master");
    expect(JSON.stringify(s)).not.toMatch(/legend/i);
  });

  it("MR 0 / negative / NaN is Capcom's 'no MR yet' ⇒ no rating", () => {
    for (const value of [0, -3, Number.NaN]) expect(mr(value)).toEqual({ kind: "no-rating" });
  });

  it("a stored 'master' goal on an MR character normalizes to next tier (never crashes)", () => {
    expect(mr(1642, "master")).toEqual(mr(1642, "auto"));
  });
});

describe("goals", () => {
  it("only valid goals per system", () => {
    expect(goalsForSystem("lp")).toEqual(["auto", "master"]);
    expect(goalsForSystem("mr")).toEqual(["auto"]);
  });
  it("normalization is deterministic", () => {
    expect(effectiveRankGoal("lp", "auto")).toBe("next-division");
    expect(effectiveRankGoal("lp", "master")).toBe("master");
    expect(effectiveRankGoal("mr", "auto")).toBe("next-master-tier");
    expect(effectiveRankGoal("mr", "master")).toBe("next-master-tier");
  });
});

describe("clamping", () => {
  it("never negative, never above 1, NaN ⇒ 0", () => {
    expect(clampProgress(-0.2)).toBe(0);
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(clampProgress(0.25)).toBe(0.25);
  });
  it("every progress state over a sweep of values stays within [0, 1) with remaining > 0", () => {
    for (let v = 0; v < MASTER_LP; v += 37) {
      for (const goal of ["auto", "master"] as const) {
        const s = progressOf(lp(v, goal));
        expect(s.progress).toBeGreaterThanOrEqual(0);
        expect(s.progress).toBeLessThan(1);
        expect(s.remaining).toBeGreaterThan(0);
        expect(s.start.value).toBeLessThanOrEqual(v);
        expect(s.target.value).toBeGreaterThan(v);
      }
    }
    for (let v = 1; v < 1800; v += 7) {
      const s = progressOf(mr(v));
      expect(s.progress).toBeGreaterThanOrEqual(0);
      expect(s.progress).toBeLessThan(1);
      expect(s.remaining).toBeGreaterThan(0);
    }
  });
});
