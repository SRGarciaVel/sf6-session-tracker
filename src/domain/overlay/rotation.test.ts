import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig,
  type OverlayConfig,
} from "./config";
import {
  DEFAULT_CREATOR_CUSTOMIZATION,
  creatorCustomizationSchema,
  getEffectiveOverlayConfig,
  mergeOverlayConfigForSave,
  parseCreatorCustomization,
} from "./creator";
import { detectOverlayChange, type OverlaySummary } from "./motion";
import { presetAppearanceSchema } from "./presets";
import {
  DEFAULT_CHARACTER_ROTATION,
  advanceRotation,
  characterRotationSchema,
  detectNewMatch,
  effectiveTransition,
  initRotation,
  nextCharacter,
  parseCharacterRotation,
  resumeAfterPriority,
  rotationDelayMs,
  rotationOrder,
  syncRotation,
  type RotationCandidate,
  type RotationInput,
} from "./rotation";
import { sampleMultiCharacterState } from "./sample-session";
import { resolveOverlayStats } from "./state";

const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 18, min)).toISOString();
const c = (
  characterKey: string,
  games: number,
  lastMin: number | null,
  characterName = characterKey,
): RotationCandidate => ({
  characterKey,
  characterName,
  games,
  lastPlayedAt: lastMin === null ? null : at(lastMin),
});
const ROSTER = [
  c("ryu", 17, 50, "Ryu"),
  c("chunli", 3, 40, "Chun-Li"),
  c("jamie", 8, 10, "Jamie"),
  c("cammy", 0, null, "Cammy"),
];
const input = (over: Partial<RotationInput> = {}): RotationInput => ({
  sessionId: "s1",
  totalGames: 28,
  activeCharacterKey: "ryu",
  order: ["ryu", "chunli", "jamie"],
  prioritizeLatestMatch: true,
  ...over,
});
const CREATOR_ENT = {
  overlays: {
    advancedCustomization: true,
    premiumThemes: true,
    motionEffects: true,
    characterRotation: true,
  },
};
const FREE_ENT = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
  },
};
const ROTATION_ON = { ...DEFAULT_CHARACTER_ROTATION, enabled: true };
const withRotation = (rotation = ROTATION_ON) => ({
  ...DEFAULT_OVERLAY_CONFIG,
  creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, characterRotation: rotation },
});

describe("eligible characters & order (1–8, 13)", () => {
  it("1. zero eligible characters ⇒ empty order, nothing visible, no timer", () => {
    const order = rotationOrder([c("ryu", 0, null), c("cammy", 0, null)], "recent");
    expect(order).toEqual([]);
    const s = initRotation(input({ order }));
    expect(s.visible).toBeNull();
    expect(rotationDelayMs(s, order, ROTATION_ON)).toBeNull();
  });

  it("2. one eligible character ⇒ shown, never scheduled", () => {
    const order = rotationOrder([c("ryu", 4, 5), c("cammy", 0, null)], "recent");
    const s = initRotation(input({ order }));
    expect(s.visible).toBe("ryu");
    expect(rotationDelayMs(s, order, ROTATION_ON)).toBeNull();
    // Even the "advance" step stays on the same character (no transition).
    expect(advanceRotation(s, order).shownSeq).toBe(s.shownSeq);
  });

  it("3–4. several eligible characters; 0-game characters (roster/baseline only) excluded", () => {
    expect(rotationOrder(ROSTER, "recent")).toEqual(["ryu", "chunli", "jamie"]);
    expect(rotationOrder(ROSTER, "recent")).not.toContain("cammy");
  });

  it("5. recent: latest counted match first (not roster position)", () => {
    const shuffled = [ROSTER[2], ROSTER[3], ROSTER[1], ROSTER[0]].filter((x) => x !== undefined);
    expect(rotationOrder(shuffled, "recent")).toEqual(["ryu", "chunli", "jamie"]);
  });

  it("6. mostPlayed: games desc", () => {
    expect(rotationOrder(ROSTER, "mostPlayed")).toEqual(["ryu", "jamie", "chunli"]);
  });

  it("7. alphabetical: displayed name, stable", () => {
    expect(rotationOrder(ROSTER, "alphabetical")).toEqual(["chunli", "jamie", "ryu"]);
  });

  it("8. ties are deterministic (documented tie-breakers) regardless of input order", () => {
    const tied = [c("b", 5, 20, "Same"), c("a", 5, 20, "Same"), c("c", 5, 30, "Same")];
    for (const order of ["recent", "mostPlayed", "alphabetical"] as const) {
      const once = rotationOrder(tied, order);
      expect(rotationOrder([...tied].reverse(), order)).toEqual(once);
    }
    expect(rotationOrder(tied, "recent")).toEqual(["c", "a", "b"]); // time, then key
    expect(rotationOrder(tied, "mostPlayed")).toEqual(["c", "a", "b"]); // games, time, key
    expect(rotationOrder(tied, "alphabetical")).toEqual(["a", "b", "c"]); // name, key
  });

  it("13. order updated (a new match moves a character first) keeps the visible character", () => {
    const s = { ...initRotation(input()), visible: "chunli" };
    const reordered = syncRotation(s, input({ order: ["jamie", "ryu", "chunli"] }));
    expect(reordered).toBe(s); // same object: nothing to do
  });
});

describe("cycle (9–12, 14–15)", () => {
  const order = ["chunli", "jamie", "ryu", "aki"];
  it("9–10. next character and wrap-around", () => {
    expect(nextCharacter(order, "chunli")).toBe("jamie");
    expect(nextCharacter(order, "aki")).toBe("chunli");
    expect(nextCharacter(order, "unknown")).toBe("chunli");
    expect(nextCharacter([], "ryu")).toBeNull();
  });

  it("11. removed character: the visible one is replaced, a stale priority dropped", () => {
    let s = initRotation(input({ order: ["ryu", "jamie"] }));
    s = syncRotation(
      s,
      input({ order: ["ryu", "jamie"], totalGames: 29, activeCharacterKey: "jamie" }),
    );
    expect(s).toMatchObject({ visible: "jamie", priority: "jamie" });
    const after = syncRotation(s, input({ order: ["ryu"], totalGames: 29 }));
    expect(after).toMatchObject({ visible: "ryu", priority: null });
  });

  it("12. added character joins the order without resetting the visible one", () => {
    let s = initRotation(input({ order: ["ryu", "jamie"] }));
    s = advanceRotation(s, ["ryu", "jamie"]);
    expect(s.visible).toBe("jamie");
    const grown = syncRotation(s, input({ order: ["ryu", "jamie", "chunli"] }));
    expect(grown.visible).toBe("jamie");
    expect(advanceRotation(grown, ["ryu", "jamie", "chunli"]).visible).toBe("chunli");
  });

  it("14–15. resume after priority continues with the NEXT character, never the same", () => {
    expect(resumeAfterPriority(order, "jamie")).toBe("ryu");
    let s = initRotation(input({ order }));
    s = syncRotation(s, input({ order, totalGames: 29, activeCharacterKey: "jamie" }));
    const resumed = advanceRotation(s, order);
    expect(resumed).toMatchObject({ visible: "ryu", priority: null });
    expect(resumed.shownSeq).toBe(s.shownSeq + 1);
  });
});

describe("match signal & priority (pure)", () => {
  const order = ["ryu", "chunli", "jamie"];
  it("first state, new session, repeated snapshot and rewind are not matches", () => {
    const s = initRotation(input({ order }));
    expect(detectNewMatch(s, input({ order }))).toBeNull(); // repeated
    expect(detectNewMatch(s, input({ order, sessionId: "s2", totalGames: 40 }))).toBeNull();
    expect(detectNewMatch(s, input({ order, totalGames: 20 }))).toBeNull();
    expect(detectNewMatch(s, input({ order, sessionId: null, totalGames: 40 }))).toBeNull();
    expect(syncRotation(s, input({ order }))).toBe(s);
  });

  it("several matches in one snapshot ⇒ ONE signal for the latest match's character", () => {
    const s = initRotation(input({ order }));
    expect(detectNewMatch(s, input({ order, totalGames: 31, activeCharacterKey: "jamie" }))).toBe(
      "jamie",
    );
  });

  it("an unknown / ineligible active character never gets priority", () => {
    const s = initRotation(input({ order }));
    expect(
      detectNewMatch(s, input({ order, totalGames: 29, activeCharacterKey: null })),
    ).toBeNull();
    expect(
      detectNewMatch(s, input({ order, totalGames: 29, activeCharacterKey: "cammy" })),
    ).toBeNull();
  });

  it("same character again restarts the period without a transition; another replaces it", () => {
    let s = initRotation(input({ order }));
    s = syncRotation(s, input({ order, totalGames: 29, activeCharacterKey: "jamie" }));
    const seq = s.shownSeq;
    const again = syncRotation(s, input({ order, totalGames: 30, activeCharacterKey: "jamie" }));
    expect(again.epoch).toBe(s.epoch + 1); // timer restarts
    expect(again.shownSeq).toBe(seq); // no transition
    const other = syncRotation(
      again,
      input({ order, totalGames: 31, activeCharacterKey: "chunli" }),
    );
    expect(other).toMatchObject({ visible: "chunli", priority: "chunli" });
  });

  it("priority disabled: matches update the baseline but never interrupt", () => {
    const s = initRotation(input({ order, prioritizeLatestMatch: false }));
    const next = syncRotation(
      s,
      input({ order, totalGames: 29, activeCharacterKey: "jamie", prioritizeLatestMatch: false }),
    );
    expect(next).toMatchObject({ visible: "ryu", priority: null, games: 29 });
  });

  it("delays: interval normally, priority seconds while prioritized", () => {
    const cfg = { intervalSeconds: 15, prioritySeconds: 30 } as const;
    let s = initRotation(input({ order }));
    expect(rotationDelayMs(s, order, cfg)).toBe(15_000);
    s = syncRotation(s, input({ order, totalGames: 29, activeCharacterKey: "jamie" }));
    expect(rotationDelayMs(s, order, cfg)).toBe(30_000);
  });

  it("new session ⇒ fresh cycle, no priority, and it is a baseline (not a match)", () => {
    let s = initRotation(input({ order }));
    s = syncRotation(s, input({ order, totalGames: 29, activeCharacterKey: "jamie" }));
    const fresh = syncRotation(
      s,
      input({ order: ["ken"], sessionId: "s2", totalGames: 1, activeCharacterKey: "ken" }),
    );
    expect(fresh).toMatchObject({ sessionId: "s2", visible: "ken", priority: null, games: 1 });
  });
});

describe("config (16, 93–94, 100)", () => {
  it("defaults are off with the recommended values", () => {
    expect(DEFAULT_CHARACTER_ROTATION).toEqual({
      enabled: false,
      intervalSeconds: 10,
      transition: "fade",
      prioritizeLatestMatch: true,
      prioritySeconds: 20,
      order: "recent",
    });
  });

  it("16. writes reject invalid values (strict literal sets, no extra keys)", () => {
    for (const bad of [
      { intervalSeconds: 7 },
      { prioritySeconds: 5 },
      { transition: "zoom" },
      { order: "random" },
      { enabled: "yes" },
      { css: "x" },
    ]) {
      expect(
        characterRotationSchema.safeParse({ ...DEFAULT_CHARACTER_ROTATION, ...bad }).success,
      ).toBe(false);
    }
    const save = overlayConfigSchema.safeParse(
      withRotation({ ...ROTATION_ON, intervalSeconds: 7 as 5 }),
    );
    expect(save.success).toBe(false);
    for (const n of [5, 10, 15, 20, 30]) {
      expect(
        characterRotationSchema.safeParse({ ...ROTATION_ON, intervalSeconds: n }).success,
      ).toBe(true);
    }
  });

  it("16. reads of old or partially corrupt blocks fall back per field to safe defaults", () => {
    expect(parseCharacterRotation({ enabled: true, intervalSeconds: 7, order: "random" })).toEqual({
      ...DEFAULT_CHARACTER_ROTATION,
      enabled: true,
    });
    expect(parseCharacterRotation("on")).toBeUndefined();
    expect(parseCharacterRotation([])).toBeUndefined();
    const creator = parseCreatorCustomization({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      characterRotation: { enabled: true, transition: "spin" },
    });
    expect(creator?.characterRotation).toEqual({ ...DEFAULT_CHARACTER_ROTATION, enabled: true });
  });

  it("93–94. old configs (no creator / Creator without rotation) parse unchanged", () => {
    const old = parseOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, creator: undefined });
    expect(old.creator).toBeUndefined();
    const creator = parseCreatorCustomization(DEFAULT_CREATOR_CUSTOMIZATION);
    expect(creator).toEqual(DEFAULT_CREATOR_CUSTOMIZATION);
    expect(creator && "characterRotation" in creator).toBe(false);
    expect(creatorCustomizationSchema.safeParse(DEFAULT_CREATOR_CUSTOMIZATION).success).toBe(true);
  });
});

describe("entitlements: stored vs effective (55–60, 63)", () => {
  it("55/58. Free (or expired) effective config has no rotation; stored keeps it", () => {
    const stored = withRotation();
    const eff = getEffectiveOverlayConfig(stored, FREE_ENT);
    expect(eff.creator?.characterRotation).toBeUndefined();
    expect(stored.creator.characterRotation).toEqual(ROTATION_ON);
  });

  it("56/60. Creator (or renewed) effective config runs it", () => {
    expect(
      getEffectiveOverlayConfig(withRotation(), CREATOR_ENT).creator?.characterRotation,
    ).toEqual(ROTATION_ON);
  });

  it("independent of motionEffects and advancedCustomization", () => {
    const onlyRotation = {
      overlays: { ...FREE_ENT.overlays, characterRotation: true },
    };
    const eff = getEffectiveOverlayConfig(withRotation(), onlyRotation);
    expect(eff.creator).toEqual({
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      characterRotation: ROTATION_ON,
    });
    const noRotation = { overlays: { ...CREATOR_ENT.overlays, characterRotation: false } };
    const both = withRotation();
    const withMotion = {
      ...both,
      creator: {
        ...both.creator,
        motion: {
          updateStyle: "snappy" as const,
          intensity: "normal" as const,
          resultEmphasis: true,
          accentMotion: "pulse" as const,
          rankMotion: "subtle" as const,
        },
      },
    };
    const eff2 = getEffectiveOverlayConfig(withMotion, noRotation);
    expect(eff2.creator?.motion).toBeDefined();
    expect(eff2.creator?.characterRotation).toBeUndefined();
  });

  it("57/59. a Free save can neither enable nor change nor delete stored rotation", () => {
    const stored = withRotation({ ...ROTATION_ON, intervalSeconds: 30 });
    const crafted = withRotation({ ...ROTATION_ON, intervalSeconds: 5 });
    expect(mergeOverlayConfigForSave(stored, crafted, FREE_ENT).creator?.characterRotation).toEqual(
      stored.creator.characterRotation,
    );
    // Crafted enable on an overlay without rotation: nothing is stored.
    const plain = { ...DEFAULT_OVERLAY_CONFIG };
    expect(mergeOverlayConfigForSave(plain, crafted, FREE_ENT).creator).toBeUndefined();
    // A Free base edit (title) after a downgrade keeps it.
    const edit: OverlayConfig = { ...stored, title: "FREE", creator: undefined };
    const merged = mergeOverlayConfigForSave<OverlayConfig>(stored, edit, FREE_ENT);
    expect(merged).toMatchObject({ title: "FREE" });
    expect(merged.creator?.characterRotation).toEqual(stored.creator.characterRotation);
  });

  it("Creator saves take the request's rotation", () => {
    const stored = withRotation();
    const incoming = withRotation({ ...ROTATION_ON, order: "alphabetical" });
    expect(
      mergeOverlayConfigForSave(stored, incoming, CREATOR_ENT).creator?.characterRotation?.order,
    ).toBe("alphabetical");
  });

  it("63. presets carry rotation inside the Creator block (statsScope stays out)", () => {
    const appearance = presetAppearanceSchema.safeParse({
      ...Object.fromEntries(
        Object.keys(presetAppearanceSchema.shape).map((k) => [
          k,
          (DEFAULT_OVERLAY_CONFIG as Record<string, unknown>)[k],
        ]),
      ),
      creator: withRotation().creator,
    });
    expect(appearance.success).toBe(true);
    expect(Object.keys(presetAppearanceSchema.shape)).not.toContain("statsScope");
  });
});

describe("statistics follow the rotated character (37–44)", () => {
  const session = sampleMultiCharacterState().session;
  const show = (key: string, statsScope: "session" | "character") =>
    resolveOverlayStats(session, { statsScope, ratingCharacterKey: key });

  it("37. session scope: global stats whatever character rotates", () => {
    for (const key of ["chunli", "jamie", "ryu"]) {
      expect(show(key, "session")).toMatchObject({ wins: 14, losses: 14, totalGames: 28 });
    }
  });

  it("38/42/43. character scope: W/L, form and streak of the rotated character", () => {
    expect(show("chunli", "character")).toMatchObject({ wins: 2, losses: 1, currentWinStreak: 1 });
    expect(show("jamie", "character")).toMatchObject({
      wins: 3,
      losses: 5,
      recentResults: ["win", "loss", "loss", "win", "loss", "win", "loss", "loss"],
    });
    expect(show("ryu", "character")).toMatchObject({ wins: 9, losses: 8, currentWinStreak: 4 });
  });

  it("44. the 0-game character never rotates in the sample", () => {
    expect(rotationOrder(session.characters, "recent")).toEqual(["ryu", "chunli", "jamie"]);
    expect(rotationOrder(session.characters, "alphabetical")).toEqual(["chunli", "jamie", "ryu"]);
  });

  it("simulated matches (preview) go through the engine: totals, active and order update", () => {
    const after = sampleMultiCharacterState("ryu", undefined, [
      { characterKey: "jamie", result: "win" },
    ]).session;
    expect(after).toMatchObject({ totalGames: 29, wins: 15, activeCharacterKey: "jamie" });
    expect(rotationOrder(after.characters, "recent")[0]).toBe("jamie");
    const jamie = after.characters.find((x) => x.characterKey === "jamie");
    expect(jamie).toMatchObject({ wins: 4, losses: 5, current: { value: 16_660 } });
  });
});

describe("Creator Motion vs rotation (45–52, pure detector)", () => {
  const base: OverlaySummary = {
    sessionId: "s",
    scope: "character",
    mode: "rotation",
    character: "ryu",
    totalGames: 28,
    wins: 14,
    losses: 14,
    rating: 1684,
    rank: "Master",
    streak: 4,
  };
  it("45. a rotation step (other character, same games) is never an update", () => {
    expect(
      detectOverlayChange(base, {
        ...base,
        character: "jamie",
        rating: 16540,
        rank: "Platinum 4",
        streak: 0,
      }),
    ).toBeNull();
  });

  it("46. a manual character change (fixed mode) is never an update", () => {
    const fixed = { ...base, mode: "fixed" as const };
    expect(detectOverlayChange(fixed, { ...fixed, character: "jamie", totalGames: 8 })).toBeNull();
  });

  it("47. a real match of the visible character plays with rating/rank flags", () => {
    const u = detectOverlayChange(base, {
      ...base,
      totalGames: 29,
      wins: 15,
      rating: 1702,
      streak: 5,
    });
    expect(u).toMatchObject({ result: "win", ratingChanged: true, streakChanged: true });
  });

  it("48–49. a match that moves the overlay to its character (priority) plays its result only", () => {
    const u = detectOverlayChange(base, {
      ...base,
      character: "jamie",
      totalGames: 29,
      losses: 15,
      rating: 16420,
    });
    expect(u).toMatchObject({ result: "loss", ratingChanged: false, rankChanged: false });
    // Another match during the priority period (same character) plays again.
    const prev = { ...base, character: "jamie", totalGames: 29, losses: 15 };
    expect(detectOverlayChange(prev, { ...prev, totalGames: 30, wins: 15 })?.result).toBe("win");
  });

  it("50–52. switching mode (config), first render and identical data never play", () => {
    expect(detectOverlayChange(base, { ...base, mode: "fixed" })).toBeNull();
    expect(detectOverlayChange(null, base)).toBeNull();
    expect(detectOverlayChange(base, { ...base })).toBeNull();
  });

  it("53–54. animations off / reduced motion ⇒ instant transitions", () => {
    expect(effectiveTransition("slide", { animations: false, reducedMotion: false })).toBe(
      "instant",
    );
    expect(effectiveTransition("fade", { animations: true, reducedMotion: true })).toBe("instant");
    expect(effectiveTransition("fade", { animations: true, reducedMotion: false })).toBe("fade");
  });
});

describe("stale snapshots (monotonic match baseline)", () => {
  const order = ["ryu", "chunli", "jamie"];
  const at = (totalGames: number, activeCharacterKey = "jamie", sessionId = "s1") =>
    input({ order, totalGames, activeCharacterKey, sessionId });

  it("current (20) → stale (19) → current (20) again is NOT a new match", () => {
    let s = initRotation(at(20));
    s = syncRotation(s, at(19)); // older snapshot
    expect(s.games).toBe(20); // the baseline never goes back within a session
    const again = syncRotation(s, at(20));
    expect(detectNewMatch(s, at(20))).toBeNull();
    expect(again).toBe(s);
    expect(again.priority).toBeNull();
  });

  it("during an active priority: stale + current neither restart nor replace it", () => {
    let s = initRotation(at(20, "ryu"));
    s = syncRotation(s, at(21, "jamie")); // legitimate match → priority once
    expect(s).toMatchObject({ visible: "jamie", priority: "jamie", games: 21 });
    const epoch = s.epoch;
    s = syncRotation(s, at(20, "ryu")); // stale snapshot (older active character too)
    s = syncRotation(s, at(21, "jamie")); // current again
    expect(s).toMatchObject({ visible: "jamie", priority: "jamie", games: 21, epoch });
  });

  it("a legitimate new match after a stale snapshot triggers priority exactly once", () => {
    let s = initRotation(at(20, "ryu"));
    s = syncRotation(s, at(19, "ryu"));
    s = syncRotation(s, at(21, "jamie"));
    expect(s).toMatchObject({ priority: "jamie", games: 21 });
    const once = s.epoch;
    s = syncRotation(s, at(21, "jamie"));
    s = syncRotation(s, at(20, "ryu"));
    s = syncRotation(s, at(21, "jamie"));
    expect(s.epoch).toBe(once);
  });

  it("a new session resets the baseline (even to fewer games) and is not a match", () => {
    let s = initRotation(at(20));
    s = syncRotation(s, at(1, "ryu", "s2"));
    expect(s).toMatchObject({ sessionId: "s2", games: 1, priority: null });
    expect(syncRotation(s, at(2, "jamie", "s2"))).toMatchObject({ priority: "jamie", games: 2 });
  });
});
