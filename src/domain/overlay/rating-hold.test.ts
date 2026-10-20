/**
 * Phase 5.5 — rating continuity policy (pure): a pending post-match rating keeps the last
 * confirmed observation of the SAME character / system / session, with ITS delta, for at most
 * RATING_HOLD_MAX_MS; nothing is held without a previous observation, across sessions or after the
 * hold expires.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionMatch,
} from "@/domain/session/engine";
import { RATING_HOLD_MAX_MS, heldRatingEdges, withHeldRatings } from "./rating-hold";
import { toLiveSessionState, type PlayerLiveState } from "./state";

const START = new Date("2026-10-20T18:00:00Z");
const at = (min: number) => new Date(START.getTime() + min * 60_000);
const mr = (value: number) => ({ system: "mr" as const, value });

function build(input: {
  status?: "active" | "ended";
  matches: SessionMatch[];
  baselines?: CharacterBaseline[];
  snapshots?: CharacterSnapshot[];
}): PlayerLiveState {
  const summary = summarizeSession({
    status: input.status ?? "active",
    ratingModel: "per_character",
    baseline: {
      startedAt: START,
      endedAt: input.status === "ended" ? at(60) : null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: DEFAULT_SESSION_FILTER,
    },
    matches: input.matches,
    characterBaselines: input.baselines ?? [],
    current: input.snapshots ?? [],
    favoriteCharacterKey: null,
  });
  return {
    player: { displayName: "SIM" },
    session: toLiveSessionState("s", summary, { characters: [], activeCharacterKey: null }),
    generatedAt: at(30).toISOString(),
  };
}
const m = (id: string, min: number, key = "yasmine", ingestedMin?: number): SessionMatch => ({
  externalMatchId: id,
  playedAt: at(min),
  mode: "ranked",
  result: "win",
  characterKey: key,
  characterName: key,
  opponentCharacter: null,
  opponentName: null,
  ratingBefore: null,
  ratingAfter: null,
  ...(ingestedMin === undefined ? {} : { ingestedAt: at(ingestedMin) }),
});
const base = (key: string, value: number): CharacterBaseline => ({
  characterKey: key,
  characterName: key,
  source: "session_start",
  rating: mr(value),
  capturedAt: START,
});
const snap = (key: string, value: number | null, min: number): CharacterSnapshot => ({
  characterKey: key,
  characterName: key,
  rating: value === null ? null : mr(value),
  observedAt: at(min),
});
const char = (live: PlayerLiveState, key = "yasmine") =>
  live.session.characters.find((c) => c.characterKey === key)!;

describe("held rating (pending post-match rating)", () => {
  const pending = build({
    matches: [m("m1", 10), m("m2", 20, "yasmine", 21)],
    baselines: [base("yasmine", 1829)],
    snapshots: [snap("yasmine", 1859, 14)],
  });

  it("holds the last confirmed observation and ITS delta, from ingestion time, for 3 min", () => {
    expect(RATING_HOLD_MAX_MS).toBe(180_000);
    const since = at(21).getTime(); // ingestion (not play) time
    expect(heldRatingEdges(pending)).toEqual([since + RATING_HOLD_MAX_MS]);
    const held = char(withHeldRatings(pending, since + 60_000));
    expect(held.current).toMatchObject({ system: "mr", value: 1859 });
    expect(held.delta).toBe(30);
    // Exactly at the deadline still held; 1 ms later the honest unknown.
    expect(char(withHeldRatings(pending, since + RATING_HOLD_MAX_MS)).current?.value).toBe(1859);
    const expired = char(withHeldRatings(pending, since + RATING_HOLD_MAX_MS + 1));
    expect(expired.current).toBeNull();
    expect(expired.delta).toBeNull();
  });

  it("nothing pending ⇒ the very same object (non-pending states render exactly as before)", () => {
    const confirmed = build({
      matches: [m("m1", 10)],
      baselines: [base("yasmine", 1829)],
      snapshots: [snap("yasmine", 1859, 14)],
    });
    expect(withHeldRatings(confirmed, at(15).getTime())).toBe(confirmed);
    expect(heldRatingEdges(confirmed)).toEqual([]);
  });

  it("no previous observation ⇒ nothing held (never invented)", () => {
    const none = build({ matches: [m("m1", 10)], snapshots: [snap("yasmine", null, 5)] });
    expect(char(none).current).toBeNull();
    expect(char(none).heldRating ?? null).toBeNull();
    expect(char(withHeldRatings(none, at(11).getTime())).current).toBeNull();
  });

  it("per character: another character never borrows the held value", () => {
    const two = build({
      matches: [m("m1", 10), m("m2", 20, "yasmine"), m("k1", 12, "ken")],
      baselines: [base("yasmine", 1829), base("ken", 1700)],
      snapshots: [snap("yasmine", 1859, 14), snap("ken", 1712, 14)],
    });
    const shown = withHeldRatings(two, at(21).getTime());
    expect(char(shown).current?.value).toBe(1859);
    expect(char(shown, "ken").current?.value).toBe(1712); // confirmed, untouched
    expect(char(shown, "ken").heldRating ?? null).toBeNull();
  });

  it("a new session starts from its own baseline (nothing pending, nothing inherited)", () => {
    const fresh = build({ matches: [], baselines: [base("yasmine", 1861)], snapshots: [] });
    expect(char(fresh).current?.value).toBe(1861);
    expect(char(fresh).heldRating ?? null).toBeNull();
  });

  it("an ended session never holds (frozen finals are its current)", () => {
    const ended = build({
      status: "ended",
      matches: [m("m1", 10)],
      baselines: [base("yasmine", 1829)],
      snapshots: [snap("yasmine", 1861, 60)],
    });
    expect(char(ended).current?.value).toBe(1861);
    expect(char(ended).heldRating ?? null).toBeNull();
  });

  it("the new observation replaces the hold with the authoritative rating and delta", () => {
    const resolved = build({
      matches: [m("m1", 10), m("m2", 20)],
      baselines: [base("yasmine", 1829)],
      snapshots: [snap("yasmine", 1861, 22)],
    });
    const c = char(withHeldRatings(resolved, at(22).getTime()));
    expect(c.current?.value).toBe(1861);
    expect(c.delta).toBe(32); // session delta from the engine, never from the display
  });
});
