/**
 * Rank Progress overlay (Phase 5.4B): an independent overlay KIND ("rank-progress"), not a
 * Session theme. "Where am I now, and how far am I from my next rank goal?" — current-state
 * presentation of ONE character's rating; no history, no analytics, no leaderboard.
 *
 * Config: its own minimal schema (no Session fields: no stat toggles, scope, themes, Creator
 * block). Free: no entitlement gates anything here. Lives in `overlay.config` like every kind.
 *
 * View: resolveRankProgressView() is the ONE projection the renderer uses — character selection
 * (pickRatingCharacter, the Session overlay's own rule), the ladder math (domain/sf6/
 * rank-progress.ts) and the optional authoritative session delta. React only formats it.
 */
import { z } from "zod";
import { CHARACTER_KEY_PATTERN } from "@/domain/sf6/rating";
import {
  RANK_PROGRESS_GOALS,
  rankProgress,
  type RankProgressState,
  type RatingSystemId,
} from "@/domain/sf6/rank-progress";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locale";
import { FONT_IDS } from "./fonts";
import { pickRatingCharacter, type LiveSessionState } from "./state";

/** Rank Progress styles (NOT Session themes: never in THEME_IDS). Both Free. */
export const RANK_PROGRESS_STYLES = ["broadcast", "compact"] as const;
export type RankProgressStyle = (typeof RANK_PROGRESS_STYLES)[number];

/** OBS Browser Source size per style (each style has exactly one canvas). */
export const RANK_PROGRESS_CANVASES = {
  broadcast: { width: 640, height: 140 },
  compact: { width: 400, height: 140 },
} as const satisfies Record<RankProgressStyle, { width: number; height: number }>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb color");

export const rankProgressOverlayConfigSchema = z.object({
  /** Required: a Rank Progress config always says so (a missing kind is a legacy Session one). */
  kind: z.literal("rank-progress"),
  version: z.literal(1),
  /** Overlay language, independent from the streamer's dashboard language. */
  locale: z.enum(LOCALES),
  /** null = the active character (latest Ranked match); a key pins it (same rule as Session). */
  characterKey: z.string().regex(CHARACTER_KEY_PATTERN).max(40).nullable(),
  /** "auto" = next division (LP) / next Master tier (MR); "master" = Road to Master (LP). */
  goal: z.enum(RANK_PROGRESS_GOALS),
  style: z.enum(RANK_PROGRESS_STYLES),
  showSessionDelta: z.boolean(),
  showRemaining: z.boolean(),
  showCharacterName: z.boolean(),
  font: z.enum(FONT_IDS),
  textColor: hexColor,
  mutedColor: hexColor,
  accentColor: hexColor,
  backgroundColor: hexColor,
  backgroundOpacity: z.number().min(0).max(1),
  borderEnabled: z.boolean(),
  borderColor: hexColor,
  borderWidth: z.number().int().min(0).max(8),
  borderRadius: z.number().int().min(0).max(40),
  animations: z.boolean(),
});

export type RankProgressOverlayConfig = z.infer<typeof rankProgressOverlayConfigSchema>;

/** Free defaults in SST's HUD palette (same base colors as the Session default). */
export const DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG: RankProgressOverlayConfig = {
  kind: "rank-progress",
  version: 1,
  locale: DEFAULT_LOCALE,
  characterKey: null,
  goal: "auto",
  style: "broadcast",
  showSessionDelta: true,
  showRemaining: true,
  showCharacterName: true,
  font: "barlow-condensed",
  textColor: "#f4f6ff",
  mutedColor: "#a3acd0",
  accentColor: "#2fe0ff",
  backgroundColor: "#070a16",
  backgroundOpacity: 0.82,
  borderEnabled: false,
  borderColor: "#2fe0ff",
  borderWidth: 2,
  borderRadius: 0,
  animations: true,
};

/**
 * Lenient read of a stored Rank Progress config: defaults for missing keys; an unusable config is
 * the Rank Progress DEFAULT (the row stays this kind — kind never changes on read).
 */
export function parseRankProgressOverlayConfig(
  obj: Record<string, unknown>,
): RankProgressOverlayConfig {
  const parsed = rankProgressOverlayConfigSchema.safeParse({
    ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
    ...obj,
    kind: "rank-progress",
    version: 1,
  });
  return parsed.success ? parsed.data : DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG;
}

export interface RankProgressView {
  /** Ladder position / progress of the selected character's CURRENT rating. */
  state: RankProgressState;
  /** Selected character's name; null when none can be resolved. */
  characterName: string | null;
  /**
   * Authoritative session change to show (the character's own `delta`), or null = hidden: the
   * option is off, the starting rating is unknown, or no comparable delta exists. Unknown is never
   * shown as zero; a KNOWN zero is shown (±0).
   */
  sessionDelta: { value: number; system: RatingSystemId } | null;
}

/**
 * THE Rank Progress projection. Works without a session (status "none": the roster still has
 * current ratings). Current rating = `current.value` (authoritative, never initial + delta).
 */
export function resolveRankProgressView(
  session: LiveSessionState,
  config: Pick<RankProgressOverlayConfig, "characterKey" | "goal" | "showSessionDelta">,
): RankProgressView {
  const character = pickRatingCharacter(session, config.characterKey);
  const current = character?.current ?? null;
  const state = rankProgress(current, config.goal);
  const sessionDelta =
    config.showSessionDelta &&
    state.kind !== "no-rating" &&
    character?.baselineKnown === true &&
    character.delta !== null &&
    Number.isFinite(character.delta) &&
    current
      ? { value: character.delta, system: current.system }
      : null;
  return { state, characterName: character?.characterName ?? null, sessionDelta };
}
