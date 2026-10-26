/**
 * Test-only fixture (anonymized from a reported case): A.K.I. played a Ranked session from 1866
 * to 1903 MR (+37) and the session ENDED; no stored rank anywhere (higher Master leagues carry no
 * evidence-backed Capcom label). Built through the REAL engine.
 */
import {
  summarizeSession,
  type CharacterBaseline,
  type SessionMatch,
  type SessionStatus,
} from "@/domain/session/engine";
import type { RatingPoint } from "@/domain/sf6/types";

const T0 = new Date("2026-10-26T18:17:03Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
export const mr = (value: number, rank: string | null = null): RatingPoint => ({
  system: "mr",
  value,
  rank,
  rankTier: null,
  phase: null,
});
export const lp = (value: number, rank: string | null = null): RatingPoint => ({
  system: "lp",
  value,
  rank,
  rankTier: null,
  phase: null,
});

export function akiSession(
  status: SessionStatus,
  opts: { initial?: RatingPoint | null; final?: RatingPoint | null } = {},
) {
  const initial = opts.initial === undefined ? mr(1866) : opts.initial;
  const final = opts.final === undefined ? mr(1903) : opts.final;
  const matches: SessionMatch[] = (["win", "win", "loss", "win"] as const).map((result, i) => ({
    externalMatchId: `m${i}`,
    playedAt: at(5 * (i + 1)),
    mode: "ranked",
    result,
    characterKey: "aki",
    characterName: "A.K.I.",
    opponentCharacter: null,
    opponentName: null,
    ratingBefore: null,
    ratingAfter: null,
  }));
  const baselines: CharacterBaseline[] = initial
    ? [
        {
          characterKey: "aki",
          characterName: "A.K.I.",
          source: "session_start",
          rating: initial,
          capturedAt: T0,
        },
      ]
    : [];
  return summarizeSession({
    status,
    ratingModel: "per_character",
    baseline: {
      startedAt: T0,
      endedAt: status === "ended" ? at(68) : null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: { modes: ["ranked"] },
    },
    matches,
    characterBaselines: baselines,
    current: final
      ? [{ characterKey: "aki", characterName: "A.K.I.", rating: final, observedAt: at(60) }]
      : [],
    favoriteCharacterKey: "aki",
  });
}
