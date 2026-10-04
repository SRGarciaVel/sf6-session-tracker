/**
 * SF6DataProvider — the ONLY boundary between this app and Capcom / CFN.
 *
 * Implementations fetch raw data and normalize it into the domain types. They must not compute
 * sessions, stats or anything UI-related. Swap implementations with SF6_PROVIDER (see ./index.ts).
 */
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";

export interface ProviderCallOptions {
  /** Aborted on timeout; implementations should pass it to fetch(). */
  signal?: AbortSignal;
  /**
   * The account the data is read FOR. Providers whose data is pushed per account (companion)
   * MUST only answer from that account's data (SEC-001); the others ignore it.
   */
  scope?: { userId: string };
}

export interface SF6DataProvider {
  readonly name: string;

  /**
   * Current profile (name, rank, LP, MR) for a CFN User ID.
   * @throws SF6ProviderError code "not_found" if the player does not exist.
   */
  getPlayerProfile(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedPlayerProfile>;

  /**
   * The player's most recent matches (any order; duplicates allowed — ingestion dedupes).
   * Return whatever the source's "latest page" holds (typically 10–20 matches).
   */
  getRecentMatches(cfnUserId: string, options?: ProviderCallOptions): Promise<NormalizedSF6Match[]>;
}

/** Result of an incremental battlelog read (optional provider capability). */
export interface MatchesSince {
  matches: NormalizedSF6Match[];
  pagesFetched: number;
  /** Known ids existed but none was reached: matches may be missing. Never silently ignored. */
  gapSuspected: boolean;
}

/**
 * Optional capability: read history back until a known match id is found (bounded).
 * Not used by the worker yet; detect with `supportsMatchesSince`.
 */
export interface MatchHistoryCapable {
  getMatchesSince(
    cfnUserId: string,
    knownMatchIds: ReadonlySet<string>,
    options?: ProviderCallOptions,
  ): Promise<MatchesSince>;
}

export function supportsMatchesSince(
  provider: SF6DataProvider,
): provider is SF6DataProvider & MatchHistoryCapable {
  return typeof (provider as Partial<MatchHistoryCapable>).getMatchesSince === "function";
}

export type ProviderErrorCode =
  "not_found" | "rate_limited" | "unavailable" | "timeout" | "invalid_response";

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
// The contract schemas live in the shared core so the browser companion validates identically.
export {
  cfnUserIdSchema,
  characterKeySchema,
  characterRatingProfileSchema,
  normalizedMatchSchema,
  normalizedProfileSchema,
} from "@sf6/capcom-core";
