import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_FILTER,
  applyMatchToSession,
  buildSessionState,
  calculateWinRate,
  computeCharacterProgress,
  computeSessionStats,
  emptySessionState,
  isMatchInSession,
  pickBaselineMatch,
  resolveActiveCharacter,
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionBaseline,
  type SessionMatch,
} from "./engine";
import type { MatchResult, RatingPoint } from "@/domain/sf6/types";

const T0 = new Date("2026-10-03T18:00:00Z").getTime();
const minutes = (n: number) => new Date(T0 + n * 60_000);

const NAMES: Record<string, string> = {
  aki: "A.K.I.",
  kimberly: "Kimberly",
  cammy: "Cammy",
  sagat: "Sagat",
  ryu: "Ryu",
};

let seq = 0;
function match(
  result: MatchResult,
  minute: number,
  overrides: Partial<SessionMatch> & { char?: string } = {},
): SessionMatch {
  seq++;
  const { char = "ryu", ...rest } = overrides;
  return {
    externalMatchId: `m-${minute}-${seq}`,
    playedAt: minutes(minute),
    mode: "ranked",
    result,
    characterKey: char,
    characterName: NAMES[char] ?? char,
    opponentCharacter: "Ken",
    opponentName: "Opponent",
    ...rest,
  };
}

const lp = (
  value: number,
  rank: string | null = null,
  phase: number | null = null,
): RatingPoint => ({
  system: "lp",
  value,
  rank,
  rankTier: null,
  phase,
});
const mr = (
  value: number,
  rank: string | null = "Master",
  phase: number | null = null,
): RatingPoint => ({
  system: "mr",
  value,
  rank,
  rankTier: null,
  phase,
});

function baseline(overrides: Partial<SessionBaseline> = {}): SessionBaseline {
  return {
    startedAt: minutes(0),
    endedAt: null,
    baselineMatchId: null,
    baselinePlayedAt: null,
    filter: DEFAULT_SESSION_FILTER,
    ...overrides,
  };
}

const start = (char: string, rating: RatingPoint | null): CharacterBaseline => ({
  characterKey: char,
  characterName: NAMES[char] ?? char,
  source: "session_start",
  rating,
  capturedAt: minutes(0),
});
const snap = (char: string, rating: RatingPoint | null, minute = 100): CharacterSnapshot => ({
  characterKey: char,
  characterName: NAMES[char] ?? char,
  rating,
  observedAt: minutes(minute),
});
const byKey = <T extends { characterKey: string }>(list: T[], key: string) => {
  const found = list.find((c) => c.characterKey === key);
  if (!found) throw new Error(`no progress for ${key}`);
  return found;
};

/* ═══════════════════════ Global W/L (unchanged behavior) ═══════════════════════ */

describe("computeSessionStats", () => {
  it("0 matches → zeros, no NaN", () => {
    const stats = computeSessionStats([]);
    expect(stats).toMatchObject({ wins: 0, losses: 0, draws: 0, totalGames: 0, winRate: 0 });
    expect(Number.isNaN(stats.winRate)).toBe(false);
  });

  it("1 win / 1 loss / several", () => {
    expect(computeSessionStats([match("win", 1)])).toMatchObject({ wins: 1, winRate: 100 });
    expect(computeSessionStats([match("loss", 1)])).toMatchObject({
      losses: 1,
      currentLossStreak: 1,
    });
    expect(computeSessionStats([match("win", 1), match("win", 2), match("win", 3)])).toMatchObject({
      wins: 3,
      bestWinStreak: 3,
    });
  });

  it("win rate: 8W 4L → 66.67%", () => {
    const results: MatchResult[] = [..."WWLWWLWLWWLW"].map((c) => (c === "W" ? "win" : "loss"));
    const stats = computeSessionStats(results.map((r, i) => match(r, i + 1)));
    expect(stats.winRate).toBeCloseTo(66.667, 2);
  });

  it("draws are excluded from win rate and reset streaks", () => {
    const stats = computeSessionStats([match("win", 1), match("win", 2), match("draw", 3)]);
    expect(stats).toMatchObject({
      wins: 2,
      draws: 1,
      winRate: 100,
      currentWinStreak: 0,
      bestWinStreak: 2,
    });
  });

  it("calculateWinRate guards division by zero", () => {
    expect(calculateWinRate(0, 0)).toBe(0);
  });
});

describe("applyMatchToSession", () => {
  it("duplicate match is counted once (idempotent)", () => {
    const m = match("win", 1);
    let state = emptySessionState();
    for (let i = 0; i < 10; i++) state = applyMatchToSession(state, m);
    expect(state.stats.wins).toBe(1);
  });

  it("out-of-order matches produce the same result as in-order", () => {
    const a = match("win", 1);
    const b = match("win", 2);
    const c = match("loss", 3);
    const inOrder = [a, b, c].reduce(applyMatchToSession, emptySessionState());
    const shuffled = [c, a, b].reduce(applyMatchToSession, emptySessionState());
    expect(shuffled.stats).toEqual(inOrder.stats);
  });

  it("rebuilding from persisted matches yields identical stats", () => {
    const persisted = [match("win", 1), match("loss", 2), match("win", 3)];
    expect(buildSessionState(persisted).stats).toEqual(
      persisted.reduce(applyMatchToSession, emptySessionState()).stats,
    );
  });
});

/* ═══════════════════════ Membership: IDs first, time second ═══════════════════════ */

describe("isMatchInSession", () => {
  const GRACE = 90_000;

  it("match played before the session start (outside grace) does not count", () => {
    expect(isMatchInSession(baseline(), match("win", -30), { startGraceMs: GRACE })).toBe(false);
  });

  it("new match within the grace window counts (coarse / offset CFN timestamps)", () => {
    const m = match("win", -1); // 60 s before start
    expect(isMatchInSession(baseline(), m)).toBe(false);
    expect(isMatchInSession(baseline(), m, { startGraceMs: GRACE })).toBe(true);
  });

  it("a known match ID (baseline snapshot) never counts, even inside the window", () => {
    const m = match("win", 5);
    expect(isMatchInSession(baseline(), m, { knownMatchIds: new Set([m.externalMatchId]) })).toBe(
      false,
    );
    expect(
      isMatchInSession(baseline({ baselineMatchId: m.externalMatchId }), m, {
        startGraceMs: GRACE,
      }),
    ).toBe(false);
  });

  it("unknown but strictly older than the newest baseline match ⇒ pre-session, not counted", () => {
    const b = baseline({ baselineMatchId: "last", baselinePlayedAt: minutes(-0.5) });
    expect(isMatchInSession(b, match("win", -1), { startGraceMs: GRACE })).toBe(false);
    // Same (coarse) timestamp as the baseline match but a different ID ⇒ counts.
    expect(isMatchInSession(b, match("win", -0.5), { startGraceMs: GRACE })).toBe(true);
  });

  it("excludes matches after the session ended", () => {
    const b = baseline({ endedAt: minutes(60) });
    expect(isMatchInSession(b, match("win", 59))).toBe(true);
    expect(isMatchInSession(b, match("win", 61))).toBe(false);
  });

  it("ranked-only by default", () => {
    expect(isMatchInSession(baseline(), match("win", 1, { mode: "casual" }))).toBe(false);
  });

  it("pickBaselineMatch returns the latest known match", () => {
    const old = match("win", -60);
    const latest = match("loss", -5);
    expect(pickBaselineMatch([latest, old])).toBe(latest);
  });
});

/* ═══════════════════════ Per-character progress ═══════════════════════ */

describe("computeCharacterProgress", () => {
  it("session with only A.K.I. (Diamond, LP)", () => {
    const [aki] = computeCharacterProgress({
      baselines: [start("aki", lp(19704, "Diamond 2"))],
      matches: [
        match("win", 1, { char: "aki", ratingBefore: lp(19704), ratingAfter: lp(19810) }),
        match("win", 2, {
          char: "aki",
          ratingBefore: lp(19810),
          ratingAfter: lp(19921, "Diamond 2"),
        }),
      ],
      current: [],
    });
    expect(aki).toMatchObject({ characterKey: "aki", wins: 2, ratingSystem: "lp", delta: 217 });
    expect(aki?.currentSource).toBe("match_after");
  });

  it("session with only Kimberly (Master, MR)", () => {
    const [kim] = computeCharacterProgress({
      baselines: [start("kimberly", mr(1479))],
      matches: [match("loss", 1, { char: "kimberly", ratingAfter: mr(1466) })],
      current: [],
    });
    expect(kim).toMatchObject({ ratingSystem: "mr", losses: 1, delta: -13 });
  });

  it("the audit scenario: A.K.I. MR then Kimberly LP — separate, correct deltas", () => {
    const matches = [
      match("win", 1, { char: "aki", ratingBefore: mr(1476), ratingAfter: mr(1501) }),
      match("loss", 2, { char: "aki", ratingBefore: mr(1501), ratingAfter: mr(1484) }),
      match("win", 3, { char: "kimberly", ratingBefore: lp(16320), ratingAfter: lp(16440) }),
    ];
    const summary = summarizeSession({
      status: "active",
      ratingModel: "per_character",
      baseline: baseline(),
      matches,
      characterBaselines: [start("aki", mr(1476)), start("kimberly", lp(16320))],
      current: [],
      favoriteCharacterKey: "aki",
    });
    expect(summary).toMatchObject({ wins: 2, losses: 1, totalGames: 3 });
    expect(byKey(summary.characters, "aki")).toMatchObject({
      wins: 1,
      losses: 1,
      delta: 8,
      ratingSystem: "mr",
    });
    expect(byKey(summary.characters, "kimberly")).toMatchObject({
      wins: 1,
      losses: 0,
      delta: 120,
      ratingSystem: "lp",
    });
    // The old bug produced −8560 LP / "Master → Diamond"; no such value can appear now.
    expect(summary.characters.map((c) => c.delta)).not.toContain(-8560);
    expect(summary.activeCharacterKey).toBe("kimberly");
  });

  it("global W/L sums every character; per-character W/L is split", () => {
    const matches = [
      ...[1, 2, 3].map((m) => match("win", m, { char: "aki" })),
      ...[4, 5].map((m) => match("loss", m, { char: "aki" })),
      match("win", 6, { char: "kimberly" }),
      match("loss", 7, { char: "kimberly" }),
      match("win", 8, { char: "kimberly" }),
    ];
    expect(computeSessionStats(matches)).toMatchObject({ wins: 5, losses: 3, totalGames: 8 });
    const progress = computeCharacterProgress({ baselines: [], matches, current: [] });
    expect(byKey(progress, "aki")).toMatchObject({ wins: 3, losses: 2, games: 5 });
    expect(byKey(progress, "kimberly")).toMatchObject({ wins: 2, losses: 1, games: 3 });
  });

  it("Diamond (LP) + Master (MR) in one session: each in its own unit", () => {
    const progress = computeCharacterProgress({
      baselines: [start("aki", lp(19704, "Diamond 2")), start("cammy", mr(1522))],
      matches: [
        match("win", 1, { char: "aki", ratingAfter: lp(19823, "Diamond 2") }),
        match("win", 2, { char: "cammy", ratingAfter: mr(1540) }),
      ],
      current: [],
    });
    expect(byKey(progress, "aki")).toMatchObject({ ratingSystem: "lp", delta: 119 });
    expect(byKey(progress, "cammy")).toMatchObject({ ratingSystem: "mr", delta: 18 });
  });

  it("never subtracts LP from MR (promotion Diamond → Master ⇒ delta null)", () => {
    const [aki] = computeCharacterProgress({
      baselines: [start("aki", lp(24950, "Diamond 5"))],
      matches: [match("win", 1, { char: "aki", ratingAfter: mr(1500) })],
      current: [],
    });
    expect(aki?.delta).toBeNull();
    expect(aki?.ratingSystem).toBe("mr");
    expect(aki?.current?.value).toBe(1500);
  });

  it("never subtracts one character's rating from another's", () => {
    // Kimberly's only data is her own; A.K.I.'s baseline can never become her initial.
    const progress = computeCharacterProgress({
      baselines: [start("aki", lp(25000))],
      matches: [match("win", 1, { char: "kimberly", ratingAfter: lp(16440) })],
      current: [snap("aki", lp(25000))],
    });
    const kim = byKey(progress, "kimberly");
    expect(kim.initial).toBeNull();
    expect(kim.delta).toBeNull();
    expect(byKey(progress, "aki").delta).toBe(0);
  });

  it("character not in the baseline, match has ratingBefore ⇒ baseline from ratingBefore", () => {
    const [sagat] = computeCharacterProgress({
      baselines: [start("aki", lp(20000))],
      matches: [
        match("win", 1, { char: "sagat", ratingBefore: lp(0, "Rookie 1"), ratingAfter: lp(85) }),
        match("win", 2, { char: "sagat", ratingBefore: lp(85), ratingAfter: lp(170) }),
      ],
      current: [],
    });
    expect(sagat).toMatchObject({
      characterKey: "sagat",
      initialSource: "match_before",
      delta: 170,
    });
  });

  it("character not in the baseline and no ratingBefore ⇒ delta null (never current − 0)", () => {
    const [sagat] = computeCharacterProgress({
      baselines: [],
      matches: [match("win", 1, { char: "sagat", ratingAfter: lp(85) })],
      current: [snap("sagat", lp(85))],
    });
    expect(sagat?.initial).toBeNull();
    expect(sagat?.initialSource).toBe("unknown");
    expect(sagat?.current?.value).toBe(85);
    expect(sagat?.delta).toBeNull();
  });

  it("phase mismatch ⇒ delta null", () => {
    const [kim] = computeCharacterProgress({
      baselines: [start("kimberly", mr(1600, "Master", 13))],
      matches: [match("win", 1, { char: "kimberly", ratingAfter: mr(1500, "Master", 14) })],
      current: [],
    });
    expect(kim?.delta).toBeNull();
  });

  it("Master with MR and Diamond with LP keep their own systems", () => {
    const progress = computeCharacterProgress({
      baselines: [start("kimberly", mr(1479)), start("aki", lp(19704, "Diamond 2"))],
      matches: [],
      current: [snap("kimberly", mr(1479)), snap("aki", lp(19704))],
    });
    expect(byKey(progress, "kimberly")).toMatchObject({ ratingSystem: "mr", delta: 0, games: 0 });
    expect(byKey(progress, "aki")).toMatchObject({ ratingSystem: "lp", delta: 0, games: 0 });
  });

  it("current rating priority: ratingAfter > newer snapshot > baseline; older snapshot never wins", () => {
    const withAfter = computeCharacterProgress({
      baselines: [start("aki", lp(100))],
      matches: [match("win", 10, { char: "aki", ratingAfter: lp(200) })],
      current: [snap("aki", lp(150), 20)],
    });
    expect(byKey(withAfter, "aki").current?.value).toBe(200);

    const staleSnapshot = computeCharacterProgress({
      baselines: [start("aki", lp(100))],
      matches: [match("win", 10, { char: "aki" })],
      current: [snap("aki", lp(100), 5)], // observed BEFORE the match
    });
    expect(byKey(staleSnapshot, "aki").current).toBeNull();
    expect(byKey(staleSnapshot, "aki").delta).toBeNull();

    const freshSnapshot = computeCharacterProgress({
      baselines: [start("aki", lp(100))],
      matches: [match("win", 10, { char: "aki" })],
      current: [snap("aki", lp(190), 11)],
    });
    expect(byKey(freshSnapshot, "aki")).toMatchObject({ delta: 90, currentSource: "snapshot" });

    const notPlayed = computeCharacterProgress({
      baselines: [start("cammy", mr(1522))],
      matches: [],
      current: [],
    });
    expect(byKey(notPlayed, "cammy")).toMatchObject({ currentSource: "baseline", delta: 0 });
  });

  it("duplicates and out-of-order matches do not affect progress", () => {
    const a = match("win", 1, { char: "aki", ratingAfter: lp(110) });
    const b = match("loss", 2, { char: "aki", ratingAfter: lp(90) });
    const c = match("win", 3, { char: "aki", ratingAfter: lp(130) });
    const inOrder = computeCharacterProgress({
      baselines: [start("aki", lp(100))],
      matches: [a, b, c],
      current: [],
    });
    const messy = computeCharacterProgress({
      baselines: [start("aki", lp(100))],
      matches: [c, a, b, a, c],
      current: [],
    });
    expect(messy).toEqual(inOrder);
    expect(byKey(messy, "aki")).toMatchObject({ wins: 2, losses: 1, delta: 30 });
  });

  it("played characters come first, most recent first", () => {
    const progress = computeCharacterProgress({
      baselines: [start("cammy", mr(1500)), start("aki", lp(1)), start("kimberly", mr(1))],
      matches: [match("win", 1, { char: "aki" }), match("win", 2, { char: "kimberly" })],
      current: [],
    });
    expect(progress.map((p) => p.characterKey)).toEqual(["kimberly", "aki", "cammy"]);
  });
});

describe("resolveActiveCharacter", () => {
  it("is the character of the latest counted Ranked match", () => {
    expect(
      resolveActiveCharacter({
        matches: [match("win", 2, { char: "kimberly" }), match("win", 1, { char: "aki" })],
        favoriteCharacterKey: "aki",
        characters: [],
      }),
    ).toBe("kimberly");
  });

  it("a Casual match does not change it (not a session match under the Ranked filter)", () => {
    const ranked = match("win", 1, { char: "aki" });
    const casual = match("win", 2, { char: "kimberly", mode: "casual" });
    const counted = [ranked, casual].filter((m) => isMatchInSession(baseline(), m));
    expect(
      resolveActiveCharacter({ matches: counted, favoriteCharacterKey: null, characters: [] }),
    ).toBe("aki");
  });

  it("falls back to the favorite, then the first rated character, then null", () => {
    expect(
      resolveActiveCharacter({
        matches: [],
        favoriteCharacterKey: "cammy",
        characters: [snap("aki", lp(1))],
      }),
    ).toBe("cammy");
    expect(
      resolveActiveCharacter({
        matches: [],
        favoriteCharacterKey: null,
        characters: [snap("ryu", null), snap("aki", lp(1))],
      }),
    ).toBe("aki");
    expect(
      resolveActiveCharacter({ matches: [], favoriteCharacterKey: null, characters: [] }),
    ).toBeNull();
  });
});

describe("restart / new session", () => {
  it("a new session starts from zero and ignores the previous session's matches", () => {
    const first = baseline({ startedAt: minutes(0) });
    const firstMatches = [match("win", 1), match("win", 2), match("loss", 3)].filter((m) =>
      isMatchInSession(first, m),
    );
    const last = pickBaselineMatch(firstMatches);
    const second = baseline({
      startedAt: minutes(10),
      baselineMatchId: last?.externalMatchId ?? null,
      baselinePlayedAt: last?.playedAt ?? null,
    });
    const secondMatches = [...firstMatches, match("loss", 11)].filter((m) =>
      isMatchInSession(second, m, { startGraceMs: 90_000 }),
    );
    expect(computeSessionStats(secondMatches)).toMatchObject({ wins: 0, losses: 1 });
  });
});

describe("Phase 5.1: character-scoped session statistics", () => {
  const progress = (matches: SessionMatch[], baselines: CharacterBaseline[] = []) =>
    computeCharacterProgress({ baselines, matches, current: [] });

  it("1. single character: its stats equal the session's", () => {
    const ms = [match("win", 1), match("loss", 2), match("win", 3)];
    const [ryu] = progress(ms);
    const session = computeSessionStats(ms);
    const statKeys = Object.keys(session) as Array<keyof typeof session>;
    expect(Object.fromEntries(statKeys.map((k) => [k, ryu?.[k]]))).toEqual(session);
    expect(ryu?.games).toBe(3);
  });

  it("2–9, 17–18. several characters: correct global + per-character stats; other characters never break a streak", () => {
    // Chun-Li W, Chun-Li W, Jamie L, Chun-Li W (the spec example)
    const ms = [
      match("win", 1, { char: "chunli" }),
      match("win", 2, { char: "chunli" }),
      match("loss", 3, { char: "jamie" }),
      match("win", 4, { char: "chunli" }),
    ];
    const global = computeSessionStats(ms);
    expect([global.wins, global.losses, global.currentWinStreak, global.bestWinStreak]).toEqual([
      3, 1, 1, 2,
    ]);
    const list = progress(ms);
    const chun = byKey(list, "chunli");
    const jamie = byKey(list, "jamie");
    expect(chun).toMatchObject({
      wins: 3,
      losses: 0,
      games: 3,
      winRate: 100,
      currentWinStreak: 3,
      bestWinStreak: 3,
      currentLossStreak: 0,
    });
    expect(chun.recentResults).toEqual(["win", "win", "win"]);
    expect(jamie).toMatchObject({
      wins: 0,
      losses: 1,
      games: 1,
      winRate: 0,
      currentWinStreak: 0,
      currentLossStreak: 1,
    });
    expect(jamie.recentResults).toEqual(["loss"]);
    // 17. global = sum of played characters
    expect(list.reduce((n, c) => n + c.wins, 0)).toBe(global.wins);
    expect(list.reduce((n, c) => n + c.losses, 0)).toBe(global.losses);
    expect(list.reduce((n, c) => n + c.games, 0)).toBe(global.totalGames);
  });

  it("7. per-character loss streak and win rate", () => {
    const ms = [
      match("loss", 1, { char: "jamie" }),
      match("win", 2, { char: "ryu" }),
      match("loss", 3, { char: "jamie" }),
      match("loss", 4, { char: "jamie" }),
    ];
    const jamie = byKey(progress(ms), "jamie");
    expect(jamie).toMatchObject({ losses: 3, currentLossStreak: 3, winRate: 0 });
  });

  it("9. recent results: only this character's, chronological, capped like the session's", () => {
    const ms: SessionMatch[] = [];
    for (let i = 0; i < 14; i++)
      ms.push(match(i % 3 === 0 ? "loss" : "win", i * 2, { char: "ryu" }));
    ms.push(match("loss", 100, { char: "chunli" }));
    const ryu = byKey(progress(ms), "ryu");
    expect(ryu.recentResults).toHaveLength(10);
    expect(ryu.recentResults).toEqual(
      computeSessionStats(ms.filter((m) => m.characterKey === "ryu")).recentResults,
    );
    expect(byKey(progress(ms), "chunli").recentResults).toEqual(["loss"]);
  });

  it("10. draws: not in win rate, break streaks, count as games, appear in recent form", () => {
    const ms = [match("win", 1), match("win", 2), match("draw", 3), match("win", 4)];
    const ryu = byKey(progress(ms), "ryu");
    expect(ryu).toMatchObject({
      wins: 3,
      draws: 1,
      games: 4,
      winRate: 100,
      currentWinStreak: 1,
      bestWinStreak: 2,
    });
    expect(ryu.recentResults).toEqual(["win", "win", "draw", "win"]);
  });

  it("11–13. duplicates ignored; out-of-order and late (older) matches placed chronologically", () => {
    const a = match("win", 1, { char: "chunli" });
    const b = match("loss", 2, { char: "chunli" });
    const c = match("win", 3, { char: "chunli" });
    const inOrder = byKey(progress([a, b, c]), "chunli");
    const shuffledWithDupes = byKey(progress([c, a, c, b, a]), "chunli");
    expect(shuffledWithDupes).toEqual(inOrder);
    // A late older loss (minute 0) arriving after: streak still ends with the latest win.
    const late = byKey(progress([a, b, c, match("loss", 0, { char: "chunli" })]), "chunli");
    expect(late).toMatchObject({ wins: 2, losses: 2, currentWinStreak: 1 });
    expect(late.recentResults).toEqual(["loss", "win", "loss", "win"]);
  });

  it("14–15. character known from the roster with 0 games: zeros (no invented matches); no rating ⇒ null", () => {
    const list = progress(
      [match("win", 1, { char: "ryu" })],
      [start("cammy", lp(9200, "Gold 1")), start("aki", null)],
    );
    const cammy = byKey(list, "cammy");
    expect(cammy).toMatchObject({
      games: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      currentWinStreak: 0,
      bestWinStreak: 0,
      recentResults: [],
    });
    expect(cammy.current?.value).toBe(9200);
    expect(byKey(list, "aki")).toMatchObject({ games: 0, current: null, delta: null });
  });

  it("16. empty session: no played character, global stats empty", () => {
    expect(progress([], [start("ryu", mr(1500))]).every((c) => c.games === 0)).toBe(true);
    expect(computeSessionStats([]).totalGames).toBe(0);
  });
});
