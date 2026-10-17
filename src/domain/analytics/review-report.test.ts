import { describe, expect, it } from "vitest";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import { computeAnalytics, type AnalyticsMatchRow, type AnalyticsSummary } from "./aggregate";
import { selectReviewSignals } from "./review";
import {
  buildReviewReport,
  hasReviewPriorities,
  isoDate,
  reviewReportFilename,
  type ReviewReportInput,
} from "./review-report";

const T0 = Date.parse("2026-09-01T18:00:00Z");
const NOW = new Date("2026-10-16T06:43:21Z");
let seq = 0;
const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
  externalMatchId: `rr${String(++seq).padStart(6, "0")}`,
  playedAt: new Date(T0 + seq * 4 * 60_000),
  result,
  mode: "ranked",
  characterKey: "aki",
  characterName: "A.K.I.",
  sessionId: null,
  opponentCharacterKey: "ken",
  opponentCharacterName: "Ken",
  ...over,
});
const pair = (own: CharacterKey, ownName: string, opp: CharacterKey, w: number, l: number) =>
  [...Array<MatchResult>(w).fill("win"), ...Array<MatchResult>(l).fill("loss")].map((r) =>
    row(r, {
      characterKey: own,
      characterName: ownName,
      opponentCharacterKey: opp,
      opponentCharacterName: opp.toUpperCase(),
    }),
  );

/** 4 matchup signals (A.K.I. + Juri vs JP / Dee Jay), recent, exposure: > 3 eligible. */
const MANY = [
  ...pair("aki", "A.K.I.", "jp", 2, 10),
  ...pair("aki", "A.K.I.", "dee_jay", 2, 10),
  ...pair("juri", "Juri", "jp", 2, 10),
  ...pair("aki", "A.K.I.", "ken", 40, 0),
  ...pair("juri", "Juri", "ken", 30, 0),
];

function input(
  rows: AnalyticsMatchRow[],
  character: CharacterKey | null = null,
  summary?: AnalyticsSummary,
): ReviewReportInput {
  return {
    range: "90d",
    mode: "ranked",
    character,
    characters: [
      { characterKey: "aki", characterName: "A.K.I." },
      { characterKey: "juri", characterName: "Juri" },
    ],
    from: new Date(NOW.getTime() - 90 * 86_400_000),
    generatedAt: NOW,
    summary: summary ?? computeAnalytics(rows, { character }),
  };
}

function assertFinite(value: unknown, path = "$"): void {
  if (typeof value === "number") expect(Number.isFinite(value), path).toBe(true);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${path}[${i}]`));
  else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) assertFinite(v, `${path}.${k}`);
  }
}

describe("buildReviewReport", () => {
  it("1/3. preserves the filters / context; no character ⇒ null name (never a fake character)", () => {
    const report = buildReviewReport(input(MANY));
    expect(report.context).toEqual({
      range: "90d",
      mode: "ranked",
      character: null,
      characterName: null,
      from: new Date(NOW.getTime() - 90 * 86_400_000),
      generatedAt: NOW,
    });
  });

  it("2. selected character ⇒ its display name from the player's own characters", () => {
    const report = buildReviewReport(input(MANY, "aki"));
    expect(report.context).toMatchObject({ character: "aki", characterName: "A.K.I." });
  });

  it("4. the snapshot is copied from the analytics summary (no new metric)", () => {
    const i = input(MANY);
    const report = buildReviewReport(i);
    expect(report.snapshot.record).toBe(i.summary.overall);
    expect(report.snapshot).toMatchObject({
      sessions: i.summary.sessions.sessions,
      outsideSessions: i.summary.sessions.outsideSessions,
      firstPlayedAt: i.summary.firstPlayedAt,
      lastPlayedAt: i.summary.lastPlayedAt,
    });
  });

  it("5. priorities are EXACTLY the selected review signals (same objects, same order)", () => {
    const i = input(MANY);
    const report = buildReviewReport(i);
    expect(i.summary.review.signals.length).toBe(3);
    expect(report.priorities.map((p) => p.signal)).toEqual(i.summary.review.signals);
    report.priorities.forEach((p, idx) => {
      expect(p.signal).toBe(i.summary.review.signals[idx]); // never recomputed
      expect(p.index).toBe(idx + 1);
    });
  });

  it("5b. evidence is the Review evidence, not a recomputation (same-character baseline)", () => {
    const i = input(MANY);
    const report = buildReviewReport(i);
    const aki = report.priorities.find((p) => p.signal.id === "matchup:aki:dee_jay")?.signal;
    expect(aki?.type).toBe("matchup-underperformance");
    if (aki?.type !== "matchup-underperformance") return;
    // A.K.I. baseline (44–20), never the cross-character account record (76–30).
    expect(aki.baseline).toMatchObject({ wins: 44, losses: 20 });
    expect(i.summary.overall).toMatchObject({ wins: 76, losses: 30 });
  });

  it("6. omittedPriorities = totalEligible − selected", () => {
    const i = input(MANY);
    const report = buildReviewReport(i);
    expect(i.summary.review.totalEligible).toBeGreaterThan(3);
    expect(report.omittedPriorities).toBe(i.summary.review.totalEligible - 3);
    expect(report.priorities).toHaveLength(3); // never all eligible signals
  });

  it("7. zero signals ⇒ empty priorities, nothing to export", () => {
    const report = buildReviewReport(input([row("win"), row("loss")]));
    expect(report.priorities).toEqual([]);
    expect(report.omittedPriorities).toBe(0);
    expect(hasReviewPriorities(report)).toBe(false);
    expect(hasReviewPriorities(buildReviewReport(input(MANY)))).toBe(true);
  });

  it("8/9. no rating data and no opponent player names", () => {
    const json = JSON.stringify(buildReviewReport(input(MANY)));
    expect(json).not.toMatch(
      /rating|"lp"|"mr"|masterRate|leaguePoints|"rank"|opponentRank|rankTier/i,
    );
    expect(json).not.toMatch(/opponent_name|opponentPlayer|cfn/i);
  });

  it("10. no NaN / Infinity (also draws-only)", () => {
    for (const rows of [MANY, [], [row("draw"), row("draw")]]) {
      const report = buildReviewReport(input(rows));
      assertFinite(report);
      expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/);
    }
  });

  it("11. deterministic: same input ⇒ deep-equal report", () => {
    expect(buildReviewReport(input(MANY))).toEqual(buildReviewReport(input([...MANY].reverse())));
  });

  it("a hand-made summary with more eligible than selected still exports only the selection", () => {
    const i = input(MANY);
    const everything = selectReviewSignals(i.summary.review.signals);
    const summary = {
      ...i.summary,
      review: { signals: everything.signals.slice(0, 1), totalEligible: 5 },
    };
    const report = buildReviewReport({ ...i, summary });
    expect(report.priorities).toHaveLength(1);
    expect(report.omittedPriorities).toBe(4);
  });
});

describe("reviewReportFilename", () => {
  const ctx = buildReviewReport(input(MANY)).context;

  it("all characters / selected character, deterministic and safe", () => {
    expect(reviewReportFilename(ctx)).toBe("sst-review-all-characters-ranked-90d-2026-10-16.pdf");
    expect(reviewReportFilename({ ...ctx, character: "aki" })).toBe(
      "sst-review-aki-ranked-90d-2026-10-16.pdf",
    );
    expect(reviewReportFilename({ ...ctx, character: "dee_jay", mode: "all", range: "all" })).toBe(
      "sst-review-dee-jay-all-all-2026-10-16.pdf",
    );
  });

  it("only [a-z0-9-] (no quotes, slashes, ids or names)", () => {
    const evil = reviewReportFilename({ ...ctx, character: '../"x"\r\nY' as CharacterKey });
    expect(evil).toMatch(/^sst-review-[a-z0-9-]+\.pdf$/);
  });

  it("UTC date, independent of the server timezone", () => {
    expect(isoDate(new Date("2026-10-16T23:59:59Z"))).toBe("2026-10-16");
  });
});
