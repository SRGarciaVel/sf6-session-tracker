/**
 * Phase 5.4C — Legend in the server domain: the authoritative position rule, current display rank
 * (ended sessions frozen), the position ↔ observation binding in the live state, and the Rank
 * Progress Legend states (chase / boundary / legend / stale fallback). LP is untouched.
 */
import { describe, expect, it } from "vitest";
import type { CharacterProgress, SessionSummary } from "@/domain/session/engine";
import { EMPTY_STATS } from "@/domain/session/engine";
import { resolveRankProgressView } from "@/domain/overlay/rank-progress";
import { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } from "@/domain/overlay/rank-progress";
import { toLiveSessionState } from "@/domain/overlay/state";
import { masterTierFromMr, resolveDisplayRank } from "./master-tier";
import { rankProgress } from "./rank-progress";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const fresh = { cutoffMr: 2196, observedAt: new Date(NOW - 10 * 60_000).toISOString() };
const stale = { cutoffMr: 2196, observedAt: new Date(NOW - 31 * 60_000).toISOString() };
const mr = (value: number, position: number | null, cutoff: typeof fresh | null = fresh) =>
  rankProgress({ system: "mr", value }, "auto", { position, cutoff, nowMs: NOW });

describe("authoritative Legend rule (position only)", () => {
  it.each([
    [2241, 327, "legend"],
    [2196, 497, "legend"],
    [2196, 505, "ultimate-master"],
    [3000, null, "ultimate-master"],
    [2196, null, "ultimate-master"],
    [2300, null, "ultimate-master"],
  ] as const)("%d MR + #%s ⇒ %s", (value, position, tier) => {
    expect(masterTierFromMr(value, { leaderboardPosition: position })).toBe(tier);
  });

  it("no MR value alone ever produces Legend", () => {
    for (let v = 1800; v <= 4000; v += 7) expect(masterTierFromMr(v)).toBe("ultimate-master");
  });

  it("current display rank shows Legend only when deriving (ended sessions stay frozen)", () => {
    const point = { system: "mr" as const, value: 2241, rank: "Master" };
    expect(resolveDisplayRank(point, { derive: true, leaderboardPosition: 327 })).toBe("Legend");
    expect(resolveDisplayRank(point, { derive: true, leaderboardPosition: 505 })).toBe(
      "Ultimate Master",
    );
    expect(resolveDisplayRank(point, { derive: false, leaderboardPosition: 327 })).toBe("Master");
  });
});

describe("live state: a position belongs to ONE observation", () => {
  const progress = (current: number | null, initial: number | null = null): CharacterProgress => ({
    ...EMPTY_STATS,
    recentResults: [],
    characterKey: "ryu",
    characterName: "Ryu",
    games: 0,
    lastPlayedAt: null,
    ratingSystem: "mr",
    initial: initial === null ? null : { system: "mr", value: initial },
    current: current === null ? null : { system: "mr", value: current },
    delta: null,
    initialSource: "unknown",
    currentSource: "snapshot",
  });
  const positions = new Map([["ryu", { system: "mr" as const, value: 2241, position: 327 }]]);
  const summary = (status: "active" | "ended", c: CharacterProgress): SessionSummary =>
    ({
      ...EMPTY_STATS,
      recentResults: [],
      status,
      ratingModel: "per_character",
      startedAt: new Date(NOW - 3_600_000),
      endedAt: status === "ended" ? new Date(NOW) : null,
      characters: [c],
      activeCharacterKey: "ryu",
    }) as SessionSummary;

  it("idle / active: same MR as the observation ⇒ position + Legend label", () => {
    const idle = toLiveSessionState(
      null,
      null,
      { characters: [progress(2241)], activeCharacterKey: "ryu" },
      positions,
    );
    expect(idle.characters[0]).toMatchObject({
      leaderboardPosition: 327,
      current: { rank: "Legend" },
    });
    const active = toLiveSessionState(
      "s",
      summary("active", progress(2241)),
      { characters: [], activeCharacterKey: null },
      positions,
    );
    expect(active.characters[0]?.leaderboardPosition).toBe(327);
  });

  it("a newer MR (from a match) never borrows the older observation's position", () => {
    const s = toLiveSessionState(
      "s",
      summary("active", progress(2260)),
      { characters: [], activeCharacterKey: null },
      positions,
    );
    expect(s.characters[0]).toMatchObject({
      leaderboardPosition: null,
      current: { rank: "Ultimate Master" },
    });
  });

  it("an ENDED session is never relabelled from a current position", () => {
    const s = toLiveSessionState(
      "s",
      summary("ended", progress(2241)),
      { characters: [], activeCharacterKey: null },
      positions,
    );
    expect(s.characters[0]?.leaderboardPosition).toBeNull();
    expect(s.characters[0]?.current?.rank).not.toBe("Legend");
  });

  it("the starting rating never shows Legend (baselines carry no position)", () => {
    const s = toLiveSessionState(
      null,
      null,
      { characters: [progress(2241, 2241)], activeCharacterKey: "ryu" },
      positions,
    );
    expect(s.characters[0]?.initial?.rank).toBe("Ultimate Master");
  });
});

describe("Rank Progress Legend states", () => {
  it("A · Ultimate below a fresh cutoff: chase 1800 → 2196, 7 MR to current cutoff", () => {
    const s = mr(2189, 530);
    expect(s).toEqual({
      kind: "legend-chase",
      system: "mr",
      current: { value: 2189, label: "Ultimate Master" },
      position: 530,
      cutoff: { value: 2196, observedAt: fresh.observedAt },
      start: { value: 1800, label: "Ultimate Master" },
      remaining: 7,
      progress: (2189 - 1800) / (2196 - 1800),
    });
  });

  it("B · exactly at the cutoff but #505: NOT Legend, no bar, no '0 MR'", () => {
    const s = mr(2196, 505);
    expect(s).toMatchObject({ kind: "legend-boundary", position: 505, cutoff: { value: 2196 } });
    expect(s).not.toHaveProperty("remaining");
    expect(s).not.toHaveProperty("progress");
  });

  it("C · above the cutoff with unknown position: NOT Legend", () => {
    expect(mr(2200, null)).toMatchObject({ kind: "legend-boundary", position: null });
  });

  it("D · authoritative Legend (#327): terminal, whatever the cutoff", () => {
    for (const cutoff of [fresh, stale, null]) {
      expect(mr(2241, 327, cutoff)).toEqual({
        kind: "legend",
        system: "mr",
        current: { value: 2241, label: "Legend" },
        position: 327,
      });
    }
  });

  it("E/F · stale or missing cutoff ⇒ the 5.4B Ultimate Master terminal (position kept)", () => {
    expect(mr(2134, null, stale)).toEqual({
      kind: "ultimate-master",
      system: "mr",
      current: { value: 2134, label: "Ultimate Master" },
      position: null,
    });
    expect(mr(2189, 530, null)).toMatchObject({ kind: "ultimate-master", position: 530 });
  });

  it("freshness boundary: 30 min exactly is fresh, 30 min + 1 ms is stale", () => {
    const at = (ms: number) => ({ cutoffMr: 2196, observedAt: new Date(NOW - ms).toISOString() });
    expect(mr(2189, 530, at(30 * 60_000)).kind).toBe("legend-chase");
    expect(mr(2189, 530, at(30 * 60_000 + 1)).kind).toBe("ultimate-master");
  });

  it("a nonsensical cutoff (≤ 1800) is ignored", () => {
    expect(mr(1900, null, { cutoffMr: 1700, observedAt: fresh.observedAt }).kind).toBe(
      "ultimate-master",
    );
  });

  it("below Ultimate Master the tiers are unchanged (position irrelevant)", () => {
    expect(mr(1642, 9000)).toMatchObject({
      kind: "progress",
      target: { value: 1700 },
      remaining: 58,
    });
    expect(mr(1742, null)).toMatchObject({ kind: "progress", target: { value: 1800 } });
  });

  it("LP output is unchanged by any Legend context", () => {
    for (const value of [0, 999, 13000, 21950, 24999, 25000]) {
      for (const goal of ["auto", "master"] as const) {
        expect(
          rankProgress({ system: "lp", value }, goal, { position: 327, cutoff: fresh, nowMs: NOW }),
        ).toEqual(rankProgress({ system: "lp", value }, goal));
      }
    }
  });

  it("projection: the selected character's own position + the player's cutoff", () => {
    const session = toLiveSessionState(
      null,
      null,
      {
        characters: [
          {
            ...EMPTY_STATS,
            recentResults: [],
            characterKey: "ryu",
            characterName: "Ryu",
            games: 0,
            lastPlayedAt: null,
            ratingSystem: "mr",
            initial: null,
            current: { system: "mr", value: 2189 },
            delta: null,
            initialSource: "unknown",
            currentSource: "snapshot",
          },
        ],
        activeCharacterKey: "ryu",
      },
      new Map([["ryu", { system: "mr" as const, value: 2189, position: 530 }]]),
    );
    const view = resolveRankProgressView(session, DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, {
      legendCutoff: { ...fresh, lastLegendPosition: 497, firstNonLegendPosition: 505 },
      nowMs: NOW,
    });
    expect(view.state).toMatchObject({ kind: "legend-chase", position: 530, remaining: 7 });
    expect(view.sessionDelta).toBeNull();
  });
});
