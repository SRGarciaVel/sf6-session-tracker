/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PLUG YOUR REAL CFN EXTRACTOR IN HERE  (enable with SF6_PROVIDER=capcom)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contract (see ../provider.ts):
 *   - getPlayerProfile(cfnUserId) → NormalizedPlayerProfile
 *   - getRecentMatches(cfnUserId) → NormalizedSF6Match[]
 *
 * WHAT TO MAP (ratings belong to CHARACTERS, never to the player):
 *
 *   Profile — NormalizedPlayerProfile
 *     cfnUserId              the requested id, echoed back
 *     displayName            fighter name as shown on CFN
 *     favoriteCharacterKey   character on the profile card (optional)
 *     characters[]           ONE entry per character with league data:
 *       characterKey         stable slug: "aki", "kimberly", "m-bison", "chun-li"
 *                            (map from CFN's internal character id, NOT the localized name)
 *       characterName        display name
 *       rank                 rank label as shown ("Diamond 2", "Master")
 *       rankTier             normalized tier if derivable ("diamond-2", "master"), else null
 *       ratingSystem         "lp" | "mr" — DECLARE it; the app never guesses from the label
 *       leaguePoints         LP (null if not applicable)
 *       masterRate           MR (null unless Master)
 *       phase                MR phase / season number if CFN exposes it
 *
 *   Match — NormalizedSF6Match
 *     externalMatchId        stable unique replay/battle id (same on every page)
 *     playedAt               absolute instant in UTC (document: start or end of the match)
 *     mode                   "ranked" | "casual" | "battle_hub" | "custom_room" | "unknown"
 *     result                 "win" | "loss" | "draw", from the tracked player's perspective
 *     characterKey + characterName   character the tracked player used (REQUIRED)
 *     opponent               { name, characterKey?, characterName?, rank? }
 *     ratingBefore / ratingAfter     { system, value, rank?, rankTier?, phase? } for that
 *                            character, if the battle log exposes them (verify which side of
 *                            the match the value is!). Highly recommended: they give exact
 *                            per-character deltas and save profile calls.
 *     Exclude cancelled / disconnected entries unless they really count as a result.
 *
 * Rules:
 *   1. Only fetch + normalize. No session or stats logic here.
 *   2. Resolve P1/P2 into the tracked player's perspective.
 *   3. Throw SF6ProviderError with the right code:
 *        - "not_found"     player doesn't exist (permanent; not retried)
 *        - "rate_limited"  HTTP 429 — pass `retryAfterMs` if known
 *        - "unavailable"   5xx / network / maintenance / extractor session expired
 *        - "invalid_response" unexpected payload shape
 *   4. Pass `options.signal` to fetch() so timeouts cancel the request.
 *   5. Keep credentials (cookies, tokens) in server env vars. Never log them.
 *
 * Verify with: pnpm provider:check <cfnId>
 *
 * Timeouts, caching, single-flight and output validation are added automatically by
 * ResilientProvider; you don't need to implement them.
 */
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import { SF6ProviderError, type ProviderCallOptions, type SF6DataProvider } from "../provider";

export class CapcomSF6DataProvider implements SF6DataProvider {
  readonly name = "capcom";

  async getPlayerProfile(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedPlayerProfile> {
    void cfnUserId;
    void options;
    throw new SF6ProviderError(
      "unavailable",
      "CapcomSF6DataProvider is not implemented yet. Plug your extractor into src/server/sf6/providers/capcom.ts",
    );
  }

  async getRecentMatches(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedSF6Match[]> {
    void cfnUserId;
    void options;
    throw new SF6ProviderError(
      "unavailable",
      "CapcomSF6DataProvider is not implemented yet. Plug your extractor into src/server/sf6/providers/capcom.ts",
    );
  }
}
