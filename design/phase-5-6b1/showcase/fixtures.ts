/**
 * Fictional, internally consistent showcase data. Every derived number (W/L, win rate, streaks,
 * session deltas, the pending hold) comes from the REAL session engine (`summarizeSession` →
 * `toLiveSessionState`) and is mapped by the production adapters — nothing is hand-computed.
 *
 * Player «Yasmine» (fictional), main Ryu on MR; a second character on LP for the LP label.
 */
import { assessCompanion, type CompanionSignals } from "@/domain/companion/readiness";
import { toLiveSessionState, type LiveSessionState } from "@/domain/overlay/state";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type CharacterBaseline,
  type CharacterSnapshot,
  type SessionMatch,
} from "@/domain/session/engine";
import type { MatchResult } from "@/domain/sf6/types";
import type { MatchRowLike } from "@/components/fight-session";

export const NOW = Date.parse("2026-10-21T20:40:00Z");
const START = new Date("2026-10-21T19:30:00Z");
const at = (min: number) => new Date(START.getTime() + min * 60_000);

/** [result, opponent character, MR after] — the profile observed after each match. */
const SCRIPT: Array<[MatchResult, string, number]> = [
  ["win", "Ken", 1583],
  ["win", "Juri", 1594],
  ["loss", "Luke", 1581],
  ["win", "Cammy", 1591],
  ["loss", "JP", 1579],
  ["win", "Marisa", 1593],
  ["win", "Guile", 1602],
  ["loss", "Kimberly", 1591],
  ["win", "Ed", 1603],
  ["win", "Lily", 1613],
];
const BASELINE = 1571;

function match(i: number, character = "ryu", name = "Ryu"): SessionMatch {
  const [result, opp] = SCRIPT[i % SCRIPT.length]!;
  return {
    externalMatchId: `demo-${i + 1}`,
    playedAt: at((i + 1) * 6),
    mode: "ranked",
    result,
    characterKey: character,
    characterName: name,
    opponentCharacter: opp,
    opponentName: i === 3 ? "UnNombreDeRivalMuyLargoParaProbarElTruncado" : `Rival ${i + 1}`,
    ratingBefore: null,
    ratingAfter: null, // battlelog replays never carry it
  };
}

const ryuBase: CharacterBaseline = {
  characterKey: "ryu",
  characterName: "Ryu",
  source: "session_start",
  rating: { system: "mr", value: BASELINE, rank: "Master" },
  capturedAt: START,
};

function session(input: {
  games: number;
  status: "active" | "ended";
  /** Minute of the latest profile observation; null = none after the start. */
  snapshotAfter: number | "latest" | "none";
  baselineKnown?: boolean;
}): LiveSessionState {
  const matches = Array.from({ length: input.games }, (_, i) => match(i));
  let current: CharacterSnapshot[] = [];
  if (input.snapshotAfter !== "none" && input.games > 0) {
    const idx = input.snapshotAfter === "latest" ? input.games - 1 : input.snapshotAfter;
    current = [
      {
        characterKey: "ryu",
        characterName: "Ryu",
        rating: { system: "mr", value: SCRIPT[idx]![2], rank: "Master" },
        observedAt: at((idx + 1) * 6 + 1),
      },
    ];
  }
  const summary = summarizeSession({
    status: input.status,
    ratingModel: "per_character",
    baseline: {
      startedAt: START,
      endedAt: input.status === "ended" ? at(input.games * 6 + 4) : null,
      baselineMatchId: null,
      baselinePlayedAt: null,
      filter: DEFAULT_SESSION_FILTER,
    },
    matches,
    characterBaselines: input.baselineKnown === false ? [] : [ryuBase],
    current,
    favoriteCharacterKey: "ryu",
  });
  return toLiveSessionState("demo-session", summary, {
    characters: [],
    activeCharacterKey: "ryu",
  });
}

/** Session at any point of the script (interactive preview). */
export const liveSession = (games: number) =>
  games === 0
    ? session({ games: 0, status: "active", snapshotAfter: "none" })
    : session({ games, status: "active", snapshotAfter: "latest" });
export const endedSession = (games: number) =>
  games === 0
    ? session({ games: 0, status: "ended", snapshotAfter: "none" })
    : session({ games, status: "ended", snapshotAfter: "latest" });

export const SESSIONS = {
  none: {
    ...session({ games: 0, status: "active", snapshotAfter: "none" }),
    status: "none" as const,
  },
  liveEmpty: session({ games: 0, status: "active", snapshotAfter: "none" }),
  live: session({ games: 7, status: "active", snapshotAfter: "latest" }),
  /** Match 7 ingested from the battlelog, profile still from match 6 ⇒ held rating. */
  livePending: session({ games: 7, status: "active", snapshotAfter: 5 }),
  ended: session({ games: 10, status: "ended", snapshotAfter: "latest" }),
  /** Ended without a profile after the start ⇒ final MR unknown. */
  endedNoRating: session({ games: 10, status: "ended", snapshotAfter: "none" }),
  endedEmpty: session({ games: 0, status: "ended", snapshotAfter: "none" }),
};

export function matchRows(games: number): MatchRowLike[] {
  return Array.from({ length: games }, (_, i) => {
    const m = match(i);
    return {
      id: m.externalMatchId,
      result: m.result,
      characterName: m.characterName,
      opponentCharacter: m.opponentCharacter,
      opponentName: m.opponentName,
      playedAt: m.playedAt,
    };
  });
}

/** Companion signals → readiness (the real assessment). */
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const signals = (over: Partial<CompanionSignals>): CompanionSignals => ({
  required: true,
  deviceCount: 1,
  lastSeenAt: ago(12_000),
  installedVersion: "0.4.0",
  profileObservedAt: ago(40_000),
  matchesObservedAt: ago(12_000),
  hasProfile: true,
  characterCount: 3,
  maxAgeMs: 300_000,
  serverTime: new Date(NOW).toISOString(),
  ...over,
});
export const READINESS = {
  connected: assessCompanion(signals({}), NOW),
  quiet: assessCompanion(
    signals({ lastSeenAt: ago(6 * 60_000), matchesObservedAt: ago(6 * 60_000) }),
    NOW,
  ),
  disconnected: assessCompanion(
    signals({ deviceCount: 0, lastSeenAt: null, profileObservedAt: null, matchesObservedAt: null }),
    NOW,
  ),
};
export const LAST_SYNC = { connected: ago(12_000), quiet: ago(6 * 60_000), disconnected: null };

export const OVERLAYS = [
  {
    id: "ov-1",
    name: "Marcador",
    kind: "session" as const,
    canvas: { width: 800, height: 180 },
    url: "https://sst.example/overlay/demo-token-1",
    inObs: true,
  },
  {
    id: "ov-2",
    name: "Progreso de rango",
    kind: "rankProgress" as const,
    canvas: { width: 640, height: 140 },
    url: "https://sst.example/overlay/demo-token-2",
    inObs: false,
  },
  {
    id: "ov-3",
    name: "Marcador principal para los directos de los viernes por la noche",
    kind: "session" as const,
    canvas: { width: 800, height: 180 },
    url: "https://sst.example/overlay/demo-token-3",
    inObs: null,
  },
];
