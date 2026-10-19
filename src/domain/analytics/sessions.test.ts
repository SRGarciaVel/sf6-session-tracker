import { describe, expect, it } from "vitest";
import { SESSION_IDLE_TIMEOUT_MS } from "@/domain/session/lifecycle";
import type { MatchResult } from "@/domain/sf6/types";
import { computeAnalytics } from "./aggregate";
import type { AnalyticsMatchRow } from "./record";
import {
  MATCH_POSITION_CAP,
  SESSION_ANALYTICS_GAP_MS,
  computeMatchPositionPerformance,
  computeRecoveryAfterLoss,
  computeSessionAnalytics,
  computeSessionDurationStats,
  computeSessionHalves,
  computeSessionStreaks,
  median,
  segmentSessionMatchRows,
  segmentSessionMatches,
  sessionAnalyticsOfSegments,
  type AnalyticsSessionSegment,
} from "./sessions";
import { computeRecord } from "./record";

const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const MIN = 60_000;
let seq = 0;

/** One match at `minute` (relative to T0) in session `sessionId`. */
function m(
  result: MatchResult | "W" | "L" | "D",
  minute: number,
  over: Partial<AnalyticsMatchRow> = {},
): AnalyticsMatchRow {
  seq++;
  const r: MatchResult =
    result === "W" ? "win" : result === "L" ? "loss" : result === "D" ? "draw" : result;
  return {
    externalMatchId: `m${String(seq).padStart(5, "0")}`,
    playedAt: new Date(T0 + minute * MIN),
    result: r,
    mode: "ranked",
    characterKey: "aki",
    characterName: "A.K.I.",
    sessionId: "s1",
    opponentCharacterKey: "ken",
    opponentCharacterName: "Ken",
    ...over,
  };
}
/** Results played every 4 minutes from `start` in one session. */
const run = (results: string, start = 0, sessionId = "s1") =>
  [...results].map((c, i) => m(c as "W" | "L" | "D", start + i * 4, { sessionId }));

function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe("segmentation (session_id + analytics-only ≥ 45 min split)", () => {
  it("the threshold is the session idle timeout (same constant, same boundary)", () => {
    expect(SESSION_ANALYTICS_GAP_MS).toBe(SESSION_IDLE_TIMEOUT_MS);
    expect(SESSION_ANALYTICS_GAP_MS).toBe(45 * MIN);
  });

  it("1. no rows; 2. one session", () => {
    expect(segmentSessionMatches([])).toEqual([]);
    const segs = segmentSessionMatches(run("WLW"));
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ sessionId: "s1", segmentIndex: 0, matchCount: 3 });
    expect(segs[0]?.results).toEqual(["win", "loss", "win"]);
  });

  it("3. two DB sessions stay separate even when close in time", () => {
    const segs = segmentSessionMatches([...run("WW", 0, "a"), ...run("LL", 9, "b")]);
    expect(segs.map((s) => [s.sessionId, s.matchCount])).toEqual([
      ["a", 2],
      ["b", 2],
    ]);
  });

  it("4. a gap of exactly 45:00 splits (the lifecycle closes at ≥ 45 min); 5. 44:59.999 does not", () => {
    const exact = segmentSessionMatches([m("W", 0), m("W", 45)]);
    expect(exact.map((s) => s.segmentIndex)).toEqual([0, 1]);
    const justBelow = segmentSessionMatches([
      m("W", 0),
      { ...m("W", 0), playedAt: new Date(T0 + 45 * MIN - 1) },
    ]);
    expect(justBelow).toHaveLength(1);
    const above = segmentSessionMatches([
      m("W", 0),
      { ...m("W", 0), playedAt: new Date(T0 + 45 * MIN + 1) },
    ]);
    expect(above).toHaveLength(2);
  });

  it("6. multiple splits keep the real session id and number the segments", () => {
    const rows = [m("W", 0), m("W", 4), m("W", 8), m("L", 180), m("L", 183), m("D", 600)];
    const segs = segmentSessionMatches(rows);
    expect(segs.map((s) => [s.sessionId, s.segmentIndex, s.matchCount])).toEqual([
      ["s1", 0, 3],
      ["s1", 1, 2],
      ["s1", 2, 1],
    ]);
    expect(segs[0]?.firstPlayedAt).toEqual(new Date(T0));
    expect(segs[0]?.lastPlayedAt).toEqual(new Date(T0 + 8 * MIN));
  });

  it("7. session_id NULL is excluded (no heuristic attachment)", () => {
    const segs = segmentSessionMatches([m("W", 0), m("L", 2, { sessionId: null }), m("W", 4)]);
    expect(segs).toHaveLength(1);
    expect(segs[0]?.results).toEqual(["win", "win"]);
  });

  it("8. deterministic ordering for any input order (ties by external id)", () => {
    const a = m("W", 5, { externalMatchId: "b" });
    const b = m("L", 5, { externalMatchId: "a" });
    const c = m("D", 1);
    for (const input of [
      [a, b, c],
      [c, b, a],
      [b, c, a],
    ]) {
      expect(segmentSessionMatches(input)[0]?.results).toEqual(["draw", "loss", "win"]);
    }
  });

  it("9. character-filtered gaps: excluded matches never bridge a sequence", () => {
    const rows = [
      m("W", 0),
      m("L", 30, { characterKey: "juri", characterName: "Juri" }),
      m("W", 60),
    ];
    // All characters: gaps of 30 min → one segment.
    expect(computeAnalytics(rows).sessionPerformance.segments).toBe(1);
    // A.K.I. only: 0 → 60 min → split.
    const aki = computeAnalytics(rows, { character: "aki" }).sessionPerformance;
    expect(aki).toMatchObject({ segments: 2, sessions: 1, splitSessions: 1, matches: 2 });
    // …while a close other-character match never matters either.
    const close = [m("W", 0), m("L", 5, { characterKey: "juri" }), m("W", 10)];
    expect(computeAnalytics(close, { character: "aki" }).sessionPerformance.segments).toBe(1);
  });

  it("10. mirror / mode / opponent fields are irrelevant to segmentation", () => {
    const rows = [
      m("W", 0, { opponentCharacterKey: "aki" }),
      m("L", 4, { mode: "unknown", opponentCharacterKey: null }),
      m("W", 8, { opponentCharacterKey: "jp" }),
    ];
    expect(segmentSessionMatches(rows)).toHaveLength(1);
  });
});

describe("gameplay duration", () => {
  it("11. one match → 0 (never estimated); 12. first → last qualifying match", () => {
    expect(segmentSessionMatches([m("W", 0)])[0]?.gameplayDurationMs).toBe(0);
    expect(segmentSessionMatches([m("W", 0), m("L", 5)])[0]?.gameplayDurationMs).toBe(5 * MIN);
  });

  it("13. median odd; 14. median even (mean of the middle two, unrounded)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, 2])).toBe(1.5);
    expect(median([])).toBeNull();
  });

  it("duration aggregates: median + average over segments; pace = Σ matches / Σ hours (measurable only)", () => {
    const rows = [
      ...run("WWWW", 0, "a"), // 4 matches, 12 min
      ...run("LL", 100, "b"), // 2 matches, 4 min
      m("W", 300, { sessionId: "c" }), // 1 match, 0 min (not measurable)
    ];
    const d = computeSessionDurationStats(segmentSessionMatches(rows));
    expect(d.medianMs).toBe(4 * MIN);
    expect(d.averageMs).toBeCloseTo((12 * MIN + 4 * MIN) / 3, 6);
    expect(d.measurableSegments).toBe(2);
    expect(d.matchesPerHour).toBeCloseTo(6 / (16 / 60), 9); // 22.5 / h
  });

  it("15. no Infinity: only one-match segments → pace null", () => {
    const d = computeSessionDurationStats(
      segmentSessionMatches([m("W", 0, { sessionId: "a" }), m("W", 100, { sessionId: "b" })]),
    );
    expect(d).toMatchObject({ medianMs: 0, measurableSegments: 0, matchesPerHour: null });
    // Two matches at the same instant: duration 0 → not measurable either.
    const same = computeSessionDurationStats(segmentSessionMatches([m("W", 0), m("L", 0)]));
    expect(same.matchesPerHour).toBeNull();
  });
});

describe("streaks (within segments; a draw breaks both)", () => {
  const streaks = (rows: AnalyticsMatchRow[]) => computeSessionStreaks(segmentSessionMatches(rows));

  it("16. W W W → 3; 17. L L → 2; none → 0", () => {
    expect(streaks(run("WWW"))).toEqual({ longestWin: 3, longestLoss: 0 });
    expect(streaks(run("LL"))).toEqual({ longestWin: 0, longestLoss: 2 });
    expect(streaks(run("DD"))).toEqual({ longestWin: 0, longestLoss: 0 });
  });

  it("18. a draw breaks the streak (W W D W → 2; L L D L L L → 3)", () => {
    expect(streaks(run("WWDW")).longestWin).toBe(2);
    expect(streaks(run("LLDLLL")).longestLoss).toBe(3);
  });

  it("19. a session boundary breaks the streak; 20. so does a virtual split", () => {
    expect(streaks([...run("WW", 0, "a"), ...run("WW", 9, "b")]).longestWin).toBe(2);
    expect(streaks([...run("WW", 0), ...run("WWW", 60)]).longestWin).toBe(3);
    expect(streaks([...run("LL", 0), ...run("LL", 60)]).longestLoss).toBe(2);
  });
});

describe("win in the next match after a loss", () => {
  const rec = (rows: AnalyticsMatchRow[]) => computeRecoveryAfterLoss(segmentSessionMatches(rows));

  it("21. L W → recovered; 22. L L → not; 23. L D → not", () => {
    expect(rec(run("LW"))).toEqual({ lossesWithNextMatch: 1, recoveredWithWin: 1, rate: 100 });
    expect(rec(run("LLW"))).toMatchObject({
      lossesWithNextMatch: 2,
      recoveredWithWin: 1,
      rate: 50,
    });
    expect(rec(run("LD"))).toEqual({ lossesWithNextMatch: 1, recoveredWithWin: 0, rate: 0 });
  });

  it("24. a segment-final loss is not in the denominator; 25. no losses → null", () => {
    expect(rec(run("WWL"))).toEqual({ lossesWithNextMatch: 0, recoveredWithWin: 0, rate: null });
    expect(rec(run("LWL"))).toMatchObject({ lossesWithNextMatch: 1, recoveredWithWin: 1 });
    expect(rec(run("WWW")).rate).toBeNull();
  });

  it("26. never looks across a split or a session boundary", () => {
    expect(rec([...run("WL", 0), ...run("W", 60)]).lossesWithNextMatch).toBe(0);
    expect(rec([...run("WL", 0, "a"), ...run("W", 9, "b")]).lossesWithNextMatch).toBe(0);
  });
});

describe("first vs second half (by match count)", () => {
  const halves = (rows: AnalyticsMatchRow[]) => computeSessionHalves(segmentSessionMatches(rows));

  it("27. 4 → 2 + 2; 28. 5 → 3 + 2; 29. 7 → 4 + 3 (the first half takes the middle match)", () => {
    expect(halves(run("WWLL"))).toMatchObject({
      eligibleSegments: 1,
      first: { matches: 2, wins: 2 },
      second: { matches: 2, losses: 2 },
    });
    expect(halves(run("WWWLL"))).toMatchObject({
      first: { matches: 3, wins: 3 },
      second: { matches: 2 },
    });
    expect(halves(run("WWWWLLL"))).toMatchObject({ first: { matches: 4 }, second: { matches: 3 } });
  });

  it("30. segments under 4 matches are excluded; none eligible → empty records", () => {
    const h = halves(run("WWL"));
    expect(h.eligibleSegments).toBe(0);
    expect(h.first).toMatchObject({ matches: 0, winRate: null });
    expect(h.second).toMatchObject({ matches: 0, winRate: null });
  });

  it("31. aggregated across eligible segments; 32. draws excluded from WR", () => {
    const rows = [...run("WWLL", 0, "a"), ...run("WDLD", 100, "b"), ...run("LL", 300, "c")];
    const h = halves(rows);
    expect(h.eligibleSegments).toBe(2);
    expect(h.first).toMatchObject({ matches: 4, wins: 3, losses: 0, draws: 1, winRate: 100 });
    expect(h.second).toMatchObject({ matches: 4, wins: 0, losses: 3, draws: 1, winRate: 0 });
  });
});

describe("performance by match position", () => {
  it("33. position 1 spans all segments; 34. later samples shrink; 37. WR and sample band", () => {
    const rows = [...run("WLW", 0, "a"), ...run("LW", 100, "b"), ...run("W", 200, "c")];
    const p = computeMatchPositionPerformance(segmentSessionMatches(rows));
    expect(p.map((x) => [x.position, x.record.matches, x.record.wins])).toEqual([
      [1, 3, 2],
      [2, 2, 1],
      [3, 1, 1],
    ]);
    expect(p[0]?.record.winRate).toBeCloseTo(66.667, 2);
    expect(p[0]?.record.sample).toBe("very-small");
  });

  it("35. positions restart in every segment (virtual split included)", () => {
    const p = computeMatchPositionPerformance(
      segmentSessionMatches([...run("WW", 0), ...run("L", 60)]),
    );
    expect(p.map((x) => [x.position, x.record.matches])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(p[0]?.record).toMatchObject({ wins: 1, losses: 1 });
  });

  it("36. capped at position 10", () => {
    expect(MATCH_POSITION_CAP).toBe(10);
    const p = computeMatchPositionPerformance(segmentSessionMatches(run("W".repeat(14))));
    expect(p.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("filters and membership (through computeAnalytics)", () => {
  it("38. session_id NULL never participates, but still counts in the overall record", () => {
    const rows = [...run("WW"), m("L", 20, { sessionId: null }), m("L", 21, { sessionId: null })];
    const a = computeAnalytics(rows);
    expect(a.overall.matches).toBe(4);
    expect(a.sessionPerformance).toMatchObject({ segments: 1, matches: 2 });
    expect(a.sessionPerformance.recovery.lossesWithNextMatch).toBe(0);
  });

  it("39. only the selected character's matches; 40. only the rows provided (range already applied)", () => {
    const rows = [
      ...run("WWW"),
      m("L", 13, { characterKey: "juri" }),
      m("L", 14, { characterKey: "juri" }),
    ];
    expect(computeAnalytics(rows, { character: "juri" }).sessionPerformance).toMatchObject({
      matches: 2,
      streaks: { longestWin: 0, longestLoss: 2 },
    });
    // A session that starts before the range: only the visible matches exist here.
    const visible = run("LW", 100);
    expect(computeSessionAnalytics(visible)).toMatchObject({
      matches: 2,
      duration: { medianMs: 4 * MIN },
    });
  });

  it("41. matches of an ACTIVE session are ordinary input (no ended_at needed)", () => {
    const s = computeSessionAnalytics(run("WLW", 0, "active-session"));
    expect(s).toMatchObject({ segments: 1, sessions: 1, matches: 3 });
  });

  it("no session matches at all → zero segments, every rate null", () => {
    const s = computeSessionAnalytics([m("W", 0, { sessionId: null })]);
    expect(s).toMatchObject({
      segments: 0,
      sessions: 0,
      matches: 0,
      medianMatchesPerSegment: null,
      duration: { medianMs: null, averageMs: null, matchesPerHour: null },
      recovery: { rate: null },
      positions: [],
    });
  });
});

describe("42. no NaN / Infinity anywhere", () => {
  it.each(["", "W", "D", "DDD", "LWLWDL", "WWWWWWWWWWWWWW"])("results %j", (results) => {
    assertFinite(computeSessionAnalytics(run(results)));
    assertFinite(computeSessionAnalytics([...run(results), ...run(results, 500)]));
  });
});

/**
 * Phase 6.4C refactor guard: the row-aware segmentation must project to EXACTLY what the previous
 * implementation produced. The pre-refactor algorithm is kept here verbatim as the oracle.
 */
function legacySegmentSessionMatches(
  rows: readonly AnalyticsMatchRow[],
  gapMs: number = SESSION_ANALYTICS_GAP_MS,
): AnalyticsSessionSegment[] {
  const playOrder = (a: AnalyticsMatchRow, b: AnalyticsMatchRow) =>
    a.playedAt.getTime() - b.playedAt.getTime() ||
    (a.externalMatchId < b.externalMatchId ? -1 : a.externalMatchId > b.externalMatchId ? 1 : 0);
  const toSegment = (sessionId: string, segmentIndex: number, list: AnalyticsMatchRow[]) => {
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const results = list.map((r) => r.result);
    return {
      sessionId,
      segmentIndex,
      results,
      record: computeRecord(results),
      matchCount: list.length,
      firstPlayedAt: first.playedAt,
      lastPlayedAt: last.playedAt,
      gameplayDurationMs: last.playedAt.getTime() - first.playedAt.getTime(),
    };
  };
  const bySession = new Map<string, AnalyticsMatchRow[]>();
  for (const r of rows) {
    if (r.sessionId === null) continue;
    const list = bySession.get(r.sessionId);
    if (list) list.push(r);
    else bySession.set(r.sessionId, [r]);
  }
  const segments: AnalyticsSessionSegment[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort(playOrder);
    let current: AnalyticsMatchRow[] = [];
    let index = 0;
    for (const r of list) {
      const prev = current[current.length - 1];
      if (prev && r.playedAt.getTime() - prev.playedAt.getTime() >= gapMs) {
        segments.push(toSegment(sessionId, index++, current));
        current = [];
      }
      current.push(r);
    }
    if (current.length > 0) segments.push(toSegment(sessionId, index, current));
  }
  return segments.sort(
    (a, b) =>
      a.firstPlayedAt.getTime() - b.firstPlayedAt.getTime() ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0) ||
      a.segmentIndex - b.segmentIndex,
  );
}

describe("row-aware segmentation ≡ previous aggregate segmentation (Phase 6.4C refactor)", () => {
  /** Deterministic pseudo-random datasets: sessions, NULL history, gaps around 45 min, ties. */
  function dataset(seed: number): AnalyticsMatchRow[] {
    let x = seed;
    const rand = () => {
      x = (x * 1103515245 + 12345) % 2_147_483_648;
      return x / 2_147_483_648;
    };
    const rows: AnalyticsMatchRow[] = [];
    const gaps = [0, 4, 4, 30, 44, 45, 46, 120];
    for (let s = 0; s < 6; s++) {
      let minute = s * 10_000;
      const n = 1 + Math.floor(rand() * 14);
      for (let i = 0; i < n; i++) {
        minute += gaps[Math.floor(rand() * gaps.length)]!;
        const r = rand();
        rows.push(
          m(r < 0.45 ? "W" : r < 0.9 ? "L" : "D", minute, {
            sessionId: rand() < 0.15 ? null : `s${s % 4}`,
          }),
        );
      }
    }
    return rows;
  }

  it("same segments (order, split, results, counts, timestamps, duration) for many datasets", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rows = dataset(seed);
      for (const input of [rows, [...rows].reverse()]) {
        expect(segmentSessionMatches(input)).toEqual(legacySegmentSessionMatches(input));
      }
    }
  });

  it("same session analytics (streaks, recovery, halves, positions, duration) for many datasets", () => {
    for (let seed = 41; seed <= 70; seed++) {
      const rows = dataset(seed);
      expect(sessionAnalyticsOfSegments(segmentSessionMatches(rows))).toEqual(
        sessionAnalyticsOfSegments(legacySegmentSessionMatches(rows)),
      );
      expect(computeSessionAnalytics(rows)).toEqual(
        sessionAnalyticsOfSegments(legacySegmentSessionMatches(rows)),
      );
    }
  });

  it("row-aware segments keep the original rows in play order, NULL excluded", () => {
    const rows = dataset(99);
    const withRows = segmentSessionMatchRows(rows);
    const aggregate = legacySegmentSessionMatches(rows);
    expect(withRows.map((s) => s.rows.map((r) => r.result))).toEqual(
      aggregate.map((s) => s.results),
    );
    for (const seg of withRows) {
      expect(seg.rows.every((r) => r.sessionId === seg.sessionId)).toBe(true);
    }
    expect(withRows.flatMap((s) => s.rows).length).toBe(
      rows.filter((r) => r.sessionId !== null).length,
    );
  });
});
