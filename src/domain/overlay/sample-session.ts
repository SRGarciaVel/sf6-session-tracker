/**
 * Multi-character preview sample (Phase 5.1). Built by running the REAL session engine over a
 * fixed match list, so every number (global and per character: W/L, win rate, streaks, recent
 * form, ratings) is consistent by construction. Preview only — never a real session.
 *
 *   Jamie 3W 5L · Chun-Li 2W 1L · Ryu 9W 8L  ⇒  session 14W 14L
 *   Ryu's games are split around Chun-Li's: Chun-Li's matches don't break Ryu's streak.
 *   Cammy is known from the roster with 0 games (to preview a character without matches).
 */
import {
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionMatch,
} from "@/domain/session/engine";
import type { CharacterKey, MatchResult, RatingPoint } from "@/domain/sf6/types";
import { toLiveSessionState, type PlayerLiveState, type SampleRank } from "./state";

const W: MatchResult = "win";
const L: MatchResult = "loss";

const NAMES: Record<string, string> = {
  jamie: "Jamie",
  chunli: "Chun-Li",
  ryu: "Ryu",
  cammy: "Cammy",
};

/** Chronological order of play. */
const PLAY: Array<[CharacterKey, MatchResult[]]> = [
  ["jamie", [W, L, L, W, L, W, L, L]],
  ["ryu", [L, W, L, W, L, L, W, L, W]],
  ["chunli", [W, L, W]],
  ["ryu", [L, W, L, L, W, W, W, W]],
];

const RATINGS: Record<string, { start: RatingPoint; now: RatingPoint }> = {
  jamie: {
    start: { system: "lp", value: 16_800, rank: "Platinum 4" },
    now: { system: "lp", value: 16_540, rank: "Platinum 4" },
  },
  chunli: {
    start: { system: "lp", value: 21_000, rank: "Diamond 2" },
    now: { system: "lp", value: 21_150, rank: "Diamond 2" },
  },
  ryu: {
    start: { system: "mr", value: 1_588, rank: "Master" },
    now: { system: "mr", value: 1_684, rank: "Master" },
  },
  cammy: {
    start: { system: "lp", value: 9_200, rank: "Gold 1" },
    now: { system: "lp", value: 9_200, rank: "Gold 1" },
  },
};

const START = new Date("2026-01-01T18:00:00Z");

function matches(): SessionMatch[] {
  const out: SessionMatch[] = [];
  let i = 0;
  for (const [key, results] of PLAY) {
    for (const result of results) {
      out.push({
        externalMatchId: `sample-${String(i).padStart(3, "0")}`,
        playedAt: new Date(START.getTime() + (i + 1) * 300_000),
        mode: "ranked",
        result,
        characterKey: key,
        characterName: NAMES[key] ?? key,
        opponentCharacter: null,
        opponentName: null,
      });
      i++;
    }
  }
  return out;
}

export const SAMPLE_CHARACTER_KEYS = ["ryu", "chunli", "jamie", "cammy"] as const;
export type SampleCharacterKey = (typeof SAMPLE_CHARACTER_KEYS)[number];

/**
 * @param focus character featured as "active" in the sample (preview-only choice; an overlay
 *   with a pinned `ratingCharacterKey` that exists here still shows that one).
 * @param rank optional sample rank/rating for the focused character (rank-aware themes).
 */
function ownDelta(key: SampleCharacterKey): number {
  const r = RATINGS[key];
  return r?.start && r.now ? r.now.value - r.start.value : 0;
}

export function sampleMultiCharacterState(
  focus: SampleCharacterKey = "ryu",
  rank?: SampleRank,
): PlayerLiveState {
  const all = matches();
  const capturedAt = START;
  const observedAt = new Date(START.getTime() + 24 * 3_600_000);
  const keys = Object.keys(RATINGS);
  const baselines: CharacterBaseline[] = keys.map((k) => ({
    characterKey: k,
    characterName: NAMES[k] ?? k,
    source: "session_start",
    rating: RATINGS[k]?.start ?? null,
    capturedAt,
  }));
  const current: CharacterSnapshot[] = keys.map((k) => ({
    characterKey: k,
    characterName: NAMES[k] ?? k,
    rating:
      k === focus && rank
        ? { system: rank.system, value: rank.value, rank: rank.rank }
        : (RATINGS[k]?.now ?? null),
    observedAt,
  }));
  const summary = summarizeSession({
    status: "active",
    ratingModel: "per_character",
    baseline: {
      startedAt: START,
      endedAt: null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: { modes: ["ranked"] },
    },
    matches: all,
    characterBaselines:
      rank === undefined
        ? baselines
        : baselines.map((b) =>
            b.characterKey === focus
              ? {
                  ...b,
                  // The focused character keeps its own session delta (0 for an unplayed one).
                  rating: {
                    system: rank.system,
                    value: rank.value - ownDelta(focus),
                    rank: rank.rank,
                  },
                }
              : b,
          ),
    current,
    favoriteCharacterKey: null,
  });
  const session = toLiveSessionState("sample-session", summary, {
    characters: [],
    activeCharacterKey: null,
  });
  return {
    player: { displayName: "Player" },
    session: { ...session, activeCharacterKey: focus },
    generatedAt: new Date(0).toISOString(),
  };
}
