/**
 * CapcomSF6DataProvider — real Buckler's Boot Camp adapter (PROTOTYPE, disabled by default).
 *
 * Enabled only with SF6_PROVIDER=capcom. Built exclusively from a manually captured HAR; direct
 * server access to Buckler is NOT proven yet (automated probes got CloudFront 403).
 * See docs/capcom-provider.md.
 *
 *   transport      ./client.ts      (URLs, buildId, cookies, HTTP → SF6ProviderError)
 *   parsing        ./parse.ts       (pure: payload → normalized types + warnings)
 *   ranks          ./league.ts      (evidence-backed league_info mapping)
 *   pagination     ./pagination.ts  (getMatchesSince strategy)
 */
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import type { Logger } from "@/server/logger";
import {
  SF6ProviderError,
  type MatchHistoryCapable,
  type MatchesSince,
  type ProviderCallOptions,
  type SF6DataProvider,
} from "../../provider";
import { CapcomBucklerClient, type CapcomClientOptions } from "./client";
import { collectMatchesSince, DEFAULT_MAX_BATTLELOG_PAGES_PER_POLL } from "./pagination";
import {
  normalizeCapcomMatches,
  normalizeCapcomProfile,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  type NormalizedCapcomMatches,
  type NormalizedCapcomProfile,
} from "./parse";

export interface CapcomProviderOptions {
  maxBattlelogPagesPerPoll?: number;
  logger?: Logger;
  now?: () => Date;
}

/** Everything provider:check shows, including Capcom-only details. */
export interface CapcomInspection {
  profile: NormalizedCapcomProfile;
  matches: NormalizedCapcomMatches;
  pagination: { currentPage: number; totalPage: number; replayCount: number };
}

export class CapcomSF6DataProvider implements SF6DataProvider, MatchHistoryCapable {
  readonly name = "capcom";
  private readonly maxPages: number;
  private readonly logger: Logger | undefined;
  private readonly now: () => Date;

  constructor(
    readonly client: CapcomBucklerClient,
    options: CapcomProviderOptions = {},
  ) {
    this.maxPages = options.maxBattlelogPagesPerPoll ?? DEFAULT_MAX_BATTLELOG_PAGES_PER_POLL;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
  }

  static withClientOptions(
    clientOptions: CapcomClientOptions,
    options: CapcomProviderOptions = {},
  ): CapcomSF6DataProvider {
    return new CapcomSF6DataProvider(
      new CapcomBucklerClient({ ...clientOptions, logger: clientOptions.logger ?? options.logger }),
      options,
    );
  }

  private warn(event: string, cfnUserId: string, warnings: string[]): void {
    if (warnings.length > 0)
      this.logger?.warn(event, { cfnUserId, warnings: warnings.slice(0, 20) });
  }

  private async profileDetails(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedCapcomProfile> {
    const raw = await this.client.getPlayData(cfnUserId, options?.signal);
    const result = normalizeCapcomProfile(parseCapcomPlayPayload(raw), { cfnUserId });
    this.warn("capcom_profile_warnings", cfnUserId, result.warnings);
    return result;
  }

  private async battlelogPage(cfnUserId: string, page: number, signal?: AbortSignal) {
    const parsed = parseCapcomBattlelogPayload(
      await this.client.getBattlelogPage(cfnUserId, page, signal),
    );
    if (parsed.cfnUserId !== cfnUserId) {
      throw new SF6ProviderError(
        "invalid_response",
        `Capcom battlelog belongs to ${parsed.cfnUserId}, expected ${cfnUserId}`,
      );
    }
    return parsed;
  }

  private normalizeMatches(
    cfnUserId: string,
    replays: readonly unknown[],
  ): NormalizedCapcomMatches {
    const result = normalizeCapcomMatches(replays, { trackedCfnId: cfnUserId, now: this.now() });
    this.warn("capcom_match_warnings", cfnUserId, result.warnings);
    return result;
  }

  async getPlayerProfile(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedPlayerProfile> {
    return (await this.profileDetails(cfnUserId, options)).profile;
  }

  /** Battlelog page 1 (10 newest replays, all modes). */
  async getRecentMatches(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedSF6Match[]> {
    const page = await this.battlelogPage(cfnUserId, 1, options?.signal);
    return this.normalizeMatches(cfnUserId, page.replays).matches;
  }

  /** Walk back at most `maxBattlelogPagesPerPoll` pages until a known replay id appears. */
  async getMatchesSince(
    cfnUserId: string,
    knownMatchIds: ReadonlySet<string>,
    options?: ProviderCallOptions,
  ): Promise<MatchesSince> {
    const collected = await collectMatchesSince(
      (page) => this.battlelogPage(cfnUserId, page, options?.signal),
      knownMatchIds,
      this.maxPages,
    );
    const normalized = this.normalizeMatches(cfnUserId, collected.replays);
    if (collected.warnings.length > 0 || collected.gapSuspected) {
      this.logger?.warn("capcom_pagination", {
        cfnUserId,
        pagesFetched: collected.pagesFetched,
        gapSuspected: collected.gapSuspected,
        gapReason: collected.gapReason,
        warnings: collected.warnings,
      });
    }
    return {
      matches: normalized.matches,
      pagesFetched: collected.pagesFetched,
      gapSuspected: collected.gapSuspected,
    };
  }

  /** Full detail for `pnpm provider:check` (raw ids, sides, warnings, pagination). */
  async inspect(cfnUserId: string, options?: ProviderCallOptions): Promise<CapcomInspection> {
    const profile = await this.profileDetails(cfnUserId, options);
    const page = await this.battlelogPage(cfnUserId, 1, options?.signal);
    return {
      profile,
      matches: this.normalizeMatches(cfnUserId, page.replays),
      pagination: {
        currentPage: page.currentPage,
        totalPage: page.totalPage,
        replayCount: page.replays.length,
      },
    };
  }
}

export { CapcomBucklerClient } from "./client";
