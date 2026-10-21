/**
 * Test-only builders: session states produced by the REAL engine (summarizeSession →
 * toLiveSessionState), so component tests never hand-compute W/L, win rates or deltas.
 */
import { toLiveSessionState, type LiveSessionState } from "@/domain/overlay/state";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type CharacterSnapshot,
  type SessionMatch,
} from "@/domain/session/engine";
import type { MatchResult, RatingSystem } from "@/domain/sf6/types";

export const START = new Date("2026-10-21T19:30:00Z");
export const at = (min: number) => new Date(START.getTime() + min * 60_000);

export function engineSession(input: {
  results: MatchResult[];
  status?: "active" | "ended";
  system?: RatingSystem;
  baseline?: number | null;
  /** Rating observed after match index `after` (null = no observation since the start). */
  snapshot?: { value: number; after: number } | null;
}): LiveSessionState {
  const system = input.system ?? "mr";
  const matches: SessionMatch[] = input.results.map((result, i) => ({
    externalMatchId: `m${i + 1}`,
    playedAt: at((i + 1) * 6),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponentCharacter: "Ken",
    opponentName: `Rival ${i + 1}`,
    ratingBefore: null,
    ratingAfter: null,
  }));
  const current: CharacterSnapshot[] = input.snapshot
    ? [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          rating: { system, value: input.snapshot.value, rank: null },
          observedAt: at((input.snapshot.after + 1) * 6 + 1),
        },
      ]
    : [];
  const status = input.status ?? "active";
  const summary = summarizeSession({
    status,
    ratingModel: "per_character",
    baseline: {
      startedAt: START,
      endedAt: status === "ended" ? at(input.results.length * 6 + 4) : null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: DEFAULT_SESSION_FILTER,
    },
    matches,
    characterBaselines:
      input.baseline === null
        ? []
        : [
            {
              characterKey: "ryu",
              characterName: "Ryu",
              source: "session_start",
              rating: { system, value: input.baseline ?? 1571, rank: null },
              capturedAt: START,
            },
          ],
    current,
    favoriteCharacterKey: "ryu",
  });
  return toLiveSessionState("s1", summary, { characters: [], activeCharacterKey: "ryu" });
}
