/**
 * CompanionSF6DataProvider — serves the latest observation pushed by the user's browser
 * companion (companion_snapshot). Lets session start/end, onboarding lookup and the worker keep
 * using the SF6DataProvider contract unchanged while the data is acquired in the browser.
 *
 * Fails with "unavailable" when there is no snapshot or it is older than
 * COMPANION_SNAPSHOT_MAX_AGE_MS: a session must never start on a stale baseline.
 *
 * Companion data is client-asserted, so it is strictly PER ACCOUNT: only the snapshot pushed by
 * the account in `options.scope` is ever read (SEC-001 — no cross-account injection/squatting).
 */
import { and, eq } from "drizzle-orm";
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import type { DbExecutor } from "@/server/db/client";
import { companionSnapshot } from "@/server/db/schema";
import { SF6ProviderError, type ProviderCallOptions, type SF6DataProvider } from "../provider";

export class CompanionSF6DataProvider implements SF6DataProvider {
  readonly name = "companion";

  constructor(
    private readonly db: DbExecutor,
    private readonly maxAgeMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async snapshot(cfnUserId: string, options?: ProviderCallOptions) {
    const userId = options?.scope?.userId;
    if (!userId) {
      throw new SF6ProviderError("unavailable", "Companion data requires the requesting account");
    }
    const [row] = await this.db
      .select()
      .from(companionSnapshot)
      .where(and(eq(companionSnapshot.userId, userId), eq(companionSnapshot.cfnUserId, cfnUserId)))
      .limit(1);
    if (!row) {
      throw new SF6ProviderError(
        "unavailable",
        "No companion data for this CFN yet — open the SF6 Session Companion in your browser",
      );
    }
    return row;
  }

  private assertFresh(observedAt: Date | null, what: string) {
    if (!observedAt || this.now().getTime() - observedAt.getTime() > this.maxAgeMs) {
      throw new SF6ProviderError(
        "unavailable",
        `Companion ${what} is stale — is the browser with the companion open?`,
      );
    }
  }

  async getPlayerProfile(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedPlayerProfile> {
    const row = await this.snapshot(cfnUserId, options);
    this.assertFresh(row.profileObservedAt, "profile");
    if (!row.profile) throw new SF6ProviderError("unavailable", "Companion has not sent a profile");
    return row.profile;
  }

  async getRecentMatches(
    cfnUserId: string,
    options?: ProviderCallOptions,
  ): Promise<NormalizedSF6Match[]> {
    const row = await this.snapshot(cfnUserId, options);
    this.assertFresh(row.matchesObservedAt, "battlelog");
    return row.matches.map((m) => ({ ...m, playedAt: new Date(m.playedAt) }));
  }
}
