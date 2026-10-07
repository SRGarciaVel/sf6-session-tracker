/**
 * Builder "Play update" (Phase 5.0): a local before → after pair for the preview. Pure demo
 * data in the normal live-state shape — no API, DB, session or SSE involved, never saved.
 * Values are literals (no session math). A fixed session id makes the switch INTO the
 * simulation a "different session" (nothing plays) and before → after exactly one match.
 */
import type { MatchResult } from "@/domain/sf6/types";
import { MASTER_TIER_LABELS, masterTierFromMr } from "@/domain/sf6/master-tier";
import { sampleLiveState, type PlayerLiveState } from "./state";

/** Display tier of a sample MR (the same rule the live state applies). */
const tierOf = (mr: number) => MASTER_TIER_LABELS[masterTierFromMr(mr) ?? "master"];

export type SimulatedResult = "win" | "loss";
export type SimulationPhase = "before" | "after";

export const SIMULATION_SESSION_ID = "preview-simulation";

interface SimStats {
  wins: number;
  losses: number;
  winRate: number;
  rating: number;
  delta: number;
  streak: number;
  recent: MatchResult[];
}

const BEFORE: SimStats = {
  wins: 11,
  losses: 5,
  winRate: 68.8,
  rating: 1588,
  delta: 0,
  streak: 3,
  recent: ["loss", "win", "win", "win"],
};
const AFTER: Record<SimulatedResult, SimStats> = {
  win: {
    wins: 12,
    losses: 5,
    winRate: 70.6,
    rating: 1684,
    delta: 96,
    streak: 4,
    recent: [...BEFORE.recent, "win"],
  },
  loss: {
    wins: 11,
    losses: 6,
    winRate: 64.7,
    rating: 1516,
    delta: -72,
    streak: 0,
    recent: [...BEFORE.recent, "loss"],
  },
};

export function simulationState(result: SimulatedResult, phase: SimulationPhase): PlayerLiveState {
  const s = phase === "before" ? BEFORE : AFTER[result];
  const base = sampleLiveState({ rank: tierOf(s.rating), system: "mr", value: s.rating });
  const [ryu] = base.session.characters;
  return {
    ...base,
    session: {
      ...base.session,
      sessionId: SIMULATION_SESSION_ID,
      wins: s.wins,
      losses: s.losses,
      totalGames: s.wins + s.losses,
      winRate: s.winRate,
      currentWinStreak: s.streak,
      currentLossStreak: s.streak === 0 ? 1 : 0,
      recentResults: s.recent,
      characters: ryu
        ? [
            {
              ...ryu,
              wins: s.wins,
              losses: s.losses,
              games: s.wins + s.losses,
              // Single character: its own stats equal the session's.
              winRate: s.winRate,
              currentWinStreak: s.streak,
              currentLossStreak: s.streak === 0 ? 1 : 0,
              recentResults: s.recent,
              initial: { system: "mr", value: BEFORE.rating, rank: tierOf(BEFORE.rating) },
              current: { system: "mr", value: s.rating, rank: tierOf(s.rating) },
              delta: s.delta,
            },
          ]
        : [],
    },
  };
}

/** Time the preview shows the "before" state before the update lands (ms). */
export const SIMULATION_LEAD_MS = 450;
