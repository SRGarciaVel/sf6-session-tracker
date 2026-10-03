/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PLUG YOUR REAL CFN EXTRACTOR IN HERE  (enable with SF6_PROVIDER=capcom)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contract (see ../provider.ts):
 *   - getPlayerProfile(cfnUserId) → NormalizedPlayerProfile
 *   - getRecentMatches(cfnUserId) → NormalizedSF6Match[]
 *
 * Rules:
 *   1. Only fetch + normalize. No session or stats logic here.
 *   2. Resolve P1/P2 into the tracked player's perspective (`result`, `playerCharacter`,
 *      `opponent`).
 *   3. `externalMatchId` must be stable and unique per match (replay/battle id).
 *   4. Map the source's battle type into `mode` ("ranked" | "casual" | "battle_hub" |
 *      "custom_room" | "unknown").
 *   5. Throw SF6ProviderError with the right code:
 *        - "not_found"     player doesn't exist (permanent; not retried)
 *        - "rate_limited"  HTTP 429 — pass `retryAfterMs` if known
 *        - "unavailable"   5xx / network / maintenance
 *        - "invalid_response" unexpected payload shape
 *   6. Pass `options.signal` to fetch() so timeouts cancel the request.
 *   7. Keep credentials (cookies, tokens) in server env vars. Never log them.
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
