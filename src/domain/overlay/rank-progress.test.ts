/**
 * Phase 5.4B — Rank Progress overlay config (its own discriminated schema) and THE projection the
 * renderer uses: character selection (same rule as Session), no session needed, and the optional
 * authoritative session delta (unknown is never zero).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_OVERLAY_CONFIG,
  defaultOverlayConfigForKind,
  overlayConfigSchema,
  overlayReadout,
  parseOverlayConfig,
  sessionConfigOf,
  type OverlayConfig,
} from "./config";
import { getEffectiveOverlayConfig, mergeOverlayConfigForSave } from "./creator";
import { appearanceFromConfig, parsePresetAppearance, presetAppliesTo } from "./presets";
import {
  DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  RANK_PROGRESS_CANVASES,
  RANK_PROGRESS_STYLES,
  rankProgressOverlayConfigSchema,
  resolveRankProgressView,
  type RankProgressOverlayConfig,
} from "./rank-progress";
import { sampleMultiCharacterState } from "./sample-session";
import { sampleLiveState, type LiveCharacterProgress, type LiveSessionState } from "./state";
import { THEME_IDS } from "./themes";

const ALL = {
  overlays: {
    advancedCustomization: true,
    premiumThemes: true,
    motionEffects: true,
    characterRotation: true,
    brandFlag: true,
  },
};
const NONE = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
    brandFlag: false,
  },
};
const RP = DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG;

function character(
  key: string,
  rating: { system: "lp" | "mr"; value: number } | null,
  extra: Partial<LiveCharacterProgress> = {},
): LiveCharacterProgress {
  return {
    characterKey: key,
    characterName: key.toUpperCase(),
    wins: 0,
    losses: 0,
    draws: 0,
    games: 0,
    lastPlayedAt: null,
    winRate: 0,
    currentWinStreak: 0,
    currentLossStreak: 0,
    bestWinStreak: 0,
    recentResults: [],
    ratingSystem: rating?.system ?? null,
    initial: rating ? { ...rating, rank: null } : null,
    current: rating ? { ...rating, rank: null } : null,
    delta: rating ? 0 : null,
    baselineKnown: rating !== null,
    ...extra,
  };
}

/** A player with no session at all: only the roster's current ratings. */
function noSession(
  characters: LiveCharacterProgress[],
  activeCharacterKey: string | null,
): LiveSessionState {
  const base = sampleLiveState().session;
  return {
    ...base,
    status: "none",
    sessionId: null,
    startedAt: null,
    wins: 0,
    losses: 0,
    totalGames: 0,
    winRate: 0,
    recentResults: [],
    activeCharacterKey,
    characters,
  };
}

describe("config: its own minimal schema", () => {
  it("defaults are Free, Broadcast, auto character and auto goal", () => {
    expect(RP).toMatchObject({
      kind: "rank-progress",
      version: 1,
      style: "broadcast",
      characterKey: null,
      goal: "auto",
      showSessionDelta: true,
      showRemaining: true,
      showCharacterName: true,
      animations: true,
    });
    expect(defaultOverlayConfigForKind("rank-progress")).toBe(RP);
    expect(rankProgressOverlayConfigSchema.parse(RP)).toEqual(RP);
  });

  it("carries no Session-only field (no stat toggles, scope, theme, rotation, Creator block)", () => {
    for (const key of [
      "fields",
      "statsScope",
      "theme",
      "preset",
      "creator",
      "variants",
      "ratingCharacterKey",
      "winColor",
    ]) {
      expect(key in RP, key).toBe(false);
    }
    // Rank Progress styles are their own list; the Session theme registry is untouched.
    expect(RANK_PROGRESS_STYLES).toEqual(["broadcast", "compact"]);
    expect(THEME_IDS).toEqual([
      "minimal",
      "competitive",
      "fighter",
      "rank-card",
      "broadcast",
      "prestige",
    ]);
  });

  it("the single public parser reads a stored Rank Progress row as Rank Progress", () => {
    const stored = { ...RP, style: "compact", goal: "master", characterKey: "aki", locale: "en" };
    const parsed = parseOverlayConfig(stored);
    expect(parsed.kind).toBe("rank-progress");
    expect(parsed).toEqual(stored);
  });

  it("lenient read: missing keys ⇒ defaults; a malformed row stays Rank Progress (default)", () => {
    expect(parseOverlayConfig({ kind: "rank-progress", style: "compact" })).toEqual({
      ...RP,
      style: "compact",
    });
    for (const bad of [
      { kind: "rank-progress", goal: "legend" },
      { kind: "rank-progress", style: "valorant" },
      { kind: "rank-progress", textColor: "red;}</style>" },
      { kind: "rank-progress", characterKey: "../../etc" },
      { kind: "rank-progress", backgroundOpacity: 7 },
    ]) {
      expect(parseOverlayConfig(bad)).toEqual(RP);
    }
    // Session fields smuggled into a Rank Progress row are dropped, never rendered.
    const parsed = parseOverlayConfig({ ...RP, theme: "prestige", creator: { x: 1 } });
    expect(parsed).toEqual(RP);
  });

  it("legacy Session rows and unknown kinds keep their 5.4A behaviour", () => {
    expect(parseOverlayConfig({ theme: "minimal" }).kind).toBe("session");
    expect(parseOverlayConfig({ ...RP, kind: "evil-widget" })).toEqual(
      DEFAULT_SESSION_OVERLAY_CONFIG,
    );
    // A Rank-Progress-looking row WITHOUT kind is a legacy Session row, never Rank Progress.
    const noKind: Record<string, unknown> = { ...RP };
    delete noKind.kind;
    expect(parseOverlayConfig(noKind).kind).toBe("session");
  });

  it("the editor schema: union of both kinds, a body never validates as the other kind", () => {
    expect(overlayConfigSchema.parse(RP).kind).toBe("rank-progress");
    expect(overlayConfigSchema.parse(DEFAULT_SESSION_OVERLAY_CONFIG).kind).toBe("session");
    // Session fields + kind rank-progress, or Rank Progress fields + kind session: rejected.
    expect(
      overlayConfigSchema.safeParse({ ...DEFAULT_SESSION_OVERLAY_CONFIG, kind: "rank-progress" })
        .success,
    ).toBe(false);
    expect(overlayConfigSchema.safeParse({ ...RP, kind: "session" }).success).toBe(false);
    expect(overlayConfigSchema.safeParse({ ...RP, goal: "next-legend" }).success).toBe(false);
  });

  it("narrowing: the union discriminates on kind", () => {
    const configs: OverlayConfig[] = [RP, DEFAULT_SESSION_OVERLAY_CONFIG];
    const kinds = configs.map((c) => (c.kind === "rank-progress" ? c.style : c.theme));
    expect(kinds).toEqual(["broadcast", "competitive"]);
    expect(sessionConfigOf(RP)).toBeNull();
    expect(sessionConfigOf(DEFAULT_SESSION_OVERLAY_CONFIG)).toBe(DEFAULT_SESSION_OVERLAY_CONFIG);
  });

  it("dashboard readout: kind, canvas of the style, language, style (no theme)", () => {
    for (const style of RANK_PROGRESS_STYLES) {
      expect(overlayReadout({ ...RP, style, locale: "en" })).toEqual({
        kind: "rank-progress",
        canvas: RANK_PROGRESS_CANVASES[style],
        locale: "en",
        theme: null,
        style,
      });
    }
  });
});

describe("Free product: no Creator rules, immutable kind, no presets", () => {
  it("effective config = stored config for every owner (nothing gated)", () => {
    const stored: RankProgressOverlayConfig = { ...RP, style: "compact", accentColor: "#ff2e93" };
    expect(getEffectiveOverlayConfig(stored, NONE)).toBe(stored);
    expect(getEffectiveOverlayConfig(stored, ALL)).toBe(stored);
  });

  it("save merge: Rank Progress takes the request as is; a forged other kind changes nothing", () => {
    const incoming: OverlayConfig = { ...RP, goal: "master", showRemaining: false };
    expect(mergeOverlayConfigForSave<OverlayConfig>(RP, incoming, NONE)).toBe(incoming);
    // Rank Progress stored, Session incoming ⇒ stored kept (and vice versa).
    expect(mergeOverlayConfigForSave<OverlayConfig>(RP, DEFAULT_SESSION_OVERLAY_CONFIG, ALL)).toBe(
      RP,
    );
    expect(mergeOverlayConfigForSave<OverlayConfig>(DEFAULT_SESSION_OVERLAY_CONFIG, RP, ALL)).toBe(
      DEFAULT_SESSION_OVERLAY_CONFIG,
    );
  });

  it("Session presets never apply to Rank Progress; a Rank Progress config is no preset", () => {
    const preset = parsePresetAppearance(appearanceFromConfig(DEFAULT_SESSION_OVERLAY_CONFIG))!;
    expect(presetAppliesTo(preset, "rank-progress")).toBe(false);
    expect(parsePresetAppearance(RP)).toBeNull();
  });
});

describe("resolveRankProgressView: character selection", () => {
  const lpChar = character("ryu", { system: "lp", value: 21950 });
  const mrChar = character("aki", { system: "mr", value: 1642 });

  it("auto = the active character; pinned = that character", () => {
    const s = noSession([lpChar, mrChar], "aki");
    expect(resolveRankProgressView(s, RP).characterName).toBe("AKI");
    expect(resolveRankProgressView(s, RP).state.kind).toBe("progress");
    const pinned = resolveRankProgressView(s, { ...RP, characterKey: "ryu" });
    expect(pinned.characterName).toBe("RYU");
    expect(pinned.state).toMatchObject({ system: "lp", current: { label: "Diamond 3" } });
  });

  it("a pinned character missing from the roster falls back to the active one (Session rule)", () => {
    const s = noSession([lpChar, mrChar], "aki");
    expect(resolveRankProgressView(s, { ...RP, characterKey: "zangief" }).characterName).toBe(
      "AKI",
    );
  });

  it("works with no session at all (status none): roster ratings are current data", () => {
    const s = noSession([lpChar], "ryu");
    const view = resolveRankProgressView(s, RP);
    expect(s.status).toBe("none");
    expect(view.state).toMatchObject({
      kind: "progress",
      goal: "next-division",
      remaining: 650,
      target: { label: "Diamond 4" },
    });
  });

  it("multi-character roster: each character keeps its own system and ladder", () => {
    const s = sampleMultiCharacterState("ryu");
    for (const c of s.session.characters) {
      const view = resolveRankProgressView(s.session, { ...RP, characterKey: c.characterKey });
      expect(view.characterName).toBe(c.characterName);
      if (c.current) expect(view.state.kind === "no-rating").toBe(false);
      if (view.state.kind === "progress") expect(view.state.system).toBe(c.current?.system);
    }
  });

  it("current rating comes from current.value — never initial + delta", () => {
    const c = character(
      "ryu",
      { system: "lp", value: 21950 },
      {
        initial: { system: "lp", value: 1, rank: null },
        delta: 999_999,
      },
    );
    const view = resolveRankProgressView(noSession([c], "ryu"), RP);
    expect(view.state).toMatchObject({ current: { value: 21950 } });
  });

  it("an MR character with a stored 'master' goal renders next Master tier (config untouched)", () => {
    const config = { ...RP, goal: "master" as const };
    const view = resolveRankProgressView(noSession([mrChar], "aki"), config);
    expect(view.state).toMatchObject({ kind: "progress", goal: "next-master-tier" });
    expect(config.goal).toBe("master");
  });

  it("no character / no rating ⇒ no-rating (never a fabricated zero)", () => {
    expect(resolveRankProgressView(noSession([], null), RP)).toEqual({
      state: { kind: "no-rating" },
      characterName: null,
      sessionDelta: null,
    });
    const unrated = character("ken", null);
    const view = resolveRankProgressView(noSession([unrated], "ken"), RP);
    expect(view.state).toEqual({ kind: "no-rating" });
    expect(view.characterName).toBe("KEN");
    expect(view.sessionDelta).toBeNull();
  });
});

describe("resolveRankProgressView: session delta", () => {
  const withDelta = (delta: number | null, baselineKnown: boolean) =>
    noSession([character("ryu", { system: "lp", value: 21950 }, { delta, baselineKnown })], "ryu");

  it("baseline known + delta ⇒ shown, with the character's system", () => {
    expect(resolveRankProgressView(withDelta(84, true), RP).sessionDelta).toEqual({
      value: 84,
      system: "lp",
    });
  });
  it("negative delta ⇒ negative value", () => {
    expect(resolveRankProgressView(withDelta(-32, true), RP).sessionDelta?.value).toBe(-32);
  });
  it("baseline unknown ⇒ hidden (even if a number is present)", () => {
    expect(resolveRankProgressView(withDelta(84, false), RP).sessionDelta).toBeNull();
  });
  it("delta null ⇒ hidden", () => {
    expect(resolveRankProgressView(withDelta(null, true), RP).sessionDelta).toBeNull();
  });
  it("a KNOWN zero is shown as zero (explicit decision); unknown never is", () => {
    expect(resolveRankProgressView(withDelta(0, true), RP).sessionDelta).toEqual({
      value: 0,
      system: "lp",
    });
  });
  it("option off ⇒ hidden", () => {
    expect(
      resolveRankProgressView(withDelta(84, true), { ...RP, showSessionDelta: false }).sessionDelta,
    ).toBeNull();
  });
  it("MR delta carries MR", () => {
    const s = noSession(
      [character("aki", { system: "mr", value: 1642 }, { delta: -32, baselineKnown: true })],
      "aki",
    );
    expect(resolveRankProgressView(s, RP).sessionDelta).toEqual({ value: -32, system: "mr" });
  });
});
