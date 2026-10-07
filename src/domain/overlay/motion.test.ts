import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREATOR_MOTION,
  MOTION_TOKENS,
  creatorMotionSchema,
  detectOverlayChange,
  isStaleSummary,
  motionProfile,
  parseCreatorMotion,
  summaryKey,
  type OverlaySummary,
} from "./motion";
import { simulationState } from "./preview-simulation";

const base: OverlaySummary = {
  sessionId: "s1",
  scope: "session",
  character: "ryu",
  totalGames: 16,
  wins: 11,
  losses: 5,
  rating: 1588,
  rank: "Master",
  streak: 3,
};

describe("motion schema", () => {
  it("accepts every valid enum combination and stable defaults", () => {
    expect(creatorMotionSchema.safeParse(DEFAULT_CREATOR_MOTION).success).toBe(true);
    expect(DEFAULT_CREATOR_MOTION).toEqual({
      updateStyle: "snappy",
      intensity: "normal",
      resultEmphasis: true,
      accentMotion: "pulse",
      rankMotion: "subtle",
    });
    for (const updateStyle of ["snappy", "smooth", "impact"] as const) {
      for (const intensity of ["subtle", "normal", "strong"] as const) {
        expect(
          creatorMotionSchema.safeParse({ ...DEFAULT_CREATOR_MOTION, updateStyle, intensity })
            .success,
        ).toBe(true);
      }
    }
  });

  it("rejects invalid values, arbitrary durations/CSS and unknown keys", () => {
    const bad = (v: object) =>
      creatorMotionSchema.safeParse({ ...DEFAULT_CREATOR_MOTION, ...v }).success;
    expect(bad({ updateStyle: "bounce" })).toBe(false);
    expect(bad({ intensity: "max" })).toBe(false);
    expect(bad({ accentMotion: "loop" })).toBe(false);
    expect(bad({ rankMotion: true })).toBe(false);
    expect(bad({ duration: 5000 })).toBe(false);
    expect(bad({ css: "animation: x 1s infinite" })).toBe(false);
  });

  it("lenient read: partial blocks get defaults; junk is dropped", () => {
    expect(parseCreatorMotion({ intensity: "strong" })).toEqual({
      ...DEFAULT_CREATOR_MOTION,
      intensity: "strong",
    });
    expect(parseCreatorMotion({ updateStyle: "javascript:x" })).toBeUndefined();
    expect(parseCreatorMotion("nope")).toBeUndefined();
  });
});

describe("motion profile (reduced motion / animations / entitlement)", () => {
  it("no motion block (Free effective config) ⇒ nothing", () => {
    expect(motionProfile(undefined, { animations: true, reducedMotion: false })).toBeNull();
  });
  it("reduced motion or animations off ⇒ nothing (data still updates)", () => {
    expect(
      motionProfile(DEFAULT_CREATOR_MOTION, { animations: true, reducedMotion: true }),
    ).toBeNull();
    expect(
      motionProfile(DEFAULT_CREATOR_MOTION, { animations: false, reducedMotion: false }),
    ).toBeNull();
  });
  it("tokens only: durations stay within 150–700 ms; intensity scales magnitude", () => {
    const p = motionProfile(DEFAULT_CREATOR_MOTION, { animations: true, reducedMotion: false });
    expect(p?.vars["--ovm-dur"]).toBe(`${MOTION_TOKENS.style.snappy.duration}ms`);
    for (const s of Object.values(MOTION_TOKENS.style)) {
      expect(s.duration).toBeGreaterThanOrEqual(150);
      expect(s.duration).toBeLessThanOrEqual(700);
    }
    const sub = MOTION_TOKENS.intensity.subtle;
    const strong = MOTION_TOKENS.intensity.strong;
    expect(strong.scale).toBeGreaterThan(sub.scale);
    expect(strong.scale).toBeLessThanOrEqual(1.15);
    for (const v of Object.values(p?.vars ?? {})) expect(v).not.toMatch(/url\(|;|javascript/);
  });
});

describe("change detection", () => {
  it("initial render (no previous summary) ⇒ no event", () => {
    expect(detectOverlayChange(null, base)).toBeNull();
  });
  it("identical data (any rerender) ⇒ no event", () => {
    expect(detectOverlayChange(base, { ...base })).toBeNull();
  });
  it("wins grew ⇒ win; losses grew ⇒ loss; games grew otherwise ⇒ draw", () => {
    const win = detectOverlayChange(base, {
      ...base,
      totalGames: 17,
      wins: 12,
      rating: 1684,
      streak: 4,
    });
    expect(win).toMatchObject({ result: "win", ratingChanged: true, streakChanged: true });
    const loss = detectOverlayChange(base, {
      ...base,
      totalGames: 17,
      losses: 6,
      rating: 1516,
      streak: 0,
    });
    expect(loss?.result).toBe("loss");
    expect(detectOverlayChange(base, { ...base, totalGames: 17 })?.result).toBe("draw");
  });
  it("rating/rank change without a new match ⇒ update WITHOUT a result", () => {
    const e = detectOverlayChange(base, { ...base, rating: 1600 });
    expect(e).toMatchObject({ result: null, ratingChanged: true });
  });
  it("new session, rewind or a different displayed character (config edit) ⇒ no event", () => {
    expect(
      detectOverlayChange(base, { ...base, sessionId: "s2", totalGames: 1, wins: 1, losses: 0 }),
    ).toBeNull();
    expect(detectOverlayChange(base, { ...base, totalGames: 15, wins: 10 })).toBeNull();
    expect(detectOverlayChange(base, { ...base, character: "ken", rating: 1400 })).toBeNull();
  });
  it("events carry a stable key of the new data", () => {
    const next = { ...base, totalGames: 17, wins: 12 };
    expect(detectOverlayChange(base, next)?.key).toBe(summaryKey(next));
  });
});

describe("preview simulation", () => {
  const sum = (s: ReturnType<typeof simulationState>): OverlaySummary => {
    const c = s.session.characters[0];
    return {
      sessionId: s.session.sessionId,
      scope: "session",
      character: c?.characterKey ?? null,
      totalGames: s.session.totalGames,
      wins: s.session.wins,
      losses: s.session.losses,
      rating: c?.current?.value ?? null,
      rank: c?.current?.rank ?? null,
      streak: s.session.currentWinStreak,
    };
  };
  it("before → after is exactly one win / one loss", () => {
    const before = sum(simulationState("win", "before"));
    expect(detectOverlayChange(before, sum(simulationState("win", "after")))?.result).toBe("win");
    expect(detectOverlayChange(before, sum(simulationState("loss", "after")))?.result).toBe("loss");
    expect(simulationState("win", "after").session.characters[0]?.delta).toBe(96);
    expect(simulationState("loss", "after").session.characters[0]?.delta).toBe(-72);
  });
  it("entering the simulation from real/sample data never plays (different session)", () => {
    const real: OverlaySummary = { ...base, sessionId: "real-session", totalGames: 10 };
    expect(detectOverlayChange(real, sum(simulationState("win", "before")))).toBeNull();
    // Replay: after → before is a rewind (no event), then before → after plays again.
    expect(
      detectOverlayChange(
        sum(simulationState("win", "after")),
        sum(simulationState("win", "before")),
      ),
    ).toBeNull();
  });
});

describe("isStaleSummary (out-of-order snapshots never become the baseline)", () => {
  it("same session, scope and character with fewer games ⇒ stale", () => {
    expect(isStaleSummary(base, { ...base, totalGames: base.totalGames - 1 })).toBe(true);
  });
  it("same or more games ⇒ not stale (repeats and real matches are handled normally)", () => {
    expect(isStaleSummary(base, { ...base })).toBe(false);
    expect(isStaleSummary(base, { ...base, totalGames: base.totalGames + 1 })).toBe(false);
  });
  it("a new session with fewer games is a genuine new baseline, not stale", () => {
    expect(isStaleSummary(base, { ...base, sessionId: "s2", totalGames: 1 })).toBe(false);
  });
  it("another displayed character or statsScope (config) is a new baseline, not stale", () => {
    expect(isStaleSummary(base, { ...base, character: "jamie", totalGames: 3 })).toBe(false);
    expect(isStaleSummary(base, { ...base, scope: "character", totalGames: 3 })).toBe(false);
  });
  it("no session ⇒ never stale", () => {
    const none = { ...base, sessionId: null };
    expect(isStaleSummary(none, { ...none, totalGames: 0 })).toBe(false);
  });
});
