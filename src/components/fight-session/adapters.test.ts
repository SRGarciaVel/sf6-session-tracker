/**
 * Phase 5.6B1 — adapters map real engine output to the Fight Session props without recomputing
 * anything; only presentation decisions (status word, «—» for an undecided win rate, no hold in an
 * ended session) live here.
 */
import { describe, expect, it } from "vitest";
import { assessCompanion, type CompanionSignals } from "@/domain/companion/readiness";
import { pickRatingCharacter } from "@/domain/overlay/state";
import {
  activityFromMatches,
  companionStatus,
  ratingFromCharacter,
  scoreboardFromSession,
  sessionIndicatorStatus,
} from "./adapters";
import { engineSession } from "./test-support";

const NOW = Date.parse("2026-10-21T20:40:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const signals: CompanionSignals = {
  required: true,
  deviceCount: 1,
  lastSeenAt: ago(10_000),
  installedVersion: "0.4.0",
  profileObservedAt: ago(30_000),
  matchesObservedAt: ago(10_000),
  hasProfile: true,
  characterCount: 2,
  maxAgeMs: 300_000,
  serverTime: new Date(NOW).toISOString(),
};
const ready = assessCompanion(signals, NOW);
const quiet = assessCompanion(
  { ...signals, lastSeenAt: ago(6 * 60_000), matchesObservedAt: ago(6 * 60_000) },
  NOW,
);
const unpaired = assessCompanion(
  {
    ...signals,
    deviceCount: 0,
    lastSeenAt: null,
    profileObservedAt: null,
    matchesObservedAt: null,
  },
  NOW,
);

describe("session indicator status (all supported states)", () => {
  const none = { status: "none" as const };
  const active = { status: "active" as const };
  const ended = { status: "ended" as const };
  it("no session: ready when the Companion data allows a start, blocked otherwise", () => {
    expect(sessionIndicatorStatus({ session: none, readiness: ready, tracker: null })).toBe(
      "ready",
    );
    expect(sessionIndicatorStatus({ session: none, readiness: unpaired, tracker: null })).toBe(
      "blocked",
    );
    // Not in companion mode: nothing to check ⇒ ready (never invents a Companion state).
    expect(sessionIndicatorStatus({ session: none, readiness: null, tracker: null })).toBe("ready");
  });
  it("active: live, or degraded when tracking has no recent data", () => {
    expect(
      sessionIndicatorStatus({ session: active, readiness: ready, tracker: { state: "ok" } }),
    ).toBe("live");
    expect(
      sessionIndicatorStatus({ session: active, readiness: quiet, tracker: { state: "ok" } }),
    ).toBe("degraded");
    expect(
      sessionIndicatorStatus({ session: active, readiness: ready, tracker: { state: "degraded" } }),
    ).toBe("degraded");
    expect(
      sessionIndicatorStatus({ session: active, readiness: null, tracker: { state: "starting" } }),
    ).toBe("live");
  });
  it("ended", () => {
    expect(sessionIndicatorStatus({ session: ended, readiness: unpaired, tracker: null })).toBe(
      "ended",
    );
  });
});

describe("scoreboard props", () => {
  it("passes the engine's numbers through (W/L/draws/games/win rate)", () => {
    const s = engineSession({ results: ["win", "win", "loss", "win", "loss", "win", "win"] });
    expect(scoreboardFromSession(s)).toEqual({
      wins: 5,
      losses: 2,
      draws: 0,
      games: 7,
      winRate: s.winRate,
    });
    expect(s.winRate).toBe(71.4);
  });
  it("zero matches ⇒ win rate unknown (null), not 0", () => {
    expect(scoreboardFromSession(engineSession({ results: [] })).winRate).toBeNull();
  });
  it("only draws ⇒ still unknown", () => {
    const s = engineSession({ results: ["draw"] });
    expect(scoreboardFromSession(s)).toMatchObject({ games: 1, draws: 1, winRate: null });
  });
});

describe("rating props (one character, engine semantics)", () => {
  it("confirmed: start → current with the engine's session delta", () => {
    const s = engineSession({ results: ["win", "win"], snapshot: { value: 1594, after: 1 } });
    expect(ratingFromCharacter(pickRatingCharacter(s), s.status)).toEqual({
      characterName: "Ryu",
      system: "mr",
      initial: 1571,
      current: 1594,
      delta: 23,
      pending: false,
    });
  });
  it("active + post-match rating not observed yet ⇒ last confirmed value, pending", () => {
    const s = engineSession({ results: ["win", "win"], snapshot: { value: 1583, after: 0 } });
    expect(ratingFromCharacter(pickRatingCharacter(s), s.status)).toMatchObject({
      current: 1583,
      delta: 12,
      pending: true,
    });
  });
  it("ended session never holds: unknown final rating stays unknown", () => {
    const s = engineSession({ results: ["win", "loss"], status: "ended", snapshot: null });
    expect(ratingFromCharacter(pickRatingCharacter(s), s.status)).toMatchObject({
      current: null,
      delta: null,
      pending: false,
    });
  });
  it("unknown baseline ⇒ initial null, delta null", () => {
    const s = engineSession({
      results: ["win"],
      baseline: null,
      snapshot: { value: 1600, after: 0 },
    });
    expect(ratingFromCharacter(pickRatingCharacter(s), s.status)).toMatchObject({
      initial: null,
      current: 1600,
      delta: null,
    });
  });
  it("LP keeps its system", () => {
    const s = engineSession({
      results: ["win"],
      system: "lp",
      baseline: 21850,
      snapshot: { value: 21950, after: 0 },
    });
    expect(ratingFromCharacter(pickRatingCharacter(s), s.status)).toMatchObject({
      system: "lp",
      delta: 100,
    });
  });
  it("no character ⇒ null", () => {
    expect(ratingFromCharacter(null, "active")).toBeNull();
  });
});

describe("companion status and activity", () => {
  it("outside companion mode nothing is claimed", () => {
    expect(companionStatus({ ...ready, required: false }, null)).toEqual({
      link: null,
      buckler: null,
      lastSyncAt: null,
    });
  });
  it("disconnected Companion is reported as such", () => {
    expect(companionStatus(unpaired, null)).toEqual({
      link: "notPaired",
      buckler: "never",
      lastSyncAt: null,
    });
  });
  it("match rows → activity items (Date → ISO, nothing added)", () => {
    const playedAt = new Date("2026-10-21T19:36:00Z");
    expect(
      activityFromMatches([
        {
          id: "a",
          result: "loss",
          characterName: "Ryu",
          opponentCharacter: null,
          opponentName: "X",
          playedAt,
        },
      ]),
    ).toEqual([
      {
        id: "a",
        result: "loss",
        characterName: "Ryu",
        opponentCharacter: null,
        opponentName: "X",
        playedAt: "2026-10-21T19:36:00.000Z",
      },
    ]);
  });
});
