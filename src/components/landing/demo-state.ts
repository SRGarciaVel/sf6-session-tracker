/**
 * Landing demo data (Phase 4.7). Static marketing fixtures — never the visitor's data, no fetch,
 * no DB. Values are pre-computed literals (no session math here; see domain/session/engine.ts).
 * They feed the REAL overlay renderer (OverlayView) through the normal PlayerLiveState shape.
 */
import {
  DEFAULT_OVERLAY_CONFIG,
  OVERLAY_THEMES,
  applyThemeDefaults,
  type OverlayConfig,
  type OverlayThemeId,
} from "@/domain/overlay/config";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import type { MatchResult } from "@/domain/sf6/types";
import type { ThemeVariants } from "@/domain/overlay/variants";
import { DEFAULT_THEME_VARIANTS } from "@/domain/overlay/variants";
import type { Locale } from "@/i18n/locale";

export interface LandingDemoStats {
  wins: number;
  losses: number;
  /** Pre-computed for the demo (12-5 → 70.6). */
  winRate: number;
  rating: number;
  /** Change since the session started. */
  ratingDelta: number;
  streak: number;
  best: number;
  recent: MatchResult[];
  rank: string;
  system: "lp" | "mr";
}

const BEFORE: LandingDemoStats = {
  wins: 11,
  losses: 5,
  winRate: 68.8,
  rating: 1588,
  ratingDelta: 0,
  streak: 3,
  best: 6,
  recent: ["loss", "win", "win", "win"],
  rank: "Master",
  system: "mr",
};
const AFTER: LandingDemoStats = {
  ...BEFORE,
  wins: 12,
  winRate: 70.6,
  rating: 1684,
  ratingDelta: 96,
  streak: 4,
  recent: ["loss", "win", "win", "win", "win"],
};

/** Scene 2 steps, in order. The overlay only changes at "updated". */
export const STORY_STEPS = ["live", "finished", "victory", "updated", "obs"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];
export const STORY_STATS: Record<StoryStep, LandingDemoStats> = {
  live: BEFORE,
  finished: BEFORE,
  victory: BEFORE,
  updated: AFTER,
  obs: AFTER,
};
export const HERO_BEFORE = BEFORE;
export const HERO_AFTER = AFTER;

/** Demo stats → the renderer's live-state shape (one character: Ryu). */
export function landingLiveState(stats: LandingDemoStats): PlayerLiveState {
  const base = sampleLiveState({ rank: stats.rank, system: stats.system, value: stats.rating });
  const [ryu] = base.session.characters;
  return {
    ...base,
    session: {
      ...base.session,
      wins: stats.wins,
      losses: stats.losses,
      totalGames: stats.wins + stats.losses,
      winRate: stats.winRate,
      currentWinStreak: stats.streak,
      bestWinStreak: stats.best,
      recentResults: stats.recent,
      characters: ryu
        ? [
            {
              ...ryu,
              wins: stats.wins,
              losses: stats.losses,
              games: stats.wins + stats.losses,
              // Single character: its own stats equal the session's.
              winRate: stats.winRate,
              currentWinStreak: stats.streak,
              bestWinStreak: stats.best,
              recentResults: stats.recent,
              initial: {
                system: stats.system,
                value: stats.rating - stats.ratingDelta,
                rank: stats.rank,
              },
              current: { system: stats.system, value: stats.rating, rank: stats.rank },
              delta: stats.ratingDelta,
            },
          ]
        : [],
    },
  };
}

/** Landing stages show the overlay large; OverlayView's fit-to-box still prevents overflow. */
export const STAGE_SCALE = 1.5;

/** A real overlay config for a theme, as a new overlay would start (plus rank shown). */
export function landingOverlayConfig(
  theme: OverlayThemeId,
  locale: Locale,
  extra: Partial<OverlayConfig> = {},
): OverlayConfig {
  const base = applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme);
  return {
    ...base,
    preset: theme === "minimal" ? "compact" : base.preset === "detailed" ? "detailed" : "standard",
    fields: { ...base.fields, rank: true, winStreak: true },
    locale,
    ...extra,
  };
}

/** Scene 4: every registered theme, in registry order (Free first, then Creator). */
export const SHOWCASE_THEMES: readonly OverlayThemeId[] = OVERLAY_THEMES;

/** Scene 5: a Creator style being built step by step, ending in a saved preset. */
export const CREATOR_SEQUENCE = ["theme", "variant", "density", "glow", "preset"] as const;
export type CreatorStep = (typeof CREATOR_SEQUENCE)[number];

export function creatorPreviewConfig(step: CreatorStep, locale: Locale): OverlayConfig {
  const at = CREATOR_SEQUENCE.indexOf(step);
  if (step === "preset") {
    return landingOverlayConfig("prestige", locale, {
      scale: STAGE_SCALE,
      variants: {
        ...DEFAULT_THEME_VARIANTS,
        prestige: { glow: "strong", frame: "normal", animatedAccent: false },
      },
    });
  }
  const rankCard: ThemeVariants["rank-card"] = {
    density: at >= 2 ? "compact" : "normal",
    badge: at >= 1 ? "large" : "normal",
    glow: at >= 3 ? "strong" : "subtle",
    background: "translucent",
  };
  return landingOverlayConfig("rank-card", locale, {
    scale: STAGE_SCALE,
    variants: { ...DEFAULT_THEME_VARIANTS, "rank-card": rankCard },
  });
}
