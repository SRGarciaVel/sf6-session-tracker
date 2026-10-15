import { describe, expect, it } from "vitest";
import type { MatchResult } from "@/domain/sf6/types";
import {
  DEFAULT_ANALYTICS_MODE,
  DEFAULT_ANALYTICS_RANGE,
  computeAnalytics,
  computeRecord,
  parseAnalyticsMode,
  parseAnalyticsRange,
  parseAnalyticsSearchParams,
  rangeStart,
  type AnalyticsMatchRow,
} from "./aggregate";
import { SAMPLE_BANDS, sampleBand } from "./samples";

const T0 = Date.parse("2026-10-14T18:00:00.000Z");
let seq = 0;
function m(
  result: MatchResult,
  over: Partial<Omit<AnalyticsMatchRow, "playedAt">> & { minute?: number } = {},
): AnalyticsMatchRow {
  seq++;
  const { minute, ...rest } = over;
  return {
    externalMatchId: `m${String(seq).padStart(4, "0")}`,
    playedAt: new Date(T0 + (minute ?? seq) * 60_000),
    result,
    mode: "ranked",
    characterKey: "aki",
    characterName: "A.K.I.",
    sessionId: "s1",
    ...rest,
  };
}
const many = (results: string) =>
  [...results].map((c) => m(c === "W" ? "win" : c === "L" ? "loss" : "draw"));

/** Every number in a structure is finite (no NaN / Infinity anywhere). */
function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe("record & win rate", () => {
  it("1. zero matches: everything empty, win rate unavailable (null), no sample", () => {
    const a = computeAnalytics([]);
    expect(a.overall).toEqual({
      wins: 0,
      losses: 0,
      draws: 0,
      matches: 0,
      decided: 0,
      winRate: null,
      sample: "none",
    });
    expect(a.characters).toEqual([]);
    expect(a.recent.map((r) => [r.window, r.available, r.complete])).toEqual([
      [5, 0, false],
      [10, 0, false],
      [20, 0, false],
    ]);
    expect(a.sessions).toEqual({
      sessions: 0,
      sessionMatches: 0,
      averageMatchesPerSession: null,
      outsideSessions: 0,
    });
    expect(a.firstPlayedAt).toBeNull();
    expect(a.lastPlayedAt).toBeNull();
    assertFinite(a);
  });

  it("2. one win → 100 %; 3. one loss → 0 %", () => {
    expect(computeRecord(["win"])).toMatchObject({ wins: 1, decided: 1, winRate: 100 });
    expect(computeRecord(["loss"])).toMatchObject({ losses: 1, decided: 1, winRate: 0 });
  });

  it("4. draw only: counted, but no decided match → win rate null (not 0 %)", () => {
    expect(computeRecord(["draw", "draw"])).toEqual({
      wins: 0,
      losses: 0,
      draws: 2,
      matches: 2,
      decided: 0,
      winRate: null,
      sample: "none",
    });
  });

  it("5. win rate excludes draws from the denominator; 6. mixed W/L/D", () => {
    const r = computeRecord(["win", "win", "loss", "draw", "draw", "draw"]);
    expect(r).toMatchObject({ wins: 2, losses: 1, draws: 3, matches: 6, decided: 3 });
    expect(r.winRate).toBeCloseTo(66.667, 2); // 2 / 3, not 2 / 6
  });
});

describe("recent form (newest first, within the filtered rows)", () => {
  const rows = many("WLWWLDLWWWLLWWWLWLWWLW"); // 22 matches, oldest → newest

  it("7/8/9. last 5, 10 and 20 use the newest matches", () => {
    const [r5, r10, r20] = computeAnalytics(rows).recent;
    expect(r5).toMatchObject({ window: 5, available: 5, complete: true });
    expect(r5?.results).toEqual(["win", "loss", "win", "win", "loss"]); // newest first
    expect(r5?.record).toMatchObject({ wins: 3, losses: 2, draws: 0 });
    expect(r10?.record).toMatchObject({ matches: 10, wins: 7, losses: 3 });
    expect(r20?.record).toMatchObject({ matches: 20, wins: 12, losses: 7, draws: 1 });
  });

  it("10. fewer matches than the window: the available sample, marked incomplete", () => {
    const [r5, r10] = computeAnalytics(many("WLWD")).recent;
    expect(r5).toMatchObject({ window: 5, available: 4, complete: false });
    expect(r5?.record).toMatchObject({ wins: 2, losses: 1, draws: 1, decided: 3 });
    expect(r10).toMatchObject({ available: 4, complete: false });
  });

  it("11. ordering is by played_at (input order irrelevant; ties by id)", () => {
    const old = m("loss", { minute: 1 });
    const mid = m("draw", { minute: 2 });
    const tieA = m("win", { minute: 3, externalMatchId: "aaa" });
    const tieB = m("loss", { minute: 3, externalMatchId: "bbb" });
    const shuffled = [tieA, old, tieB, mid];
    const r = computeAnalytics(shuffled).recent[0];
    expect(r?.results).toEqual(["loss", "win", "draw", "loss"]); // bbb > aaa at the same time
    expect(computeAnalytics([...shuffled].reverse()).recent[0]?.results).toEqual(r?.results);
    expect(computeAnalytics(shuffled).lastPlayedAt?.getTime()).toBe(T0 + 3 * 60_000);
    expect(computeAnalytics(shuffled).firstPlayedAt?.getTime()).toBe(T0 + 60_000);
  });
});

describe("own-character performance", () => {
  const rows = [
    ...["win", "win", "loss", "draw"].map((r) => m(r as MatchResult)),
    ...["loss", "loss", "win"].map((r) =>
      m(r as MatchResult, { characterKey: "juri", characterName: "Juri" }),
    ),
    m("win", { characterKey: "ryu", characterName: "Ryu" }),
  ];

  it("12. grouped by own character, sorted by matches; 13. usage share", () => {
    const chars = computeAnalytics(rows).characters;
    expect(chars.map((c) => [c.characterKey, c.record.matches])).toEqual([
      ["aki", 4],
      ["juri", 3],
      ["ryu", 1],
    ]);
    expect(chars.map((c) => c.usage)).toEqual([50, 37.5, 12.5]);
    expect(chars.reduce((s, c) => s + c.usage, 0)).toBe(100);
  });

  it("14. per-character win rate (draws excluded); 15. per-character draws", () => {
    const [aki, juri] = computeAnalytics(rows).characters;
    expect(aki?.record).toMatchObject({ wins: 2, losses: 1, draws: 1, decided: 3 });
    expect(aki?.record.winRate).toBeCloseTo(66.667, 2);
    expect(juri?.record.winRate).toBeCloseTo(33.333, 2);
    expect(juri?.record.draws).toBe(0);
  });

  it("only the single top character is 'most played'; a tie has none", () => {
    expect(computeAnalytics(rows).characters.map((c) => c.mostPlayed)).toEqual([
      true,
      false,
      false,
    ]);
    const tie = [m("win"), m("loss", { characterKey: "juri", characterName: "Juri" })];
    expect(computeAnalytics(tie).characters.every((c) => !c.mostPlayed)).toBe(true);
  });

  it("one character only → 100 % usage; the latest display name is used", () => {
    const one = [m("win", { characterName: "AKI old" }), m("loss")];
    const [c] = computeAnalytics(one).characters;
    expect(c).toMatchObject({ usage: 100, characterName: "A.K.I.", mostPlayed: true });
  });
});

describe("sample bands (decided matches)", () => {
  it.each([
    [0, "none"],
    [1, "very-small"],
    [4, "very-small"],
    [5, "small"],
    [9, "small"],
    [10, "developing"],
    [29, "developing"],
    [30, "larger"],
    [1000, "larger"],
  ] as const)("16–23. %i → %s", (n, band) => {
    expect(sampleBand(n)).toBe(band);
  });

  it("invalid counts are 'none'; the vocabulary is closed", () => {
    for (const n of [-1, Number.NaN, Number.POSITIVE_INFINITY * -1])
      expect(sampleBand(n)).toBe("none");
    expect(SAMPLE_BANDS).toEqual(["none", "very-small", "small", "developing", "larger"]);
  });

  it("a character's band counts decided matches (draws don't inflate it)", () => {
    const rows = [...many("WWLWL"), ...many("DDDD")];
    expect(computeAnalytics(rows).overall.sample).toBe("small"); // 5 decided of 9
    expect(computeRecord(["win", "draw", "draw", "draw", "draw"]).sample).toBe("very-small");
  });
});

describe("session coverage (match.session_id only)", () => {
  it("24. sessions = distinct session ids with matches; history outside sessions is counted apart", () => {
    const rows = [
      m("win", { sessionId: "a" }),
      m("loss", { sessionId: "a" }),
      m("win", { sessionId: "b" }),
      m("win", { sessionId: null }),
      m("loss", { sessionId: null }),
    ];
    const a = computeAnalytics(rows);
    expect(a.sessions).toEqual({
      sessions: 2,
      sessionMatches: 3,
      averageMatchesPerSession: 1.5,
      outsideSessions: 2,
    });
    // History outside sessions still counts in the overall record.
    expect(a.overall.matches).toBe(5);
  });

  it("a zero-match session cannot appear (it has no rows) → no sessions, average null", () => {
    expect(computeAnalytics([m("win", { sessionId: null })]).sessions).toMatchObject({
      sessions: 0,
      averageMatchesPerSession: null,
    });
  });
});

describe("unknown mode and filters", () => {
  it("counts unknown-mode matches so 'all recorded' can say so", () => {
    const a = computeAnalytics([m("win"), m("loss", { mode: "unknown" })]);
    expect(a.unknownModeMatches).toBe(1);
  });

  it("URL parsing is lenient with safe defaults; ranges are rolling 24 h windows", () => {
    expect(DEFAULT_ANALYTICS_RANGE).toBe("90d");
    expect(DEFAULT_ANALYTICS_MODE).toBe("ranked");
    for (const r of ["7d", "30d", "90d", "all"]) expect(parseAnalyticsRange(r)).toBe(r);
    for (const bad of [undefined, "", "365d", "ALL", 7, null]) {
      expect(parseAnalyticsRange(bad)).toBe("90d");
    }
    expect(parseAnalyticsRange(["30d", "7d"])).toBe("30d");
    expect(parseAnalyticsMode("all")).toBe("all");
    for (const bad of [undefined, "casual", "unknown", "RANKED"]) {
      expect(parseAnalyticsMode(bad)).toBe("ranked");
    }
    const now = new Date(T0);
    expect(rangeStart("7d", now)?.getTime()).toBe(T0 - 7 * 86_400_000);
    expect(rangeStart("90d", now)?.getTime()).toBe(T0 - 90 * 86_400_000);
    expect(rangeStart("all", now)).toBeNull();
  });
});

describe("25. no NaN / Infinity anywhere", () => {
  it.each(["", "D", "DDD", "W", "L", "WLD", "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW"])(
    "results %j",
    (seqStr) => {
      assertFinite(computeAnalytics(many(seqStr)));
    },
  );
});

describe("URL input", () => {
  it("only range and mode are read from search params; ids are ignored", () => {
    const q = parseAnalyticsSearchParams({
      range: "7d",
      mode: "all",
      playerId: "00000000-0000-0000-0000-000000000001",
      userId: "someone-else",
    });
    expect(q).toEqual({ range: "7d", mode: "all" });
    expect(Object.keys(q).sort()).toEqual(["mode", "range"]);
    expect(parseAnalyticsSearchParams({})).toEqual({ range: "90d", mode: "ranked" });
  });
});
