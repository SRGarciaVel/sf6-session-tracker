/**
 * PR A — the live projection derives the current Master tier for active sessions and the idle
 * profile, and preserves ended sessions' stored labels. Built through the REAL engine
 * (summarizeSession / computeCharacterProgress) and toLiveSessionState.
 */
import { describe, expect, it } from "vitest";
import {
  computeCharacterProgress,
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionMatch,
  type SessionStatus,
} from "@/domain/session/engine";
import type { RatingPoint } from "@/domain/sf6/types";
import { toLiveSessionState } from "./state";

const T0 = new Date("2026-10-07T20:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const mr = (value: number, rank: string | null = null): RatingPoint => ({
  system: "mr",
  value,
  rank,
  rankTier: null,
  phase: null,
});
const lp = (value: number, rank: string | null = null): RatingPoint => ({
  system: "lp",
  value,
  rank,
  rankTier: null,
  phase: null,
});
const match = (i: number, key = "gouki"): SessionMatch => ({
  externalMatchId: `m${i}`,
  playedAt: at(3 * (i + 1)),
  mode: "ranked",
  result: "win",
  characterKey: key,
  characterName: key === "gouki" ? "Akuma" : "Juri",
  opponentCharacter: null,
  opponentName: null,
  ratingBefore: null,
  ratingAfter: null,
});

function live(
  status: SessionStatus,
  opts: {
    baseline?: RatingPoint | null;
    current: Array<[string, RatingPoint]>;
    /** Other characters known from the session-start profile (they need a baseline to exist). */
    others?: Array<[string, RatingPoint]>;
  },
) {
  const known: Array<[string, RatingPoint]> = [
    ...(opts.baseline ? [["gouki", opts.baseline] as [string, RatingPoint]] : []),
    ...(opts.others ?? []),
  ];
  const baselines: CharacterBaseline[] = known.map(([key, rating]) => ({
    characterKey: key,
    characterName: key === "gouki" ? "Akuma" : "Juri",
    source: "session_start",
    rating,
    capturedAt: T0,
  }));
  const current: CharacterSnapshot[] = opts.current.map(([key, rating]) => ({
    characterKey: key,
    characterName: key === "gouki" ? "Akuma" : "Juri",
    rating,
    observedAt: at(60),
  }));
  const summary = summarizeSession({
    status,
    ratingModel: "per_character",
    baseline: {
      startedAt: T0,
      endedAt: status === "ended" ? at(90) : null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: { modes: ["ranked"] },
    },
    matches: [0, 1, 2, 3, 4, 5, 6].map((i) => match(i)),
    characterBaselines: baselines,
    current,
    favoriteCharacterKey: null,
  });
  return toLiveSessionState("s1", summary, { characters: [], activeCharacterKey: null });
}
const akuma = (s: ReturnType<typeof live>) => s.characters.find((c) => c.characterKey === "gouki");

describe("live Master tier (active / idle)", () => {
  it("the reported case: 1605 MR with no stored rank ⇒ High Master (no more '—')", () => {
    const c = akuma(live("active", { current: [["gouki", mr(1605)]] }));
    expect(c?.current).toEqual({ system: "mr", value: 1605, rank: "High Master" });
  });

  it.each([
    [1589, "Master"],
    [1600, "High Master"],
    [1712, "Grand Master"],
    [1810, "Ultimate Master"],
  ] as const)("active session, MR %i ⇒ %s", (value, label) => {
    expect(akuma(live("active", { current: [["gouki", mr(value)]] }))?.current?.rank).toBe(label);
  });

  it("the initial point of an ACTIVE session uses the same current rules (no mixed thresholds)", () => {
    const c = akuma(
      live("active", { baseline: mr(1590, "Master"), current: [["gouki", mr(1605)]] }),
    );
    expect(c?.initial?.rank).toBe("Master");
    expect(c?.current?.rank).toBe("High Master");
    expect(c?.delta).toBe(15); // deltas untouched by PR A
  });

  it("LP keeps evidence-backed labels only; never a Master tier", () => {
    const s = live("active", {
      current: [
        ["gouki", lp(226_779)],
        ["juri", lp(19_704, "Diamond 1")],
      ],
      others: [["juri", lp(19_600, "Diamond 1")]],
    });
    expect(akuma(s)?.current?.rank).toBeNull();
    expect(s.characters.find((c) => c.characterKey === "juri")?.current?.rank).toBe("Diamond 1");
  });

  it("idle (no session): current data ⇒ current tiers", () => {
    const [p] = computeCharacterProgress({
      baselines: [
        {
          characterKey: "gouki",
          characterName: "Akuma",
          source: "prior_snapshot",
          rating: mr(1650),
          capturedAt: T0,
        },
      ],
      matches: [],
      current: [],
    });
    const s = toLiveSessionState(null, null, {
      characters: p ? [p] : [],
      activeCharacterKey: "gouki",
    });
    expect(akuma(s)?.current?.rank).toBe("High Master");
  });

  it("high MR never becomes Legend (no authoritative leaderboard signal exists)", () => {
    expect(akuma(live("active", { current: [["gouki", mr(2400)]] }))?.current?.rank).toBe(
      "Ultimate Master",
    );
  });
});

describe("ended sessions preserve their historical labels", () => {
  it("a frozen 1605 with no stored rank stays unlabelled (no retroactive tier)", () => {
    const c = akuma(live("ended", { current: [["gouki", mr(1605)]] }));
    expect(c?.current?.rank).toBeNull();
  });

  it("a frozen 1712 stored as 'Master' stays 'Master' (today's thresholds don't rewrite history)", () => {
    const c = akuma(
      live("ended", { baseline: mr(1650, "Master"), current: [["gouki", mr(1712, "Master")]] }),
    );
    expect(c?.initial?.rank).toBe("Master");
    expect(c?.current?.rank).toBe("Master");
  });

  it("the same data, active vs ended: only the active session derives", () => {
    const data = { current: [["gouki", mr(1712, "Master")]] as Array<[string, RatingPoint]> };
    expect(akuma(live("active", data))?.current?.rank).toBe("Grand Master");
    expect(akuma(live("ended", data))?.current?.rank).toBe("Master");
  });
});
