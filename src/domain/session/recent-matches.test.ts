/** Phase 5.6B3 — recentSessionMatches: same dedupe/order as the stats, bounded, capped. */
import { describe, expect, it } from "vitest";
import { computeSessionStats, recentSessionMatches, type SessionMatch } from "./engine";

const T = Date.parse("2026-10-21T19:30:00Z");
const m = (id: string, min: number, result: SessionMatch["result"] = "win"): SessionMatch => ({
  externalMatchId: id,
  playedAt: new Date(T + min * 60_000),
  mode: "ranked",
  result,
  characterKey: "ryu",
  characterName: "Ryu",
  opponentCharacter: null,
  opponentName: null,
});

describe("recentSessionMatches", () => {
  it("chronological, numbered by position in the session, latest last", () => {
    const out = recentSessionMatches([m("c", 18), m("a", 6), m("b", 12, "loss")], 10);
    expect(out.map((x) => [x.match.externalMatchId, x.n])).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
  });
  it("duplicates are ignored exactly like the stats (first occurrence wins)", () => {
    const list = [m("a", 6), m("a", 6, "loss"), m("b", 12)];
    const out = recentSessionMatches(list, 10);
    expect(out).toHaveLength(computeSessionStats(list).totalGames);
    expect(out[0]!.match.result).toBe("win");
  });
  it("bounded: only the latest `limit`, numbering keeps the absolute position", () => {
    const list = Array.from({ length: 14 }, (_, i) => m(`m${i}`, i));
    const out = recentSessionMatches(list, 10);
    expect(out).toHaveLength(10);
    expect(out[0]!.n).toBe(5);
    expect(out.at(-1)!.n).toBe(14);
  });
  it("capped to the counted total (rows read after the summary)", () => {
    const out = recentSessionMatches([m("a", 1), m("b", 2), m("c", 3)], 10, 2);
    expect(out.map((x) => x.match.externalMatchId)).toEqual(["a", "b"]);
    expect(recentSessionMatches([m("a", 1)], 10, 0)).toEqual([]);
  });
  it("same order as the recent form for ties (externalMatchId)", () => {
    const list = [m("b", 5, "loss"), m("a", 5)];
    expect(recentSessionMatches(list, 10).map((x) => x.match.result)).toEqual(
      computeSessionStats(list).recentResults,
    );
  });
});
