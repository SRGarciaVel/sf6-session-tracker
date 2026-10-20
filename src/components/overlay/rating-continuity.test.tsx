/**
 * Phase 5.5 — the reported "Yasmine 1859 MR +30 → -- MR - → 1861 MR" flicker, reproduced through
 * the REAL engine path (summarizeSession → toLiveSessionState → Session overlay):
 *
 *   t1  profile snapshot 1859 MR (session started at 1829)          ⇒ 1859 MR, +30
 *   t2  a new Ranked match is ingested from the battlelog. Battlelog
 *       replays never carry a post-match rating (ratingAfter: null)
 *       and the latest profile snapshot predates the match            ⇒ current unknown
 *   t3  the next profile snapshot (1861 MR) arrives                    ⇒ 1861 MR, +32
 *
 * Between t2 and t3 (≤ one Companion profile interval) the overlay must keep the last confirmed
 * observation instead of showing "—".
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type CharacterSnapshot,
  type SessionMatch,
} from "@/domain/session/engine";
import { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } from "@/domain/overlay/config";
import { toLiveSessionState, type PlayerLiveState } from "@/domain/overlay/state";
import { THEME_IDS } from "@/domain/overlay/themes";
import { OverlayView } from "./OverlayView";

const START = new Date("2026-10-20T18:00:00Z");
const mr = (value: number) => ({ system: "mr" as const, value, rank: "Ultimate Master" });

function liveAt(
  generatedAt: Date,
  matches: SessionMatch[],
  snapshot: { value: number; observedAt: Date },
  system: "mr" | "lp" = "mr",
): PlayerLiveState {
  const point = (value: number) =>
    system === "mr" ? mr(value) : { system: "lp" as const, value, rank: "Diamond 3" };
  const current: CharacterSnapshot[] = [
    {
      characterKey: "yasmine",
      characterName: "Yasmine",
      rating: point(snapshot.value),
      observedAt: snapshot.observedAt,
    },
  ];
  const summary = summarizeSession({
    status: "active",
    ratingModel: "per_character",
    baseline: {
      startedAt: START,
      endedAt: null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: DEFAULT_SESSION_FILTER,
    },
    matches,
    characterBaselines: [
      {
        characterKey: "yasmine",
        characterName: "Yasmine",
        source: "session_start",
        rating: point(system === "mr" ? 1829 : 21850),
        capturedAt: START,
      },
    ],
    current,
    favoriteCharacterKey: "yasmine",
  });
  return {
    player: { displayName: "SIM" },
    session: toLiveSessionState("s1", summary, { characters: [], activeCharacterKey: null }),
    generatedAt: generatedAt.toISOString(),
  };
}

const at = (min: number) => new Date(START.getTime() + min * 60_000);
const match = (id: string, playedMin: number, result: "win" | "loss"): SessionMatch => ({
  externalMatchId: id,
  playedAt: at(playedMin),
  mode: "ranked",
  result,
  characterKey: "yasmine",
  characterName: "Yasmine",
  opponentCharacter: "Ken",
  opponentName: "SIM-OPP",
  ratingBefore: null, // MR replays: not proven ⇒ null (parse.ts)
  ratingAfter: null, // battlelog replays never carry it
});

const render = (live: PlayerLiveState, theme: (typeof THEME_IDS)[number] = "competitive") =>
  renderToStaticMarkup(
    <OverlayView
      config={{ ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme), locale: "en" }}
      live={live}
      sizing={{ mode: "box", width: 800, height: 180 }}
    />,
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("reported flicker: confirmed → transient → confirmed (real engine path)", () => {
  const m1 = match("m1", 10, "win");
  const m2 = match("m2", 20, "win");
  const t1 = liveAt(at(15), [m1], { value: 1859, observedAt: at(14) });
  const t2 = liveAt(at(21), [m1, m2], { value: 1859, observedAt: at(14) }); // snapshot predates m2
  const t3 = liveAt(at(22), [m1, m2], { value: 1861, observedAt: at(22) });

  it("the engine reports the post-match rating as not yet observed (root cause)", () => {
    const c = t2.session.characters[0]!;
    expect(c.current).toBeNull(); // honest: the new rating is unknown until the next profile
    expect(c.ratingSystem).toBe("mr");
    // …and says WHY, with the last confirmed observation (same character, system, session):
    expect(c.heldRating).toEqual({
      current: { system: "mr", value: 1859, rank: "Ultimate Master" },
      delta: 30,
      pendingSince: at(20).toISOString(),
    });
  });

  for (const theme of THEME_IDS) {
    it(`${theme}: never renders "—" for the rating during the transient update`, () => {
      expect(text(render(t1, theme))).toContain("1,859");
      const mid = text(render(t2, theme));
      expect(mid).toContain("1,859");
      expect(mid).toContain("+30");
      expect(mid).not.toMatch(/— MR|—\s*MR/);
      expect(text(render(t3, theme))).toContain("1,861");
    });
  }

  it("LP: the same transient never blanks the rating", () => {
    const l1 = liveAt(at(15), [m1], { value: 21950, observedAt: at(14) }, "lp");
    const l2 = liveAt(at(21), [m1, m2], { value: 21950, observedAt: at(14) }, "lp");
    expect(text(render(l1))).toContain("21,950");
    expect(text(render(l2))).toContain("21,950");
    expect(text(render(l2))).toContain("+100");
  });
});
