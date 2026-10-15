import { describe, expect, it } from "vitest";
import type { MatchResult } from "@/domain/sf6/types";
import { computeAnalytics } from "./aggregate";
import {
  MATCHUP_CALLOUT_MIN_DECIDED,
  computeMatchupHighlights,
  computeMatchups,
  computeOpponentPerformance,
  type MatchupPerformance,
} from "./matchups";
import { computeRecord, type AnalyticsMatchRow } from "./record";

const T0 = Date.parse("2026-10-14T18:00:00.000Z");
let seq = 0;
/** own/opponent as "key" or "key:Name"; results as a W/L/D string. */
function games(own: string, opp: string | null, results: string): AnalyticsMatchRow[] {
  const [ownKey, ownName = ownKey] = own.split(":") as [string, string?];
  const [oppKey, oppName = oppKey] =
    opp === null ? [null, null] : (opp.split(":") as [string, string?]);
  return [...results].map((c) => {
    seq++;
    return {
      externalMatchId: `x${String(seq).padStart(5, "0")}`,
      playedAt: new Date(T0 + seq * 60_000),
      result: (c === "W" ? "win" : c === "L" ? "loss" : "draw") as MatchResult,
      mode: "ranked",
      characterKey: ownKey,
      characterName: ownName ?? ownKey,
      sessionId: "s1",
      opponentCharacterKey: oppKey,
      opponentCharacterName: oppName ?? null,
    };
  });
}
const section = (rows: AnalyticsMatchRow[], character: string | null = null) =>
  computeAnalytics(rows, { character }).matchups;
const pair = (m: MatchupPerformance | null) => (m ? `${m.characterKey}>${m.opponentKey}` : null);

function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe("matchup aggregation (own × opponent)", () => {
  it("1. one matchup", () => {
    const m = computeMatchups(games("aki:A.K.I.", "ken:Ken", "WWL"));
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      characterKey: "aki",
      characterName: "A.K.I.",
      opponentKey: "ken",
      opponentName: "Ken",
      share: 100,
    });
    expect(m[0]?.record).toMatchObject({ wins: 2, losses: 1, decided: 3 });
  });

  it("2. multiple opponents, sorted by matches; 8. opponent frequency (share)", () => {
    const rows = [
      ...games("aki", "ken", "WLWL"),
      ...games("aki", "jp", "WW"),
      ...games("aki", "guile", "L"),
    ];
    const opp = computeOpponentPerformance(rows);
    expect(opp.map((o) => [o.opponentKey, o.record.matches])).toEqual([
      ["ken", 4],
      ["jp", 2],
      ["guile", 1],
    ]);
    expect(opp.map((o) => Math.round(o.share * 10) / 10)).toEqual([57.1, 28.6, 14.3]);
  });

  it("3. same opponent with different own characters = different matchups", () => {
    const rows = [...games("aki", "ken", "WWW"), ...games("juri", "ken", "LL")];
    const m = computeMatchups(rows);
    expect(m.map((x) => [pair(x), x.record.wins, x.record.losses])).toEqual([
      ["aki>ken", 3, 0],
      ["juri>ken", 0, 2],
    ]);
    // …while the opponent summary aggregates across own characters (descriptive frequency).
    expect(computeOpponentPerformance(rows)[0]?.record).toMatchObject({ wins: 3, losses: 2 });
  });

  it("4. the own-character filter narrows the whole dataset (summary, recent, sessions, matchups)", () => {
    const rows = [...games("aki", "ken", "WWW"), ...games("juri", "ken", "LL")];
    const a = computeAnalytics(rows, { character: "juri" });
    expect(a.character).toBe("juri");
    expect(a.overall).toMatchObject({ matches: 2, wins: 0, losses: 2 });
    expect(a.recent[0]?.results).toEqual(["loss", "loss"]);
    expect(a.sessions.sessionMatches).toBe(2);
    expect(a.matchups.opponents[0]?.record).toMatchObject({ wins: 0, losses: 2 });
    expect(a.matchups.matchups.map(pair)).toEqual(["juri>ken"]);
    // The character overview stays cross-character (navigator), unaffected by the filter.
    expect(a.characters.map((c) => c.characterKey)).toEqual(["aki", "juri"]);
  });

  it("5. mirror matches are matchups", () => {
    const m = computeMatchups(games("ryu", "ryu", "WLW"));
    expect(m.map(pair)).toEqual(["ryu>ryu"]);
  });

  it("6. draws excluded from WR; 7. draw-only matchup ⇒ WR null", () => {
    const m = computeMatchups([...games("aki", "ken", "WLDD"), ...games("aki", "jp", "DD")]);
    const ken = m.find((x) => x.opponentKey === "ken");
    const jp = m.find((x) => x.opponentKey === "jp");
    expect(ken?.record).toMatchObject({ draws: 2, decided: 2, winRate: 50 });
    expect(jp?.record).toMatchObject({ draws: 2, decided: 0, winRate: null, sample: "none" });
  });

  it("9. grouped by KEYS, not names; 10. the most recent display name wins", () => {
    const rows = [
      ...games("aki:AKI (old)", "ken:Ken (old)", "W"),
      ...games("aki:A.K.I.", "ken:Ken", "L"),
      // Same display name, different key: never merged.
      ...games("ken-alt:Ken", "ken:Ken", "W"),
    ];
    const m = computeMatchups(rows);
    const aki = m.find((x) => x.characterKey === "aki");
    expect(aki).toMatchObject({ characterName: "A.K.I.", opponentName: "Ken" });
    expect(aki?.record.matches).toBe(2);
    expect(m.map(pair).sort()).toEqual(["aki>ken", "ken-alt>ken"]);
    expect(computeOpponentPerformance(rows)).toHaveLength(1);
  });

  it("11. sample bands are the shared ones", () => {
    const m = computeMatchups(games("aki", "ken", "WWWWW"));
    expect(m[0]?.record.sample).toBe(computeRecord(["win", "win", "win", "win", "win"]).sample);
    expect(m[0]?.record.sample).toBe("small");
  });

  it("19. rows without a usable opponent character are excluded and counted, never invented", () => {
    const rows = [
      ...games("aki", "ken", "WL"),
      ...games("aki", null, "WWW"),
      ...games("aki", ":", "L"), // empty key
    ];
    const s = section(rows);
    expect(s.considered).toBe(2);
    expect(s.unavailable).toBe(4);
    expect(s.opponents.map((o) => o.opponentKey)).toEqual(["ken"]);
    expect(s.opponents[0]?.share).toBe(100);
    // They still count in the overall record (it is about results, not matchups).
    expect(computeAnalytics(rows).overall.matches).toBe(6);
  });

  it("a known key without a display name falls back to the key (no fake character)", () => {
    const rows = games("aki", "ken", "W").map((r) => ({ ...r, opponentCharacterName: null }));
    expect(computeOpponentPerformance(rows)[0]?.opponentName).toBe("ken");
  });
});

describe("highlights (≥ 10 decided matches, descriptive)", () => {
  it("12. 9 decided ⇒ not eligible; 13. exactly 10 decided ⇒ eligible", () => {
    expect(MATCHUP_CALLOUT_MIN_DECIDED).toBe(10);
    const nine = computeMatchups(games("aki", "ken", "WWWWWWWWWDD")); // 9 decided + 2 draws
    expect(computeMatchupHighlights(nine)).toEqual({ strongest: null, weakest: null, eligible: 0 });
    const ten = computeMatchups(games("aki", "ken", "WWWWWWWWWL"));
    expect(computeMatchupHighlights(ten).eligible).toBe(1);
  });

  it("14. strongest = highest WR; 15. weakest = lowest WR (eligible pairs only)", () => {
    const rows = [
      ...games("aki", "ken", "WWWWWWWLLL"), // 70 %
      ...games("aki", "guile", "WWWLLLLLLL"), // 30 %
      ...games("juri", "jp", "WWWWWWWWWW"), // 100 %
      ...games("juri", "dee-jay", "LLL"), // 0 % but only 3 decided → ineligible
    ];
    const h = section(rows).highlights;
    expect(h.eligible).toBe(3);
    expect(pair(h.strongest)).toBe("juri>jp");
    expect(pair(h.weakest)).toBe("aki>guile");
  });

  it("16. deterministic ties: larger decided sample, then more matches, then key order", () => {
    const tieDecided = [
      ...games("aki", "ken", "WWWWWLLLLL"), // 50 %, 10 decided
      ...games("aki", "jp", "WWWWWWLLLLLL"), // 50 %, 12 decided
    ];
    expect(pair(section(tieDecided).highlights.strongest)).toBe("aki>jp");
    expect(pair(section(tieDecided).highlights.weakest)).toBe("aki>jp");
    const tieMatches = [
      ...games("aki", "ken", "WWWWWLLLLL"), // 10 decided, 10 matches
      ...games("aki", "jp", "WWWWWLLLLLD"), // 10 decided, 11 matches
    ];
    expect(pair(section(tieMatches).highlights.strongest)).toBe("aki>jp");
    const tieAll = [
      ...games("aki", "zangief", "WWWWWLLLLL"),
      ...games("aki", "blanka", "WWWWWLLLLL"),
    ];
    const h = section(tieAll).highlights;
    expect(pair(h.strongest)).toBe("aki>blanka");
    expect(pair(h.weakest)).toBe("aki>blanka");
    // Input order never matters.
    expect(pair(section([...tieAll].reverse()).highlights.strongest)).toBe("aki>blanka");
  });

  it("17. all matchups below the threshold ⇒ no highlight", () => {
    const rows = [...games("aki", "ken", "WWWWW"), ...games("aki", "jp", "LLLL")];
    expect(section(rows).highlights).toEqual({ strongest: null, weakest: null, eligible: 0 });
  });

  it("18. one eligible matchup ⇒ strongest only (one pair is not 'the weakest' of anything)", () => {
    const rows = [...games("aki", "ken", "WWWWWWWLLL"), ...games("aki", "jp", "LL")];
    const h = section(rows).highlights;
    expect(h).toMatchObject({ eligible: 1, weakest: null });
    expect(pair(h.strongest)).toBe("aki>ken");
  });

  it("draw-heavy pairs are judged on decided matches only", () => {
    const rows = games("aki", "ken", "WWWWWWWWWDDDDD"); // 9 decided
    expect(section(rows).highlights.eligible).toBe(0);
  });
});

describe("20. no NaN / Infinity anywhere", () => {
  it.each([
    [[] as AnalyticsMatchRow[]],
    [games("aki", null, "WLD")],
    [games("aki", "ken", "DDD")],
    [games("ryu", "ryu", "W")],
  ])("dataset %#", (rows) => {
    assertFinite(computeAnalytics(rows));
    assertFinite(computeAnalytics(rows, { character: "aki" }));
  });

  it("a filter on a character without matches ⇒ empty, finite dataset", () => {
    const a = computeAnalytics(games("aki", "ken", "WL"), { character: "juri" });
    expect(a.overall.matches).toBe(0);
    expect(a.matchups).toMatchObject({
      considered: 0,
      unavailable: 0,
      opponents: [],
      matchups: [],
    });
    assertFinite(a);
  });
});
