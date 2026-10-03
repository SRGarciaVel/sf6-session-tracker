/**
 * SF6DataProvider — the ONLY boundary between this app and Capcom / CFN.
 *
 * Implementations fetch raw data and normalize it into the domain types. They must not compute
 * sessions, stats or anything UI-related. Swap implementations with SF6_PROVIDER (see ./index.ts).
 */
import { z } from "zod";
import {
  MATCH_MODES,
  MATCH_RESULTS,
  type NormalizedPlayerProfile,
  type NormalizedSF6Match,
} from "@/domain/sf6/types";

export interface ProviderCallOptions {
  /** Aborted on timeout; implementations should pass it to fetch(). */
  signal?: AbortSignal;
}

export interface SF6DataProvider {
  readonly name: string;

  /**
   * Current profile (name, rank, LP, MR) for a CFN User ID.
   * @throws SF6ProviderError code "not_found" if the player does not exist.
   */
  getPlayerProfile(cfnUserId: string, options?: ProviderCallOptions): Promise<NormalizedPlayerProfile>;

  /**
   * The player's most recent matches (any order; duplicates allowed — ingestion dedupes).
   * Return whatever the source's "latest page" holds (typically 10–20 matches).
   */
  getRecentMatches(cfnUserId: string, options?: ProviderCallOptions): Promise<NormalizedSF6Match[]>;
}

export type ProviderErrorCode =
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "timeout"
  | "invalid_response";

export class SF6ProviderError extends Error {
  override readonly name = "SF6ProviderError";

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly options: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  /** Transient errors are retried with backoff; "not_found" is permanent. */
  get retryable(): boolean {
    return this.code !== "not_found";
  }
}

/* ───────── Validation of provider output (defence against a broken extractor) ───────── */

/** CFN User IDs are numeric "user codes". Centralized so the rule lives in one place. */
export const cfnUserIdSchema = z
  .string()
  .trim()
  .regex(/^\d{6,12}$/, "A CFN User ID is a 6–12 digit number");

const nullableInt = z.number().int().nullable();

export const normalizedProfileSchema = z.object({
  cfnUserId: z.string().min(1),
  displayName: z.string().trim().min(1).max(64),
  mainCharacter: z.string().max(40).nullable(),
  rank: z.string().max(40).nullable(),
  leaguePoints: nullableInt,
  masterRate: nullableInt,
}) satisfies z.ZodType<NormalizedPlayerProfile>;

export const normalizedMatchSchema = z.object({
  externalMatchId: z.string().trim().min(1).max(128),
  playedAt: z.date().refine((d) => !Number.isNaN(d.getTime()), "invalid date"),
  mode: z.enum(MATCH_MODES),
  result: z.enum(MATCH_RESULTS),
  playerCharacter: z.string().max(40).nullable(),
  playerControlType: z.enum(["classic", "modern", "dynamic"]).nullable().optional(),
  opponent: z.object({
    name: z.string().max(64).nullable(),
    character: z.string().max(40).nullable(),
    rank: z.string().max(40).nullable().optional(),
  }),
  ratingAfter: z
    .object({ leaguePoints: nullableInt, masterRate: nullableInt })
    .nullable()
    .optional(),
}) satisfies z.ZodType<NormalizedSF6Match>;
