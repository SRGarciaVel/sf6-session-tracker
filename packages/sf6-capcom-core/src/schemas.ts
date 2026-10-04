/**
 * Zod schemas for the Buckler's Boot Camp payloads, limited to the fields the provider reads.
 * Every object is loose: Capcom adds fields all the time and that must never break parsing.
 *
 * Shapes come exclusively from the manually captured HAR (see docs/capcom-provider.md and the
 * sanitized fixtures in tests/fixtures/capcom/). Nothing here is guessed.
 */
import { z } from "zod";

const int = z.number().int();
/** The card endpoint has been seen with numbers; accept numeric strings too (same value). */
const intLike = z.union([
  int,
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number),
]);

/** `league_info` / `*_info` rating block (character_league_infos[], player{1,2}_info). */
export const leagueInfoSchema = z.looseObject({
  league_point: int,
  league_rank: int,
  master_league: int,
  master_rating: int,
  master_rating_ranking: int,
});
export type CapcomLeagueInfo = z.infer<typeof leagueInfoSchema>;

const personalInfoSchema = z.looseObject({
  fighter_id: z.string().min(1),
  short_id: int,
});

/** `fighter_banner_info` — present on every profile page (play, battlelog). */
export const fighterBannerSchema = z.looseObject({
  personal_info: personalInfoSchema,
  /** true only when the logged-in viewer IS this CFN (observed on the user's own pages). */
  is_my_data: z.boolean().optional(),
  favorite_character_tool_name: z.string().optional(),
  favorite_character_league_info: z
    .looseObject({
      league_rank: int,
      league_rank_info: z
        .looseObject({ league_rank_name: z.string(), league_rank_number: int.optional() })
        .optional(),
    })
    .optional(),
});
export type CapcomFighterBanner = z.infer<typeof fighterBannerSchema>;

/* ───────── GET /api/en/card/{cfnId} ───────── */

export const cardSchema = z.looseObject({
  sid: intLike,
  fighter_name: z.string().min(1),
  favorite_character_tool_name: z.string().optional(),
  league_rank_number: intLike.optional(),
  lp: intLike.optional(),
  mr: intLike.optional(),
});
export type CapcomCardPayload = z.infer<typeof cardSchema>;

/* ───────── GET /_next/data/{buildId}/en/profile/{cfnId}/play.json?sid={cfnId} ───────── */

export const characterLeagueInfoSchema = z.looseObject({
  character_id: int,
  character_name: z.string().min(1),
  character_tool_name: z.string().min(1),
  is_played: z.boolean(),
  league_info: leagueInfoSchema,
});
export type CapcomCharacterLeagueInfo = z.infer<typeof characterLeagueInfoSchema>;

export const playPageSchema = z.looseObject({
  pageProps: z.looseObject({
    sid: int,
    fighter_banner_info: fighterBannerSchema,
    play: z.looseObject({
      current_season_id: int.optional(),
      season_ids: z.array(int).optional(),
      character_league_infos: z.array(characterLeagueInfoSchema),
    }),
  }),
});
export type CapcomPlayPage = z.infer<typeof playPageSchema>;

/* ───────── GET /_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?[page=N&]sid={cfnId} ───────── */

export const replaySideSchema = leagueInfoSchema.extend({
  player: z.looseObject({
    fighter_id: z.string(),
    short_id: int,
  }),
  character_id: int,
  character_name: z.string().min(1),
  character_tool_name: z.string().min(1),
  playing_character_tool_name: z.string().optional(),
  battle_input_type: int.optional(),
  round_results: z.array(int),
});
export type CapcomReplaySide = z.infer<typeof replaySideSchema>;

export const replaySchema = z.looseObject({
  replay_id: z.string().trim().min(1),
  uploaded_at: int.positive(),
  replay_battle_type: int,
  replay_battle_type_name: z.string().optional(),
  player1_info: replaySideSchema,
  player2_info: replaySideSchema,
});
export type CapcomReplay = z.infer<typeof replaySchema>;

/** Page envelope; replays are validated one by one so a single odd entry can't sink the page. */
export const battlelogPageSchema = z.looseObject({
  pageProps: z.looseObject({
    sid: int,
    current_page: int,
    total_page: int,
    replay_list: z.array(z.unknown()),
  }),
});
