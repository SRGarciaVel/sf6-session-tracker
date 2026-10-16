import { describe, expect, it } from "vitest";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import { computeAnalytics } from "./aggregate";
import { computeMatchupSection, type OpponentPerformance } from "./matchups";
import { computeRecord, newestFirst, type AnalyticsMatchRow, type MatchRecord } from "./record";
import {
  REVIEW_CHARACTER_BASELINE_MIN_DECIDED,
  REVIEW_DELTA_THRESHOLD_PP,
  REVIEW_EXPOSURE_MIN_MATCHES,
  REVIEW_EXPOSURE_MIN_SHARE,
  REVIEW_HALVES_MIN_DECIDED,
  REVIEW_HALVES_MIN_SEGMENTS,
  REVIEW_MATCHUP_MIN_DECIDED,
  REVIEW_MAX_PER_TYPE,
  REVIEW_MAX_SIGNALS,
  REVIEW_RECENT_MIN_DECIDED,
  REVIEW_RECENT_WINDOW,
  REVIEW_TRANSITION_MIN_OBSERVATIONS,
  computeNextMatchTransitions,
  highExposureOpponentSignal,
  matchupUnderperformanceSignals,
  postLossTransitionSignal,
  recentFormShiftSignal,
  selectReviewSignals,
  sessionHalfShiftSignal,
  type ReviewSignal,
} from "./review";
import { computeRecoveryAfterLoss, segmentSessionMatches, type SessionHalves } from "./sessions";

const T0 = Date.parse("2026-10-14T12:00:00.000Z");
const MIN = 60_000;
let seq = 0;

function m(result: MatchResult, minute: number, over: Partial<AnalyticsMatchRow> = {}) {
  seq++;
  return {
    externalMatchId: `r${String(seq).padStart(6, "0")}`,
    playedAt: new Date(T0 + minute * MIN),
    result,
    mode: "ranked",
    characterKey: "aki",
    characterName: "A.K.I.",
    sessionId: "s1",
    opponentCharacterKey: "ken",
    opponentCharacterName: "Ken",
    ...over,
  } satisfies AnalyticsMatchRow;
}

const R: Record<string, MatchResult> = { W: "win", L: "loss", D: "draw" };
const results = (spec: string) => [...spec].map((c) => R[c]!);

/** Matches with an own × opponent pair, one every 4 minutes, outside any session by default. */
function pair(
  own: CharacterKey,
  opponent: CharacterKey | null,
  wins: number,
  losses: number,
  draws = 0,
): AnalyticsMatchRow[] {
  const list: MatchResult[] = [
    ...Array<MatchResult>(wins).fill("win"),
    ...Array<MatchResult>(losses).fill("loss"),
    ...Array<MatchResult>(draws).fill("draw"),
  ];
  return list.map((r) =>
    m(r, seq * 4, {
      characterKey: own,
      characterName: own.toUpperCase(),
      opponentCharacterKey: opponent,
      opponentCharacterName: opponent ? opponent.toUpperCase() : null,
      sessionId: null,
    }),
  );
}

const newest = (rows: readonly AnalyticsMatchRow[]) => [...rows].sort(newestFirst);
const matchupSignals = (rows: readonly AnalyticsMatchRow[]) => {
  const sorted = newest(rows);
  return matchupUnderperformanceSignals(sorted, computeMatchupSection(sorted));
};

/** `spec` results played every 4 min from `start` in session `sessionId`. */
const run = (spec: string, start = 0, sessionId: string | null = "s1") =>
  results(spec).map((r, i) => m(r, start + i * 4, { sessionId }));
/** Results in play order (oldest first), one per minute, no session. */
const timeline = (spec: string) =>
  results(spec).map((r, i) => m(r, 10_000 + i, { sessionId: null }));

const rec = (wins: number, losses: number, draws = 0): MatchRecord =>
  computeRecord([
    ...Array<MatchResult>(wins).fill("win"),
    ...Array<MatchResult>(losses).fill("loss"),
    ...Array<MatchResult>(draws).fill("draw"),
  ]);
const halves = (eligibleSegments: number, first: MatchRecord, second: MatchRecord) =>
  ({ eligibleSegments, first, second }) satisfies SessionHalves;

function shuffled<T>(list: readonly T[], seed = 7): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2_147_483_648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe("gates", () => {
  it("are the documented product thresholds", () => {
    expect(REVIEW_MATCHUP_MIN_DECIDED).toBe(10);
    expect(REVIEW_CHARACTER_BASELINE_MIN_DECIDED).toBe(30);
    expect(REVIEW_DELTA_THRESHOLD_PP).toBe(10);
    expect(REVIEW_RECENT_WINDOW).toBe(20);
    expect(REVIEW_RECENT_MIN_DECIDED).toBe(10);
    expect(REVIEW_HALVES_MIN_SEGMENTS).toBe(5);
    expect(REVIEW_HALVES_MIN_DECIDED).toBe(20);
    expect(REVIEW_TRANSITION_MIN_OBSERVATIONS).toBe(10);
    expect(REVIEW_EXPOSURE_MIN_MATCHES).toBe(20);
    expect(REVIEW_EXPOSURE_MIN_SHARE).toBe(10);
    expect(REVIEW_MAX_SIGNALS).toBe(3);
    expect(REVIEW_MAX_PER_TYPE).toBe(2);
  });
});

describe("matchup underperformance (vs the SAME own character)", () => {
  it("1. qualifies at exactly 10 matchup decided and 30 baseline decided", () => {
    const signals = matchupSignals([...pair("aki", "jp", 2, 8), ...pair("aki", "ken", 14, 6)]);
    expect(signals).toHaveLength(1);
    const s = signals[0]!;
    expect(s).toMatchObject({
      id: "matchup:aki:jp",
      type: "matchup-underperformance",
      direction: "down",
      destination: "#matchups",
      characterKey: "aki",
      opponentKey: "jp",
      sample: 10,
    });
    expect(s.matchup).toMatchObject({ wins: 2, losses: 8, decided: 10, winRate: 20 });
    expect(s.baseline).toMatchObject({ wins: 16, losses: 14, decided: 30 });
    expect(s.deltaPp).toBeCloseTo(20 - (16 / 30) * 100, 9);
  });

  it("2. 9 decided in the matchup → no signal (draws do not count)", () => {
    expect(matchupSignals([...pair("aki", "jp", 2, 7, 3), ...pair("aki", "ken", 14, 7)])).toEqual(
      [],
    );
  });

  it("3. a 29-decided baseline → no signal", () => {
    expect(matchupSignals([...pair("aki", "jp", 2, 8), ...pair("aki", "ken", 13, 6)])).toEqual([]);
  });

  it("4. exactly −10 pp qualifies", () => {
    // jp 4–6 = 40 %; A.K.I. 15–15 = 50 %.
    const [s] = matchupSignals([...pair("aki", "jp", 4, 6), ...pair("aki", "ken", 11, 9)]);
    expect(s?.deltaPp).toBeCloseTo(-10, 9);
  });

  it("5. −9.9 pp does not", () => {
    // jp 4–6 = 40 %; A.K.I. 499–501 = 49.9 %.
    const rows = [...pair("aki", "jp", 4, 6), ...pair("aki", "ken", 495, 495)];
    const baseline = computeRecord(rows.map((r) => r.result));
    expect(40 - baseline.winRate!).toBeCloseTo(-9.9, 9);
    expect(matchupSignals(rows)).toEqual([]);
  });

  it("6/7. compares against the same character; other characters never contaminate it", () => {
    // A.K.I. 25–15 (62.5 %), Juri 0–60. Account overall = 25 / 100 = 25 %.
    const rows = [
      ...pair("aki", "jp", 5, 5),
      ...pair("aki", "ken", 20, 10),
      ...pair("juri", "jp", 0, 10),
      ...pair("juri", "ken", 0, 50),
    ];
    const signals = matchupSignals(rows);
    // A.K.I. vs JP: 50 % vs A.K.I. 62.5 % → −12.5 pp. (Against the account it would be +25.)
    // Juri vs JP: 0 % vs Juri 0 % → 0 pp. (Against the account it would be −25.)
    expect(signals.map((s) => s.id)).toEqual(["matchup:aki:jp"]);
    expect(signals[0]!.baseline).toMatchObject({ wins: 25, losses: 15, decided: 40 });
    expect(signals[0]!.deltaPp).toBeCloseTo(-12.5, 9);
  });

  it("8. rows without opponent character never form a pair, but stay in the baseline", () => {
    const rows = [
      ...pair("aki", null, 0, 10),
      ...pair("aki", "ken", 15, 5),
      ...pair("aki", "jp", 3, 7),
    ];
    const signals = matchupSignals(rows);
    expect(signals.map((s) => s.opponentKey)).toEqual(["jp"]);
    expect(signals[0]!.baseline.matches).toBe(40); // 18–22 incl. unknown opponents
    expect(signals[0]!.deltaPp).toBeCloseTo(-15, 9);
    expect(JSON.stringify(signals)).not.toMatch(/unknown/i);
  });

  it("9. ties between matchups are ordered deterministically (id), any input order", () => {
    const rows = [
      ...pair("aki", "jp", 2, 8),
      ...pair("aki", "dee_jay", 2, 8),
      ...pair("aki", "ken", 30, 0),
    ];
    const a = computeAnalytics(rows).review.signals.map((s) => s.id);
    const b = computeAnalytics(shuffled(rows)).review.signals.map((s) => s.id);
    expect(a.slice(0, 2)).toEqual(["matchup:aki:dee_jay", "matchup:aki:jp"]);
    expect(b).toEqual(a);
  });
});

describe("recent form shift (latest 20 vs the previous 20)", () => {
  it("10. the two windows are adjacent and non-overlapping", () => {
    // oldest … newest: 20 losses, then 20 wins.
    const s = recentFormShiftSignal(newest(timeline("L".repeat(20) + "W".repeat(20))));
    expect(s).toMatchObject({
      direction: "up",
      destination: "#recent",
      window: 20,
      deltaPp: expect.closeTo(100, 9),
    });
    expect(s!.recent).toMatchObject({ matches: 20, wins: 20, losses: 0 });
    expect(s!.previous).toMatchObject({ matches: 20, wins: 0, losses: 20 });
  });

  it("10b. never compares against the whole range", () => {
    // 20 older losses, then two 50 % windows: whole-range would be 33 % → +16.7 pp.
    const spec = "L".repeat(20) + "WL".repeat(10) + "LW".repeat(10);
    expect(recentFormShiftSignal(newest(timeline(spec)))).toBeNull();
  });

  it("11. uses the canonical newest-first order (played_at, then external id), not input order", () => {
    const rows = timeline("L".repeat(20) + "W".repeat(20)); // oldest first
    const viaAggregate = computeAnalytics(shuffled(rows)).review.signals.find(
      (s) => s.type === "recent-form-shift",
    );
    expect(viaAggregate).toMatchObject({ direction: "up", deltaPp: expect.closeTo(100, 9) });
    // Same instant: the larger external id is the newer one.
    const tied = [
      m("win", 0, { externalMatchId: "z", sessionId: null }),
      m("loss", 0, { externalMatchId: "a", sessionId: null }),
    ];
    expect(newest(tied).map((r) => r.externalMatchId)).toEqual(["z", "a"]);
  });

  it("12. each window needs ≥ 10 decided", () => {
    // newest window: 9 W + 11 D (9 decided).
    const spec = "WL".repeat(10) + "D".repeat(11) + "W".repeat(9);
    expect(recentFormShiftSignal(newest(timeline(spec)))).toBeNull();
    const ok = "WL".repeat(10) + "D".repeat(10) + "W".repeat(10);
    expect(recentFormShiftSignal(newest(timeline(ok)))).toMatchObject({
      deltaPp: expect.closeTo(50, 9),
    });
  });

  it("13. exactly ±10 pp qualifies, in both directions", () => {
    const prev = "WL".repeat(10); // 50 %
    const up = recentFormShiftSignal(newest(timeline(prev + "W".repeat(12) + "L".repeat(8))));
    expect(up).toMatchObject({ direction: "up", deltaPp: expect.closeTo(10, 9) });
    const down = recentFormShiftSignal(newest(timeline(prev + "W".repeat(8) + "L".repeat(12))));
    expect(down).toMatchObject({ direction: "down", deltaPp: expect.closeTo(-10, 9) });
    const below = recentFormShiftSignal(
      newest(timeline(prev + "W".repeat(11) + "L".repeat(9))), // +5 pp
    );
    expect(below).toBeNull();
  });

  it("14. an insufficient previous window → no signal", () => {
    expect(recentFormShiftSignal(newest(timeline("L".repeat(9) + "W".repeat(20))))).toBeNull();
    expect(recentFormShiftSignal(newest(timeline("W".repeat(20))))).toBeNull();
  });

  it("15. draws stay inside their window but out of the win-rate denominator", () => {
    // previous: 10 W 10 L; recent: 10 D + 10 W (oldest → newest).
    const s = recentFormShiftSignal(
      newest(timeline("WL".repeat(10) + "D".repeat(10) + "W".repeat(10))),
    );
    expect(s!.recent).toMatchObject({ matches: 20, draws: 10, decided: 10, winRate: 100 });
    expect(s!.previous).toMatchObject({ matches: 20, draws: 0, decided: 20, winRate: 50 });
    expect(s!.sample).toBe(10);
  });
});

describe("session half shift (Phase 6.2 halves)", () => {
  it("16. 5 eligible segments + 20 decided per half qualifies", () => {
    const s = sessionHalfShiftSignal(halves(5, rec(12, 8), rec(10, 10)));
    expect(s).toMatchObject({
      id: "session-halves",
      direction: "down",
      destination: "#sessions",
      eligibleSegments: 5,
      deltaPp: expect.closeTo(-10, 9),
      sample: 20,
    });
  });

  it("17. 4 eligible segments → none", () => {
    expect(sessionHalfShiftSignal(halves(4, rec(20, 0), rec(0, 20)))).toBeNull();
  });

  it("18. 19 decided in a half → none (draws do not count)", () => {
    expect(sessionHalfShiftSignal(halves(9, rec(19, 0, 5), rec(0, 20)))).toBeNull();
    expect(sessionHalfShiftSignal(halves(9, rec(20, 0), rec(0, 19, 5)))).toBeNull();
  });

  it("19. exactly ±10 pp qualifies (up when the second half is higher)", () => {
    expect(sessionHalfShiftSignal(halves(5, rec(10, 10), rec(12, 8)))).toMatchObject({
      direction: "up",
      deltaPp: expect.closeTo(10, 9),
    });
    expect(sessionHalfShiftSignal(halves(5, rec(10, 10), rec(11, 9)))).toBeNull();
  });

  it("20. a null win rate → none", () => {
    expect(sessionHalfShiftSignal(halves(5, rec(0, 0, 30), rec(0, 0, 30)))).toBeNull();
  });

  it("reuses the existing halves from computeAnalytics (no redefinition)", () => {
    // 5 sessions of 8: first halves WWWW (20 – 0), second halves WWLL (10 – 10).
    const rows = Array.from({ length: 5 }, (_, i) => run("WWWWWWLL", i * 1000, `s${i}`)).flat();
    const a = computeAnalytics(rows);
    const s = a.review.signals.find((x) => x.type === "session-half-shift");
    expect(s).toMatchObject({
      first: a.sessionPerformance.halves.first,
      deltaPp: expect.closeTo(-50, 9),
    });
  });
});

describe("post-loss vs post-win next-match transitions", () => {
  const tr = (rows: AnalyticsMatchRow[]) =>
    computeNextMatchTransitions(segmentSessionMatches(rows));

  it("21–24. L→W, L→L, W→W, W→L", () => {
    expect(tr(run("LW")).postLoss).toEqual({ total: 1, nextWins: 1, rate: 100 });
    expect(tr(run("LL")).postLoss).toEqual({ total: 1, nextWins: 0, rate: 0 });
    expect(tr(run("WW")).postWin).toEqual({ total: 1, nextWins: 1, rate: 100 });
    expect(tr(run("WL")).postWin).toEqual({ total: 1, nextWins: 0, rate: 0 });
  });

  it("25. a draw as the NEXT match is a non-win", () => {
    expect(tr(run("LD")).postLoss).toEqual({ total: 1, nextWins: 0, rate: 0 });
    expect(tr(run("WD")).postWin).toEqual({ total: 1, nextWins: 0, rate: 0 });
  });

  it("26. a draw as the CURRENT match belongs to neither group", () => {
    const t = tr(run("DWDL"));
    expect(t.postLoss.total).toBe(0);
    expect(t.postWin).toEqual({ total: 1, nextWins: 0, rate: 0 }); // W → D
  });

  it("27. the final match has no next match", () => {
    expect(tr(run("L")).postLoss).toEqual({ total: 0, nextWins: 0, rate: null });
    expect(tr(run("WWL")).postLoss.total).toBe(0);
  });

  it("28. never crosses a real session boundary", () => {
    const t = tr([...run("L", 0, "s1"), ...run("W", 4, "s2")]);
    expect(t.postLoss.total).toBe(0);
  });

  it("29. never crosses a ≥ 45 min analytics segment boundary", () => {
    expect(tr([m("loss", 0), m("win", 45)]).postLoss.total).toBe(0);
    expect(tr([m("loss", 0), m("win", 44)]).postLoss).toEqual({ total: 1, nextWins: 1, rate: 100 });
  });

  it("matches with session_id NULL take no part", () => {
    expect(tr(run("LWLW", 0, null)).postLoss.total).toBe(0);
  });

  it("the post-loss side equals the existing recovery metric", () => {
    const rows = [...run("LWLLDLWWLD", 0, "s1"), ...run("WLLW", 200, "s2")];
    const segments = segmentSessionMatches(rows);
    const t = computeNextMatchTransitions(segments);
    const recovery = computeRecoveryAfterLoss(segments);
    expect(t.postLoss.total).toBe(recovery.lossesWithNextMatch);
    expect(t.postLoss.nextWins).toBe(recovery.recoveredWithWin);
  });

  /** `n` one-transition sessions of `spec` (2 matches each). */
  const sessions = (spec: string, n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => run(spec, i * 1000, `${prefix}${i}`)).flat();

  it("30. exactly 10 observations on each side is the boundary", () => {
    const signal = (losses: number, wins: number) =>
      postLossTransitionSignal(
        segmentSessionMatches([...sessions("LL", losses, "l"), ...sessions("WW", wins, "w")]),
      );
    expect(signal(10, 10)).toMatchObject({
      id: "post-loss",
      type: "post-loss-transition",
      direction: "down",
      destination: "#sessions",
      postLoss: { total: 10, nextWins: 0, rate: 0 },
      postWin: { total: 10, nextWins: 10, rate: 100 },
      deltaPp: expect.closeTo(-100, 9),
      sample: 10,
    });
    expect(signal(9, 10)).toBeNull();
    expect(signal(10, 9)).toBeNull();
  });

  it("31. only a gap ≤ −10 pp produces a signal (never a positive one)", () => {
    const build = (lw: number, ll: number, ww: number, wl: number) =>
      segmentSessionMatches([
        ...sessions("LW", lw, "a"),
        ...sessions("LL", ll, "b"),
        ...sessions("WW", ww, "c"),
        ...sessions("WL", wl, "d"),
      ]);
    expect(postLossTransitionSignal(build(4, 6, 5, 5))?.deltaPp).toBeCloseTo(-10, 9); // 40 vs 50
    expect(postLossTransitionSignal(build(5, 6, 6, 5))).toBeNull(); // 45.5 vs 54.5 = −9.1
    expect(postLossTransitionSignal(build(10, 0, 0, 10))).toBeNull(); // +100: not in v1
  });
});

describe("high exposure opponent (descriptive)", () => {
  const opp = (key: string, matches: number, share: number): OpponentPerformance => ({
    opponentKey: key,
    opponentName: key.toUpperCase(),
    record: rec(matches, 0),
    share,
  });

  it("32. 20 matches and 10 % share qualify", () => {
    expect(highExposureOpponentSignal([opp("jp", 20, 10)])).toMatchObject({
      id: "exposure:jp",
      type: "high-exposure-opponent",
      direction: "neutral",
      destination: "#matchups",
      opponentKey: "jp",
      share: 10,
      sample: 20,
    });
  });

  it("33. 19 matches → none", () => {
    expect(highExposureOpponentSignal([opp("jp", 19, 50)])).toBeNull();
  });

  it("34. 9.99 % → none", () => {
    expect(highExposureOpponentSignal([opp("jp", 200, 9.99)])).toBeNull();
  });

  it("35. the highest exposure is selected deterministically", () => {
    const pick = (list: OpponentPerformance[]) => highExposureOpponentSignal(list)?.opponentKey;
    expect(pick([opp("ken", 25, 20), opp("jp", 30, 15)])).toBe("jp"); // more matches
    expect(pick([opp("ken", 30, 20), opp("jp", 30, 25)])).toBe("jp"); // then share
    expect(pick([opp("ken", 30, 20), opp("jp", 30, 20)])).toBe("jp"); // then key
    expect(pick([opp("jp", 30, 20), opp("ken", 30, 20)])).toBe("jp");
  });

  it("from real rows: unknown opponents are never an opponent", () => {
    const rows = [...pair("aki", null, 0, 100), ...pair("aki", "jp", 10, 10)];
    const exposure = computeAnalytics(rows).review.signals.filter(
      (s) => s.type === "high-exposure-opponent",
    );
    expect(exposure.map((s) => s.id)).toEqual(["exposure:jp"]);
  });
});

describe("ranking and top-3 selection", () => {
  const record = rec(10, 10);
  const mu = (id: string, deltaPp: number, sample = 10): ReviewSignal => ({
    id,
    type: "matchup-underperformance",
    direction: "down",
    destination: "#matchups",
    sample,
    characterKey: "aki",
    characterName: "A.K.I.",
    opponentKey: id,
    opponentName: id,
    matchup: record,
    baseline: record,
    deltaPp,
  });
  const recent = (deltaPp: number, sample = 10): ReviewSignal => ({
    id: "recent:20v20",
    type: "recent-form-shift",
    direction: deltaPp < 0 ? "down" : "up",
    destination: "#recent",
    sample,
    window: 20,
    recent: record,
    previous: record,
    deltaPp,
  });
  const half = (deltaPp: number): ReviewSignal => ({
    id: "session-halves",
    type: "session-half-shift",
    direction: deltaPp < 0 ? "down" : "up",
    destination: "#sessions",
    sample: 20,
    eligibleSegments: 5,
    first: record,
    second: record,
    deltaPp,
  });
  const exposure: ReviewSignal = {
    id: "exposure:jp",
    type: "high-exposure-opponent",
    direction: "neutral",
    destination: "#matchups",
    sample: 400,
    opponentKey: "jp",
    opponentName: "JP",
    record,
    share: 40,
  };
  const ids = (list: ReviewSignal[]) => selectReviewSignals(list).signals.map((s) => s.id);

  it("36. at most 3 selected; totalEligible counts everything", () => {
    const section = selectReviewSignals([
      mu("a", -20),
      mu("b", -15),
      recent(-12),
      half(30),
      exposure,
    ]);
    expect(section.signals).toHaveLength(3);
    expect(section.totalEligible).toBe(5);
  });

  it("37. at most 2 signals of the same type", () => {
    expect(ids([mu("a", -40), mu("b", -30), mu("c", -20), recent(15)])).toEqual([
      "a",
      "b",
      "recent:20v20",
    ]);
    const only = selectReviewSignals([mu("a", -40), mu("b", -30), mu("c", -20), mu("d", -10)]);
    expect(only.signals.map((s) => s.id)).toEqual(["a", "b"]);
    expect(only.totalEligible).toBe(4);
  });

  it("38. negative before positive, whatever the size", () => {
    expect(ids([half(60), recent(-10)])).toEqual(["recent:20v20", "session-halves"]);
  });

  it("39. larger |delta| first, then larger sample, then id", () => {
    expect(ids([mu("a", -12), recent(-25), mu("b", -18)])).toEqual(["recent:20v20", "b", "a"]);
    expect(ids([mu("x", -15, 10), mu("y", -15, 30)])).toEqual(["y", "x"]);
    expect(ids([mu("y", -15), mu("x", -15)])).toEqual(["x", "y"]);
  });

  it("40. high exposure is the neutral fallback (after every comparative signal)", () => {
    expect(ids([exposure, half(11)])).toEqual(["session-halves", "exposure:jp"]);
    expect(ids([exposure, mu("a", -20), mu("b", -15)])).toEqual(["a", "b", "exposure:jp"]);
    expect(ids([exposure, mu("a", -20), mu("b", -15), recent(-11)])).toEqual([
      "a",
      "b",
      "recent:20v20",
    ]);
    expect(ids([exposure])).toEqual(["exposure:jp"]);
  });

  it("41. stable result under shuffled input", () => {
    const list = [mu("a", -20), mu("b", -20), mu("c", -11), recent(13), half(-13), exposure];
    const expected = ids(list);
    for (let seed = 1; seed < 20; seed++) expect(ids(shuffled(list, seed))).toEqual(expected);
  });
});

describe("integration with computeAnalytics", () => {
  it("no qualifying evidence → empty section (no invented signal)", () => {
    expect(computeAnalytics([]).review).toEqual({ signals: [], totalEligible: 0 });
    expect(computeAnalytics(run("WLWLW")).review).toEqual({ signals: [], totalEligible: 0 });
  });

  it("the character filter narrows review to that character", () => {
    const rows = [
      ...pair("aki", "jp", 2, 8),
      ...pair("aki", "ken", 14, 6),
      ...pair("juri", "jp", 2, 8),
      ...pair("juri", "ken", 14, 6),
    ];
    const all = computeAnalytics(rows).review.signals.filter(
      (s) => s.type === "matchup-underperformance",
    );
    expect(all.map((s) => s.id)).toEqual(["matchup:aki:jp", "matchup:juri:jp"]);
    const aki = computeAnalytics(rows, { character: "aki" }).review.signals;
    expect(
      aki.every((s) => s.type !== "matchup-underperformance" || s.characterKey === "aki"),
    ).toBe(true);
    expect(aki.map((s) => s.id)).toContain("matchup:aki:jp");
    expect(aki.map((s) => s.id)).not.toContain("matchup:juri:jp");
  });

  it("42. no NaN / Infinity anywhere", () => {
    const rows = [
      ...pair("aki", "jp", 2, 8, 3),
      ...pair("aki", "ken", 30, 10, 2),
      ...pair("juri", null, 5, 5, 5),
      ...Array.from({ length: 6 }, (_, i) => run("WWLDLWLLWW", i * 1000, `s${i}`)).flat(),
      ...run("DDDD", 90_000, "s9"),
    ];
    for (const character of [null, "aki", "juri"]) {
      const review = computeAnalytics(rows, { character }).review;
      assertFinite(review);
      expect(JSON.stringify(review)).not.toMatch(/NaN|Infinity/);
    }
    assertFinite(computeAnalytics([]).review);
    assertFinite(computeAnalytics(run("DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD")).review);
  });

  it("only character / result / time / session data: no rating or opponent-name fields", () => {
    const rows = [...pair("aki", "jp", 2, 8), ...pair("aki", "ken", 14, 6)];
    const json = JSON.stringify(computeAnalytics(rows).review);
    expect(json).not.toMatch(/rating|"lp"|"mr"|rank|opponentPlayer|opponent_name/i);
  });
});
