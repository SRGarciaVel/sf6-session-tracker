import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_FILTER,
  applyMatchToSession,
  buildSessionState,
  calculateWinRate,
  computeSessionStats,
  emptySessionState,
  isMatchInSession,
  pickBaselineMatch,
  summarizeSession,
  type SessionBaseline,
  type SessionMatch,
} from "./engine";
import { EMPTY_RATING } from "@/domain/sf6/rating";
import type { MatchResult } from "@/domain/sf6/types";

const T0 = new Date("2026-10-03T18:00:00Z").getTime();
const minutes = (n: number) => new Date(T0 + n * 60_000);

let seq = 0;
function match(result: MatchResult, minute: number, overrides: Partial<SessionMatch> = {}) {
  seq++;
  return {
    externalMatchId: `m-${minute}-${seq}`,
    playedAt: minutes(minute),
    mode: "ranked",
    result,
    playerCharacter: "Ryu",
    opponentCharacter: "Ken",
    opponentName: "Opponent",
    ...overrides,
  } satisfies SessionMatch;
}

function baseline(overrides: Partial<SessionBaseline> = {}): SessionBaseline {
  return {
    startedAt: minutes(0),
    endedAt: null,
    baselineMatchId: null,
    baselinePlayedAt: null,
    initialRating: EMPTY_RATING,
    filter: DEFAULT_SESSION_FILTER,
    ...overrides,
  };
}

describe("computeSessionStats", () => {
  it("0 matches → zeros, no NaN", () => {
    const stats = computeSessionStats([]);
    expect(stats).toMatchObject({
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      winRate: 0,
      currentWinStreak: 0,
      currentLossStreak: 0,
      bestWinStreak: 0,
    });
    expect(Number.isNaN(stats.winRate)).toBe(false);
  });

  it("1 win", () => {
    const stats = computeSessionStats([match("win", 1)]);
    expect(stats).toMatchObject({ wins: 1, losses: 0, winRate: 100, currentWinStreak: 1 });
  });

  it("1 loss", () => {
    const stats = computeSessionStats([match("loss", 1)]);
    expect(stats).toMatchObject({ wins: 0, losses: 1, winRate: 0, currentLossStreak: 1 });
  });

  it("several wins", () => {
    const stats = computeSessionStats([match("win", 1), match("win", 2), match("win", 3)]);
    expect(stats).toMatchObject({ wins: 3, currentWinStreak: 3, bestWinStreak: 3, winRate: 100 });
  });

  it("several losses", () => {
    const stats = computeSessionStats([match("loss", 1), match("loss", 2), match("loss", 3)]);
    expect(stats).toMatchObject({ losses: 3, currentLossStreak: 3, bestWinStreak: 0, winRate: 0 });
  });

  it("win rate: 3W 2L → 60%", () => {
    const stats = computeSessionStats([
      match("win", 1),
      match("loss", 2),
      match("win", 3),
      match("loss", 4),
      match("win", 5),
    ]);
    expect(stats.winRate).toBe(60);
    expect(stats.totalGames).toBe(5);
  });

  it("win rate: 8W 4L → 66.67%", () => {
    const results: MatchResult[] = [..."WWLWWLWLWWLW"].map((c) => (c === "W" ? "win" : "loss"));
    const stats = computeSessionStats(results.map((r, i) => match(r, i + 1)));
    expect(stats.wins).toBe(8);
    expect(stats.losses).toBe(4);
    expect(stats.winRate).toBeCloseTo(66.667, 2);
  });

  it("draws are excluded from win rate and reset streaks", () => {
    const stats = computeSessionStats([match("win", 1), match("win", 2), match("draw", 3)]);
    expect(stats).toMatchObject({
      wins: 2,
      draws: 1,
      totalGames: 3,
      winRate: 100,
      currentWinStreak: 0,
      bestWinStreak: 2,
    });
  });

  it("tracks current vs best win streak", () => {
    const stats = computeSessionStats([
      match("win", 1),
      match("win", 2),
      match("win", 3),
      match("loss", 4),
      match("win", 5),
    ]);
    expect(stats.bestWinStreak).toBe(3);
    expect(stats.currentWinStreak).toBe(1);
    expect(stats.currentLossStreak).toBe(0);
  });

  it("recent form keeps the last 10 results, oldest first", () => {
    const ms = Array.from({ length: 12 }, (_, i) => match(i < 2 ? "loss" : "win", i + 1));
    const stats = computeSessionStats(ms);
    expect(stats.recentResults).toHaveLength(10);
    expect(stats.recentResults.every((r) => r === "win")).toBe(true);
  });

  it("calculateWinRate guards division by zero", () => {
    expect(calculateWinRate(0, 0)).toBe(0);
    expect(calculateWinRate(1, 3)).toBe(25);
  });
});

describe("applyMatchToSession", () => {
  it("duplicate match is counted once (idempotent)", () => {
    const m = match("win", 1);
    let state = emptySessionState();
    for (let i = 0; i < 10; i++) state = applyMatchToSession(state, m);
    expect(state.stats.wins).toBe(1);
    expect(state.matches).toHaveLength(1);
  });

  it("returns the same object for a duplicate (no spurious updates)", () => {
    const m = match("win", 1);
    const state = applyMatchToSession(emptySessionState(), m);
    expect(applyMatchToSession(state, { ...m })).toBe(state);
  });

  it("out-of-order matches produce the same result as in-order", () => {
    const a = match("win", 1);
    const b = match("win", 2);
    const c = match("loss", 3);
    const inOrder = [a, b, c].reduce(applyMatchToSession, emptySessionState());
    const shuffled = [c, a, b].reduce(applyMatchToSession, emptySessionState());
    expect(shuffled.stats).toEqual(inOrder.stats);
    expect(shuffled.stats.currentLossStreak).toBe(1);
    expect(shuffled.stats.bestWinStreak).toBe(2);
    expect(shuffled.matches.map((m) => m.externalMatchId)).toEqual(
      [a, b, c].map((m) => m.externalMatchId),
    );
  });

  it("buildSessionState dedupes and sorts", () => {
    const a = match("loss", 5);
    const b = match("win", 1);
    const state = buildSessionState([a, b, a, b]);
    expect(state.matches.map((m) => m.externalMatchId)).toEqual([
      b.externalMatchId,
      a.externalMatchId,
    ]);
    expect(state.stats.totalGames).toBe(2);
  });
});

describe("isMatchInSession (baseline)", () => {
  it("excludes matches played before the session started (e.g. earlier the same day)", () => {
    expect(isMatchInSession(baseline(), match("win", -30))).toBe(false);
    expect(isMatchInSession(baseline(), match("win", 1))).toBe(true);
  });

  it("excludes the baseline match itself and anything at/before it", () => {
    const b = baseline({
      startedAt: minutes(0),
      baselineMatchId: "last-known",
      baselinePlayedAt: minutes(2),
    });
    expect(isMatchInSession(b, match("win", 2, { externalMatchId: "last-known" }))).toBe(false);
    expect(isMatchInSession(b, match("win", 1))).toBe(false);
    expect(isMatchInSession(b, match("win", 3))).toBe(true);
  });

  it("start grace window admits a match finished just before Start Session", () => {
    const m = match("win", -0.5);
    expect(isMatchInSession(baseline(), m)).toBe(false);
    expect(isMatchInSession(baseline(), m, { startGraceMs: 60_000 })).toBe(true);
  });

  it("excludes matches after the session ended", () => {
    const b = baseline({ endedAt: minutes(60) });
    expect(isMatchInSession(b, match("win", 59))).toBe(true);
    expect(isMatchInSession(b, match("win", 61))).toBe(false);
  });

  it("ranked-only filter by default; configurable", () => {
    const casual = match("win", 1, { mode: "casual" });
    expect(isMatchInSession(baseline(), casual)).toBe(false);
    expect(isMatchInSession(baseline({ filter: { modes: ["ranked", "casual"] } }), casual)).toBe(
      true,
    );
  });

  it("rejects invalid dates", () => {
    expect(isMatchInSession(baseline(), match("win", 1, { playedAt: new Date("nope") }))).toBe(
      false,
    );
  });

  it("pickBaselineMatch returns the latest known match", () => {
    const old = match("win", -60);
    const latest = match("loss", -5);
    expect(pickBaselineMatch([latest, old])).toBe(latest);
    expect(pickBaselineMatch([])).toBeNull();
  });
});

describe("restart / new session", () => {
  it("a new session starts from zero and ignores the previous session's matches", () => {
    const first = baseline({ startedAt: minutes(0) });
    const firstMatches = [match("win", 1), match("win", 2), match("loss", 3)].filter((m) =>
      isMatchInSession(first, m),
    );
    expect(computeSessionStats(firstMatches)).toMatchObject({ wins: 2, losses: 1 });

    // Streamer clicks "Start New Session" at minute 10: baseline = last known match (minute 3).
    const last = pickBaselineMatch(firstMatches);
    const second = baseline({
      startedAt: minutes(10),
      baselineMatchId: last?.externalMatchId ?? null,
      baselinePlayedAt: last?.playedAt ?? null,
    });
    const replayedHistory = [...firstMatches, match("loss", 11)];
    const secondMatches = replayedHistory.filter((m) => isMatchInSession(second, m));
    expect(computeSessionStats(secondMatches)).toMatchObject({ wins: 0, losses: 1, totalGames: 1 });
  });

  it("restarting the process (rebuilding from persisted matches) yields identical stats", () => {
    const persisted = [match("win", 1), match("loss", 2), match("win", 3), match("win", 4)];
    const live = persisted.reduce(applyMatchToSession, emptySessionState());
    const rebuilt = buildSessionState(persisted);
    expect(rebuilt.stats).toEqual(live.stats);
  });
});

describe("summarizeSession (MR / LP deltas)", () => {
  const ms = [match("win", 1), match("win", 2)];

  it("positive MR delta", () => {
    const s = summarizeSession({
      status: "active",
      baseline: baseline({
        initialRating: { rank: "Master", leaguePoints: 25000, masterRate: 1584 },
      }),
      matches: ms,
      currentRating: { rank: "Master", leaguePoints: 25000, masterRate: 1661 },
    });
    expect(s.rating.system).toBe("mr");
    expect(s.rating.primary).toEqual({ initial: 1584, current: 1661, delta: 77 });
  });

  it("negative MR delta", () => {
    const s = summarizeSession({
      status: "active",
      baseline: baseline({
        initialRating: { rank: "Master", leaguePoints: null, masterRate: 1600 },
      }),
      matches: ms,
      currentRating: { rank: "Master", leaguePoints: null, masterRate: 1582 },
    });
    expect(s.rating.primary.delta).toBe(-18);
  });

  it("LP delta below Master", () => {
    const s = summarizeSession({
      status: "active",
      baseline: baseline({
        initialRating: { rank: "Diamond 2", leaguePoints: 17810, masterRate: null },
      }),
      matches: ms,
      currentRating: { rank: "Diamond 3", leaguePoints: 18430, masterRate: null },
    });
    expect(s.rating.system).toBe("lp");
    expect(s.rating.primary).toEqual({ initial: 17810, current: 18430, delta: 620 });
    expect(s.rating.rank).toBe("Diamond 3");
    expect(s.rating.initialRank).toBe("Diamond 2");
  });

  it("promotion to Master: MR is primary, LP delta still available, no bogus MR delta", () => {
    const s = summarizeSession({
      status: "active",
      baseline: baseline({
        initialRating: { rank: "Diamond 5", leaguePoints: 24900, masterRate: null },
      }),
      matches: ms,
      currentRating: { rank: "Master", leaguePoints: 25000, masterRate: 1500 },
    });
    expect(s.rating.system).toBe("mr");
    expect(s.rating.mr.delta).toBeNull();
    expect(s.rating.lp.delta).toBe(100);
  });

  it("unknown ratings never produce NaN", () => {
    const s = summarizeSession({
      status: "active",
      baseline: baseline(),
      matches: [],
      currentRating: EMPTY_RATING,
    });
    expect(s.rating.primary.delta).toBeNull();
    expect(s.winRate).toBe(0);
  });
});
