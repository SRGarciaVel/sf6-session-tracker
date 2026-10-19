import { describe, expect, it } from "vitest";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import { computeAnalyticsDetailed } from "./aggregate";
import { newestFirst, computeRecord, type AnalyticsMatchRow } from "./record";
import type {
  HighExposureOpponentSignal,
  MatchupUnderperformanceSignal,
  PostLossTransitionSignal,
  RecentFormShiftSignal,
  ReviewSignal,
  SessionHalfShiftSignal,
} from "./review";
import {
  REPLAY_LIMITS,
  computeReviewReplaySelections,
  type ReviewReplaySelection,
} from "./review-replays";
import { segmentSessionMatchRows } from "./sessions";

const T0 = Date.parse("2026-10-01T12:00:00Z");
const MIN = 60_000;
let seq = 0;
const R: Record<string, MatchResult> = { W: "win", L: "loss", D: "draw" };

function m(result: MatchResult, minute: number, over: Partial<AnalyticsMatchRow> = {}) {
  seq++;
  return {
    externalMatchId: `R${String(seq).padStart(6, "0")}`,
    playedAt: new Date(T0 + minute * MIN),
    result,
    mode: "ranked",
    characterKey: "aki",
    characterName: "A.K.I.",
    sessionId: null,
    opponentCharacterKey: "ken",
    opponentCharacterName: "Ken",
    ...over,
  } satisfies AnalyticsMatchRow;
}
/** `spec` results, one per `step` minutes from `start`. */
const seqOf = (spec: string, start = 0, over: Partial<AnalyticsMatchRow> = {}, step = 4) =>
  [...spec].map((c, i) => m(R[c]!, start + i * step, over));

const rec = computeRecord([]);
const matchupSignal = (own: CharacterKey, opp: CharacterKey): MatchupUnderperformanceSignal => ({
  id: `matchup:${own}:${opp}`,
  type: "matchup-underperformance",
  direction: "down",
  destination: "#matchups",
  sample: 10,
  characterKey: own,
  characterName: own,
  opponentKey: opp,
  opponentName: opp,
  matchup: rec,
  baseline: rec,
  deltaPp: -20,
});
const recentSignal: RecentFormShiftSignal = {
  id: "recent:20v20",
  type: "recent-form-shift",
  direction: "down",
  destination: "#recent",
  sample: 10,
  window: 20,
  recent: rec,
  previous: rec,
  deltaPp: -20,
};
const halvesSignal: SessionHalfShiftSignal = {
  id: "session-halves",
  type: "session-half-shift",
  direction: "down",
  destination: "#sessions",
  sample: 20,
  eligibleSegments: 5,
  first: rec,
  second: rec,
  deltaPp: -20,
};
const postLossSignal: PostLossTransitionSignal = {
  id: "post-loss",
  type: "post-loss-transition",
  direction: "down",
  destination: "#sessions",
  sample: 10,
  postLoss: { total: 10, nextWins: 1, rate: 10 },
  postWin: { total: 10, nextWins: 9, rate: 90 },
  deltaPp: -80,
};
const exposureSignal = (opp: CharacterKey): HighExposureOpponentSignal => ({
  id: `exposure:${opp}`,
  type: "high-exposure-opponent",
  direction: "neutral",
  destination: "#matchups",
  sample: 30,
  opponentKey: opp,
  opponentName: opp,
  record: rec,
  share: 40,
});

function select(signals: ReviewSignal[], rows: AnalyticsMatchRow[]): ReviewReplaySelection[] {
  const newest = [...rows].sort(newestFirst);
  return computeReviewReplaySelections({
    signals,
    newest,
    segments: segmentSessionMatchRows(newest),
  });
}
const ids = (s: ReviewReplaySelection, group?: string) =>
  s.groups
    .filter((g) => !group || g.id === group)
    .flatMap((g) => g.candidates.map((c) => c.externalMatchId));
const byId = (rows: AnalyticsMatchRow[]) => new Map(rows.map((r) => [r.externalMatchId, r]));

describe("general", () => {
  it("one selection per selected signal, in the signals' order (never re-ranked)", () => {
    const rows = seqOf("WLWLWL", 0, { opponentCharacterKey: "jp", opponentCharacterName: "JP" });
    const signals = [exposureSignal("jp"), matchupSignal("aki", "jp"), recentSignal];
    expect(select(signals, rows).map((s) => s.signalId)).toEqual([
      "exposure:jp",
      "matchup:aki:jp",
      "recent:20v20",
    ]);
    expect(select([], rows)).toEqual([]);
  });

  it("deterministic for any input order; ties broken by external id (descending)", () => {
    const tied = [
      m("win", 0, { externalMatchId: "AAA" }),
      m("loss", 0, { externalMatchId: "CCC" }),
      m("win", 0, { externalMatchId: "BBB" }),
      m("loss", 0, { externalMatchId: "DDD" }),
    ];
    const a = select([matchupSignal("aki", "ken")], tied);
    const b = select([matchupSignal("aki", "ken")], [...tied].reverse());
    expect(a).toEqual(b);
    expect(ids(a[0]!)).toEqual(["DDD", "CCC", "BBB"]);
  });

  it("empty selection is safe (no groups, zero total)", () => {
    const [s] = select([matchupSignal("aki", "jp")], seqOf("WLWL")); // no JP rows
    expect(s).toEqual({
      signalId: "matchup:aki:jp",
      signalType: "matchup-underperformance",
      groups: [],
      totalCandidates: 0,
    });
  });

  it("candidates carry only analytics row fields (no opponent player identity, no rating)", () => {
    const [s] = select([matchupSignal("aki", "ken")], seqOf("WLW"));
    const keys = Object.keys(s!.groups[0]!.candidates[0]!).sort();
    expect(keys).toEqual(
      [
        "characterKey",
        "characterName",
        "externalMatchId",
        "opponentCharacterKey",
        "opponentCharacterName",
        "playedAt",
        "result",
        "role",
      ].sort(),
    );
    expect(JSON.stringify(s)).not.toMatch(/opponentName|opponent_name|rating|rank|cfn|session/i);
  });
});

describe("matchup underperformance", () => {
  it("exact own × opponent pair, decided only, wins AND losses, newest 3", () => {
    const rows = [
      ...seqOf("LWDLW", 0, { opponentCharacterKey: "jp", opponentCharacterName: "JP" }),
      ...seqOf("LLL", 100), // other opponent
      ...seqOf("LLL", 200, {
        characterKey: "juri",
        characterName: "Juri",
        opponentCharacterKey: "jp",
      }),
    ];
    const [s] = select([matchupSignal("aki", "jp")], rows);
    const picked = ids(s!).map((id) => byId(rows).get(id)!);
    expect(picked).toHaveLength(REPLAY_LIMITS.matchup);
    // newest first within A.K.I. vs JP: W(16) L(12) [D(8) skipped] W(4)
    expect(picked.map((r) => r.result)).toEqual(["win", "loss", "win"]);
    expect(picked.every((r) => r.characterKey === "aki" && r.opponentCharacterKey === "jp")).toBe(
      true,
    );
    expect(s!.groups[0]!.candidates.every((c) => c.role === "focus")).toBe(true);
    expect(s!.groups.map((g) => g.id)).toEqual(["matchup"]);
  });
});

describe("recent form shift", () => {
  // 45 rows, oldest → newest. Newest window = rows[44..25], previous = rows[24..5].
  const build = (spec: string) => seqOf(spec, 0, {}, 1);

  it("uses the exact newest [0..19] and previous [20..39] windows; never overlapping; ≤ 2 each", () => {
    const rows = build("L".repeat(45));
    const newest = [...rows].sort(newestFirst);
    const [s] = select([recentSignal], rows);
    expect(ids(s!, "recent")).toEqual(newest.slice(0, 2).map((r) => r.externalMatchId));
    expect(ids(s!, "previous")).toEqual(newest.slice(20, 22).map((r) => r.externalMatchId));
    const recentSet = new Set(newest.slice(0, 20).map((r) => r.externalMatchId));
    const previousSet = new Set(newest.slice(20, 40).map((r) => r.externalMatchId));
    expect(ids(s!, "recent").every((id) => recentSet.has(id))).toBe(true);
    expect(ids(s!, "previous").every((id) => previousSet.has(id))).toBe(true);
    expect(s!.totalCandidates).toBe(4);
    expect(s!.groups.map((g) => g.id)).toEqual(["recent", "previous"]);
  });

  it("draws are skipped as candidates but keep their window slot (no back-fill across windows)", () => {
    // Previous window (newest index 20..39) = 19 draws + 1 decided at its OLDEST position (39);
    // newest index 40..44 (outside both windows) are all decided.
    const oldestToNewest = "WWWWW" + "L" + "D".repeat(19) + "W".repeat(20);
    const rows = build(oldestToNewest);
    const newest = [...rows].sort(newestFirst);
    const [s] = select([recentSignal], rows);
    expect(ids(s!, "previous")).toEqual([newest[39]!.externalMatchId]);
    // Recent window: 20 decided → 2 newest.
    expect(ids(s!, "recent")).toEqual(newest.slice(0, 2).map((r) => r.externalMatchId));
  });
});

describe("session half shift", () => {
  const session = (spec: string, start: number, id: string) =>
    seqOf(spec, start, { sessionId: id });

  it("most recent eligible segment with a decided match in both halves; its newest decided per half", () => {
    const older = session("WWLL", 0, "s1");
    const newer = session("LWDWLD", 1000, "s2"); // cut = 3: [L W D] [W L D]
    const [s] = select([halvesSignal], [...older, ...newer]);
    expect(ids(s!, "first-half")).toEqual([newer[1]!.externalMatchId]); // W (newest decided)
    expect(ids(s!, "second-half")).toEqual([newer[4]!.externalMatchId]); // L
    expect(s!.groups.map((g) => g.id)).toEqual(["first-half", "second-half"]);
  });

  it("exact ceil / floor split: the middle match of odd counts belongs to the first half", () => {
    const seg = session("DDLWW", 0, "s1"); // cut = 3: [D D L] [W W]
    const [s] = select([halvesSignal], seg);
    expect(ids(s!, "first-half")).toEqual([seg[2]!.externalMatchId]);
    expect(ids(s!, "second-half")).toEqual([seg[4]!.externalMatchId]);
  });

  it("segments need ≥ 4 matches and a decided match in BOTH halves (else an older one)", () => {
    const eligible = session("WLWL", 0, "s1");
    const tooShort = session("WLW", 1000, "s2");
    const drawsInSecond = session("WLDD", 2000, "s3");
    const [s] = select([halvesSignal], [...eligible, ...tooShort, ...drawsInSecond]);
    const picked = ids(s!);
    expect(picked.every((id) => eligible.some((r) => r.externalMatchId === id))).toBe(true);
  });

  it("≥ 45 min splits a session into separate segments; candidates never cross them", () => {
    // One real session: 4 matches, a 45-min gap, 4 matches → two segments of 4.
    const first = seqOf("WWLL", 0, { sessionId: "s1" }, 4);
    const second = seqOf("LLWW", 12 + 45, { sessionId: "s1" }, 4);
    const [s] = select([halvesSignal], [...first, ...second]);
    expect(ids(s!).every((id) => second.some((r) => r.externalMatchId === id))).toBe(true);
    // 44 min would be ONE segment of 8: halves of all 8.
    const joined = seqOf("WWLLLLWW", 0, { sessionId: "s2" }, 4).map((r, i) =>
      i >= 4 ? { ...r, playedAt: new Date(r.playedAt.getTime() + 32 * MIN) } : r,
    );
    expect(segmentSessionMatchRows(joined)).toHaveLength(1);
  });

  it("session_id NULL never participates", () => {
    const [s] = select([halvesSignal], seqOf("WLWLWLWL", 0, { sessionId: null }));
    expect(s!.groups).toEqual([]);
  });
});

describe("post-loss transition", () => {
  it("loss → the IMMEDIATE next match (any result); the 2 most recent pairs, pair in play order", () => {
    const rows = seqOf("LWLDLLW", 0, { sessionId: "s1" });
    const [s] = select([postLossSignal], rows);
    // Losses with a next match: idx0→1, 2→3 (D), 4→5 (L), 5→6. Newest two: 5→6, 4→5.
    expect(s!.groups.map((g) => g.id)).toEqual(["transition-1", "transition-2"]);
    expect(ids(s!, "transition-1")).toEqual([rows[5]!.externalMatchId, rows[6]!.externalMatchId]);
    expect(ids(s!, "transition-2")).toEqual([rows[4]!.externalMatchId, rows[5]!.externalMatchId]);
    expect(s!.groups[0]!.candidates.map((c) => c.role)).toEqual([
      "transition-loss",
      "transition-next",
    ]);
    expect(s!.totalCandidates).toBe(4);
  });

  it("a draw or a loss can be the next match; never searches further for a win", () => {
    const rows = seqOf("LDW", 0, { sessionId: "s1" });
    const [s] = select([postLossSignal], rows);
    expect(ids(s!, "transition-1")).toEqual([rows[0]!.externalMatchId, rows[1]!.externalMatchId]);
  });

  it("never crosses a real session, a ≥ 45 min split, nor uses session_id NULL", () => {
    const crossSession = [
      ...seqOf("L", 0, { sessionId: "a" }),
      ...seqOf("W", 4, { sessionId: "b" }),
    ];
    expect(select([postLossSignal], crossSession)[0]!.groups).toEqual([]);
    const crossGap = [m("loss", 0, { sessionId: "s" }), m("win", 45, { sessionId: "s" })];
    expect(select([postLossSignal], crossGap)[0]!.groups).toEqual([]);
    const within = [m("loss", 0, { sessionId: "s" }), m("win", 44, { sessionId: "s" })];
    expect(select([postLossSignal], within)[0]!.totalCandidates).toBe(2);
    expect(select([postLossSignal], seqOf("LWLW", 0, { sessionId: null }))[0]!.groups).toEqual([]);
    // A final loss has no next match.
    expect(select([postLossSignal], seqOf("WL", 0, { sessionId: "s" }))[0]!.groups).toEqual([]);
  });
});

describe("high exposure opponent", () => {
  it("exact opponent character, any result, newest 3, session_id NULL allowed", () => {
    const rows = [
      ...seqOf("DLW", 0, { opponentCharacterKey: "jp", opponentCharacterName: "JP" }),
      ...seqOf("WWW", 100, { opponentCharacterKey: "ken" }),
      ...seqOf("L", 200, {
        opponentCharacterKey: "jp",
        opponentCharacterName: "JP",
        characterKey: "juri",
      }),
    ];
    const [s] = select([exposureSignal("jp")], rows);
    const picked = ids(s!).map((id) => byId(rows).get(id)!);
    expect(picked.map((r) => r.result)).toEqual(["loss", "win", "loss"]);
    expect(picked.every((r) => r.opponentCharacterKey === "jp")).toBe(true);
    expect(s!.groups.map((g) => g.id)).toEqual(["exposure"]);
  });
});

describe("through computeAnalyticsDetailed (same dataset as the signals)", () => {
  // 8 sessions with a strong first half and weak second half + a JP-heavy loss pattern.
  const opp = (i: number, r: string) =>
    r === "L" && i % 2 === 0 ? "jp" : i % 5 === 0 ? "juri" : "ken";
  const build = () => {
    const rows: AnalyticsMatchRow[] = [];
    for (let s = 0; s < 8; s++) {
      [..."WWWLWWWWLLLWLLLL"].forEach((c, i) => {
        const o = opp(i, c);
        rows.push(
          m(R[c]!, s * 1440 + i * 4, {
            sessionId: `s${s}`,
            opponentCharacterKey: o,
            opponentCharacterName: o,
          }),
        );
      });
    }
    // A second own character that must never leak into an A.K.I.-filtered selection.
    rows.push(
      ...seqOf("LLLLLL", 20_000, { characterKey: "juri", characterName: "Juri", sessionId: "j" }),
    );
    return rows;
  };

  it("aligned with the selected signals, only selected ones, never more than the limits", () => {
    const { summary, reviewReplays } = computeAnalyticsDetailed(build());
    expect(summary.review.totalEligible).toBeGreaterThan(summary.review.signals.length);
    expect(reviewReplays.map((r) => r.signalId)).toEqual(summary.review.signals.map((s) => s.id));
    for (const sel of reviewReplays) expect(sel.totalCandidates).toBeLessThanOrEqual(4);
  });

  it("the own-character filter is respected by every selection", () => {
    const { reviewReplays } = computeAnalyticsDetailed(build(), { character: "aki" });
    const all = reviewReplays.flatMap((s) => s.groups.flatMap((g) => g.candidates));
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.characterKey === "aki")).toBe(true);
  });

  it("deterministic: same rows (any order) ⇒ identical selections", () => {
    const rows = build();
    expect(computeAnalyticsDetailed([...rows].reverse()).reviewReplays).toEqual(
      computeAnalyticsDetailed(rows).reviewReplays,
    );
  });
});
