import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, type OverlayConfig } from "./config";
import { resolvePresentation } from "./presentation";
import { SESSION_VIEW, characterView } from "./rotation";
import { sampleMultiCharacterState } from "./sample-session";
import { pickRatingCharacter, resolveOverlayStats } from "./state";

// Sample: Chun-Li 2-1, Jamie 3-5, Ryu 9-8 ⇒ 14-14; active (latest match) = Ryu; Cammy unplayed.
const session = sampleMultiCharacterState().session;
const LABELS = { session: "Sesión" };
const stored = (over: Partial<OverlayConfig> = {}): OverlayConfig => ({
  ...DEFAULT_OVERLAY_CONFIG,
  statsScope: "character",
  ratingCharacterKey: "jamie",
  ...over,
});
const project = (
  view: Parameters<typeof resolvePresentation>[2],
  mode: Parameters<typeof resolvePresentation>[3],
  config = stored(),
) => {
  const p = resolvePresentation(config, session, view, mode, LABELS);
  const stats = resolveOverlayStats(session, p.config);
  const rating = pickRatingCharacter(session, p.config.ratingCharacterKey);
  return { ...p, stats, rating };
};

describe("presentation projection (23–32)", () => {
  it("23. the session view shows GLOBAL statistics even when statsScope is 'character'", () => {
    const { stats } = project(SESSION_VIEW, "session-all");
    expect(stats).toMatchObject({ scope: "session", wins: 14, losses: 14, totalGames: 28 });
  });

  it("24. a character view (mixed modes) shows that character's own statistics", () => {
    const { stats } = project(
      characterView("chunli"),
      "session-active",
      stored({ statsScope: "session" }),
    );
    expect(stats).toMatchObject({ scope: "character", wins: 2, losses: 1, characterKey: "chunli" });
  });

  it("characters mode keeps the Phase 5.2 semantics (stored statsScope, no label)", () => {
    const sessionScope = project(
      characterView("chunli"),
      "characters",
      stored({ statsScope: "session" }),
    );
    expect(sessionScope.stats).toMatchObject({ wins: 14, losses: 14 });
    expect(sessionScope.viewLabel).toBeNull();
    expect(sessionScope.config.title).toBe(DEFAULT_OVERLAY_CONFIG.title);
    const charScope = project(characterView("chunli"), "characters");
    expect(charScope.stats).toMatchObject({ wins: 2, losses: 1 });
  });

  it("25–26. views never change the stored statsScope or ratingCharacterKey", () => {
    const config = stored();
    const before = structuredClone(config);
    project(SESSION_VIEW, "session-all", config);
    project(characterView("ryu"), "session-active", config);
    expect(config).toEqual(before);
  });

  it("27–29. rating, rank and delta belong to the character of the view", () => {
    const { rating } = project(characterView("chunli"), "session-all");
    expect(rating).toMatchObject({
      characterKey: "chunli",
      current: { value: 21_150, rank: "Diamond 2" },
      delta: 150,
    });
  });

  it("30. the session view invents no global rating: it shows the ACTIVE character's, by name", () => {
    const { rating, config } = project(SESSION_VIEW, "session-all");
    expect(config.ratingCharacterKey).toBe(session.activeCharacterKey);
    expect(rating?.characterName).toBe("Ryu"); // labelled with its name like every rating
    // No active character ⇒ the neutral placeholder (no rating at all).
    const none = resolvePresentation(
      stored(),
      { ...session, activeCharacterKey: null },
      SESSION_VIEW,
      "session-all",
      LABELS,
    );
    expect(
      pickRatingCharacter({ ...session, activeCharacterKey: null }, none.config.ratingCharacterKey),
    ).toBeNull();
  });

  it("31. view identifier: session label / character name (mixed modes only)", () => {
    expect(project(SESSION_VIEW, "session-all")).toMatchObject({
      viewLabel: "Sesión",
      config: { title: "Sesión", showTitle: true },
    });
    expect(project(characterView("chunli"), "session-active")).toMatchObject({
      viewLabel: "Chun-Li",
      config: { title: "Chun-Li", showTitle: true },
    });
  });

  it("32. a custom title is kept (label appended, never persisted); hidden title ⇒ label only", () => {
    const custom = stored({ title: "RANKED", showTitle: true });
    expect(project(characterView("jamie"), "session-all", custom).config.title).toBe(
      "RANKED · Jamie",
    );
    expect(custom.title).toBe("RANKED");
    const hidden = stored({ title: "RANKED", showTitle: false });
    expect(project(SESSION_VIEW, "session-all", hidden).config).toMatchObject({
      title: "Sesión",
      showTitle: true,
    });
  });

  it("no view (rotation off / nothing to show) ⇒ the stored config, untouched", () => {
    const config = stored();
    expect(resolvePresentation(config, session, null, "session-all", LABELS).config).toBe(config);
  });
});
