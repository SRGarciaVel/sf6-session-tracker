/**
 * Zod validation of the normalized provider contract (profile + matches). Shared by the server
 * (defence against a broken provider / companion) and the browser companion (self-check before
 * sending). Pure: zod only.
 */
import { z } from "zod";
import {
  CHARACTER_KEY_PATTERN,
  MATCH_MODES,
  MATCH_RESULTS,
  RATING_SYSTEMS,
  type CharacterRatingProfile,
  type NormalizedPlayerProfile,
  type NormalizedSF6Match,
  type RatingPoint,
} from "./types";
/** CFN User IDs are numeric "user codes". Centralized so the rule lives in one place. */
export const cfnUserIdSchema = z
  .string()
  .trim()
  .regex(/^\d{6,12}$/, "A CFN User ID is a 6–12 digit number");

const nullableInt = z.number().int().nullable();

export const characterKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(CHARACTER_KEY_PATTERN, "characterKey must be a lowercase slug like 'aki' or 'm-bison'");

const ratingPointSchema = z.object({
  system: z.enum(RATING_SYSTEMS),
  value: z.number().int(),
  rank: z.string().max(40).nullable().optional(),
  rankTier: z.string().max(40).nullable().optional(),
  phase: z.number().int().nullable().optional(),
}) satisfies z.ZodType<RatingPoint>;

export const characterRatingProfileSchema = z.object({
  characterKey: characterKeySchema,
  characterName: z.string().trim().min(1).max(40),
  rank: z.string().max(40).nullable(),
  rankTier: z.string().max(40).nullable(),
  ratingSystem: z.enum(RATING_SYSTEMS).nullable(),
  leaguePoints: nullableInt,
  masterRate: nullableInt,
  phase: z.number().int().nullable().optional(),
}) satisfies z.ZodType<CharacterRatingProfile>;

export const normalizedProfileSchema = z.object({
  cfnUserId: z.string().min(1),
  displayName: z.string().trim().min(1).max(64),
  favoriteCharacterKey: characterKeySchema.nullable().optional(),
  characters: z.array(characterRatingProfileSchema).max(64),
}) satisfies z.ZodType<NormalizedPlayerProfile>;

export const normalizedMatchSchema = z.object({
  externalMatchId: z.string().trim().min(1).max(128),
  playedAt: z.date().refine((d) => !Number.isNaN(d.getTime()), "invalid date"),
  mode: z.enum(MATCH_MODES),
  result: z.enum(MATCH_RESULTS),
  characterKey: characterKeySchema,
  characterName: z.string().trim().min(1).max(40),
  playerControlType: z.enum(["classic", "modern", "dynamic"]).nullable().optional(),
  opponent: z.object({
    name: z.string().max(64).nullable(),
    characterKey: characterKeySchema.nullable().optional(),
    characterName: z.string().max(40).nullable().optional(),
    rank: z.string().max(40).nullable().optional(),
  }),
  ratingBefore: ratingPointSchema.nullable().optional(),
  ratingAfter: ratingPointSchema.nullable().optional(),
}) satisfies z.ZodType<NormalizedSF6Match>;
