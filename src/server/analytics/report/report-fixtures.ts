/**
 * Deterministic analytics datasets for the review-report tests and local PDF QA (test support
 * only; never imported by the route). Each scenario goes through the REAL computeAnalytics, so the
 * signals are the ones the page would show.
 */
import { computeAnalytics, type AnalyticsMatchRow } from "@/domain/analytics/aggregate";
import { buildReviewReport, type ReviewReport } from "@/domain/analytics/review-report";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";

const T0 = Date.parse("2026-08-01T18:00:00Z");
export const REPORT_NOW = new Date("2026-10-16T06:43:21Z");

function builder(prefix: string) {
  let seq = 0;
  const R: Record<string, MatchResult> = { W: "win", L: "loss", D: "draw" };
  const row = (result: MatchResult, over: Partial<AnalyticsMatchRow> = {}): AnalyticsMatchRow => ({
    externalMatchId: `${prefix}${String(++seq).padStart(6, "0")}`,
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
  const seqOf = (spec: string, over: Partial<AnalyticsMatchRow> = {}) =>
    [...spec].map((c) => row(R[c]!, over));
  const pair = (opponent: CharacterKey, name: string, wins: number, losses: number, over = {}) =>
    seqOf("W".repeat(wins) + "L".repeat(losses), {
      opponentCharacterKey: opponent,
      opponentCharacterName: name,
      ...over,
    });
  const sessions = (spec: string, n: number, sid: string, opp: (i: number, r: string) => string) =>
    Array.from({ length: n }, (_, s) => {
      seq += 200;
      return [...spec].map((c, i) => {
        const o = opp(i, c);
        return row(R[c]!, {
          sessionId: `${sid}${s}`,
          opponentCharacterKey: o,
          opponentCharacterName: o === "jp" ? "JP" : o[0]!.toUpperCase() + o.slice(1),
        });
      });
    }).flat();
  return { seqOf, pair, sessions };
}

/** A spread of opponents so no single one reaches the exposure gate. */
const spread = (i: number) => ["ken", "ryu", "juri", "luke", "cammy", "guile"][i % 6]!;

export const REPORT_SCENARIOS = {
  /** 1 signal: recent form up, nothing else qualifies. */
  oneRecentUp: () => {
    const b = builder("a");
    return b.seqOf("L".repeat(14) + "W".repeat(6) + "W".repeat(16) + "L".repeat(4)).map((r, i) => ({
      ...r,
      opponentCharacterKey: spread(i),
      opponentCharacterName: spread(i),
    }));
  },
  /** 1 signal: recent form down. */
  oneRecentDown: () => {
    const b = builder("b");
    return b.seqOf("W".repeat(16) + "L".repeat(4) + "L".repeat(14) + "W".repeat(6)).map((r, i) => ({
      ...r,
      opponentCharacterKey: spread(i),
      opponentCharacterName: spread(i),
    }));
  },
  /** 2 signals: matchup underperformance (A.K.I. vs JP) + high exposure (Ken). */
  matchupExposure: () => {
    const b = builder("c");
    return [...b.pair("jp", "JP", 12, 22), ...b.pair("ken", "Ken", 47, 39)];
  },
  /** 3 selected of 5 eligible: session halves, matchup, post-loss (+ recent, exposure omitted). */
  threeOfFive: () => {
    const b = builder("d");
    const opp = (i: number, r: string) =>
      r === "L" && i % 2 === 0 ? "jp" : i % 5 === 0 ? "juri" : "ken";
    return [
      ...b.sessions("WWWLWWWWLLLWLLLL", 8, "s", opp),
      ...b.sessions("LLWLLLLWLLLLLWLLLLLL", 1, "t", opp),
    ];
  },
  /** 2 signals with very long display names (wrapping / no crash). */
  longNames: () => {
    const b = builder("e");
    const long = {
      characterKey: "aki",
      characterName: "A.K.I. Extremely Long Display Name Variant",
    };
    return [
      ...b.pair("chunli", "Chun-Li Wearing An Unusually Long Costume Name", 12, 22, long),
      ...b.pair("ken", "Ken", 47, 39, long),
    ];
  },
  /** Nothing qualifies. */
  none: () => builder("f").seqOf("WLWLWLD"),
} satisfies Record<string, () => AnalyticsMatchRow[]>;

export type ReportScenario = keyof typeof REPORT_SCENARIOS;

export function scenarioReport(
  scenario: ReportScenario,
  options: { character?: CharacterKey | null } = {},
): ReviewReport {
  const rows = REPORT_SCENARIOS[scenario]();
  const character = options.character ?? null;
  const summary = computeAnalytics(rows, { character });
  const names = new Map(rows.map((r) => [r.characterKey, r.characterName]));
  return buildReviewReport({
    range: "90d",
    mode: "ranked",
    character,
    characters: [...names].map(([characterKey, characterName]) => ({
      characterKey,
      characterName,
    })),
    from: new Date(REPORT_NOW.getTime() - 90 * 86_400_000),
    generatedAt: REPORT_NOW,
    summary,
  });
}
