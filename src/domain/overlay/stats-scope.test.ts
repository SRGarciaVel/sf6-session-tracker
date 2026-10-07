import { describe, expect, it } from "vitest";
import { computeSessionStats } from "@/domain/session/engine";
import {
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig,
  type OverlayConfig,
} from "./config";
import { getEffectiveOverlayConfig, mergeOverlayConfigForSave } from "./creator";
import { detectOverlayChange, type OverlaySummary } from "./motion";
import { appearanceFromConfig, applyPresetToConfig } from "./presets";
import { sampleMultiCharacterState } from "./sample-session";
import { resolveOverlayStats } from "./state";
import { DEFAULT_THEME_VARIANTS } from "./variants";

const FREE = {
  overlays: { advancedCustomization: false, premiumThemes: false, motionEffects: false },
};
const session = sampleMultiCharacterState().session;
const char = (k: string) => session.characters.find((c) => c.characterKey === k);

describe("statsScope config", () => {
  it("19–20. default 'session'; configs saved before 5.1 read as 'session'", () => {
    expect(DEFAULT_OVERLAY_CONFIG.statsScope).toBe("session");
    const legacy: Record<string, unknown> = { ...DEFAULT_OVERLAY_CONFIG };
    delete legacy.statsScope;
    expect(parseOverlayConfig(legacy).statsScope).toBe("session");
  });
  it("21–22. 'character' valid; anything else rejected (and read leniently as the whole config default)", () => {
    expect(
      overlayConfigSchema.safeParse({ ...DEFAULT_OVERLAY_CONFIG, statsScope: "character" }).success,
    ).toBe(true);
    for (const bad of ["global", "char", true, 1, null]) {
      expect(
        overlayConfigSchema.safeParse({ ...DEFAULT_OVERLAY_CONFIG, statsScope: bad }).success,
      ).toBe(false);
    }
  });
  it("23–25. saved and read back; a Free owner keeps it; stored premium config intact", () => {
    const stored: OverlayConfig = {
      ...DEFAULT_OVERLAY_CONFIG,
      theme: "rank-card",
      variants: DEFAULT_THEME_VARIANTS,
    };
    const merged = mergeOverlayConfigForSave(stored, { ...stored, statsScope: "character" }, FREE);
    expect(parseOverlayConfig(JSON.parse(JSON.stringify(merged))).statsScope).toBe("character");
    expect(merged.theme).toBe("rank-card");
    expect(merged.variants).toEqual(DEFAULT_THEME_VARIANTS);
    expect(getEffectiveOverlayConfig(merged, FREE).statsScope).toBe("character"); // Free capability
  });
  it("presets are appearance only: statsScope is neither stored nor overwritten by apply", () => {
    const cfg = { ...DEFAULT_OVERLAY_CONFIG, statsScope: "character" as const };
    expect(appearanceFromConfig(cfg)).not.toHaveProperty("statsScope");
    expect(applyPresetToConfig(cfg, appearanceFromConfig(DEFAULT_OVERLAY_CONFIG)).statsScope).toBe(
      "character",
    );
  });
});

describe("multi-character sample (engine-built, consistent)", () => {
  it("45. Jamie 3-5 · Chun-Li 2-1 · Ryu 9-8 · session 14-14; global = sum; Cammy 0 games", () => {
    expect([session.wins, session.losses, session.totalGames]).toEqual([14, 14, 28]);
    expect([char("jamie")?.wins, char("jamie")?.losses]).toEqual([3, 5]);
    expect([char("chunli")?.wins, char("chunli")?.losses]).toEqual([2, 1]);
    expect([char("ryu")?.wins, char("ryu")?.losses]).toEqual([9, 8]);
    expect(char("cammy")?.games).toBe(0);
    const played = session.characters.filter((c) => c.games > 0);
    expect(played.reduce((n, c) => n + c.wins, 0)).toBe(session.wins);
    // Ryu's streak (4) survives Chun-Li's matches played in between.
    expect(char("ryu")?.currentWinStreak).toBe(4);
    expect(char("ryu")?.recentResults).toHaveLength(10);
    expect(Math.abs((char("chunli")?.winRate ?? 0) - 66.7)).toBeLessThan(0.05);
  });

  it("a sample rank override keeps the focused character's own delta (unplayed ⇒ no change)", () => {
    const master = { rank: "Master", system: "mr" as const, value: 1_700 };
    const cammy = sampleMultiCharacterState("cammy", master).session.characters.find(
      (c) => c.characterKey === "cammy",
    );
    expect(cammy).toMatchObject({ games: 0, current: { value: 1_700 }, delta: 0 });
    const ryu = sampleMultiCharacterState("ryu", master).session.characters.find(
      (c) => c.characterKey === "ryu",
    );
    expect(ryu).toMatchObject({ current: { value: 1_700 }, delta: 96 });
  });
});

describe("resolveOverlayStats (single projection)", () => {
  it("session scope = the global stats (unchanged behaviour)", () => {
    const s = resolveOverlayStats(session, { statsScope: "session", ratingCharacterKey: "chunli" });
    expect(s).toMatchObject({
      scope: "session",
      wins: 14,
      losses: 14,
      totalGames: 28,
      winRate: 50,
    });
  });
  it("33. character scope uses the SAME character as the rating (pinned, else active)", () => {
    const pinned = resolveOverlayStats(session, {
      statsScope: "character",
      ratingCharacterKey: "chunli",
    });
    expect(pinned).toMatchObject({ characterKey: "chunli", wins: 2, losses: 1, totalGames: 3 });
    const active = resolveOverlayStats(session, {
      statsScope: "character",
      ratingCharacterKey: null,
    });
    expect(active).toMatchObject({ characterKey: "ryu", wins: 9, losses: 8 });
  });
  it("34. a selected character with 0 games shows zeros (not global)", () => {
    expect(
      resolveOverlayStats(session, { statsScope: "character", ratingCharacterKey: "cammy" }),
    ).toMatchObject({
      characterKey: "cammy",
      wins: 0,
      losses: 0,
      totalGames: 0,
      winRate: 0,
      recentResults: [],
    });
  });
  it("35. no resolvable character: neutral zeros, never the global stats in disguise", () => {
    const empty = { ...session, activeCharacterKey: null, characters: [] };
    expect(
      resolveOverlayStats(empty, { statsScope: "character", ratingCharacterKey: "ken" }),
    ).toMatchObject({
      scope: "character",
      characterKey: null,
      wins: 0,
      totalGames: 0,
    });
  });
  it("the per-character numbers are the engine's (no recomputation in the projection)", () => {
    const ryu = char("ryu");
    expect(ryu && computeSessionStats([]).recentResults).toEqual([]);
    expect(
      resolveOverlayStats(session, { statsScope: "character", ratingCharacterKey: "ryu" })
        .recentResults,
    ).toBe(ryu?.recentResults);
  });
});

describe("Creator Motion with statsScope (38–42)", () => {
  const base: OverlaySummary = {
    sessionId: "s",
    scope: "session",
    character: "ryu",
    totalGames: 28,
    wins: 14,
    losses: 14,
    rating: 1684,
    rank: "Master",
    streak: 4,
  };
  it("switching scope (session ↔ character) is never a match", () => {
    expect(
      detectOverlayChange(base, {
        ...base,
        scope: "character",
        totalGames: 17,
        wins: 9,
        losses: 8,
      }),
    ).toBeNull();
    expect(detectOverlayChange({ ...base, scope: "character", totalGames: 3 }, base)).toBeNull();
  });
  it("switching the displayed character is never a match", () => {
    expect(
      detectOverlayChange(base, { ...base, character: "chunli", rating: 21150, rank: "Diamond 2" }),
    ).toBeNull();
  });
  it("a new match of the shown character still plays the right event in character scope", () => {
    const prev = { ...base, scope: "character" as const, totalGames: 17, wins: 9, losses: 8 };
    expect(
      detectOverlayChange(prev, { ...prev, totalGames: 18, wins: 10, rating: 1700 })?.result,
    ).toBe("win");
    expect(detectOverlayChange(prev, { ...prev, totalGames: 18, losses: 9 })?.result).toBe("loss");
  });
  it("first render and identical data never play", () => {
    expect(detectOverlayChange(null, base)).toBeNull();
    expect(detectOverlayChange(base, { ...base })).toBeNull();
  });
});
