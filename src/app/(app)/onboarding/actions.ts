"use server";

import { redirect } from "next/navigation";
import { resolveRatingSystem, type RatingSystem } from "@/domain/sf6/rating";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { upsertPlayerForUser } from "@/server/players/service";
import { rateLimit } from "@/server/security/rate-limit";
import { cfnUserIdSchema, getSF6DataProvider } from "@/server/sf6";
import { providerErrorMessage } from "@/server/sf6/messages";

export interface PlayerPreview {
  cfnUserId: string;
  displayName: string;
  mainCharacter: string | null;
  rank: string | null;
  leaguePoints: number | null;
  masterRate: number | null;
  ratingSystem: RatingSystem;
}

/** Step 2: validate a CFN User ID through the data provider. */
export async function lookupPlayerAction(rawId: string): Promise<ActionResult<PlayerPreview>> {
  const user = await getCurrentUser();
  if (!user) return fail("Your session expired. Please log in again.");

  const parsed = cfnUserIdSchema.safeParse(rawId);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid CFN User ID");

  // Protects Capcom from lookup spam; each lookup may hit CFN.
  const limit = rateLimit(`cfn-lookup:${user.id}`, 10, 60_000);
  if (!limit.ok) return fail(`Too many lookups. Try again in ${limit.retryAfterSeconds}s.`);

  try {
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data);
    return ok({ ...profile, ratingSystem: resolveRatingSystem(profile) });
  } catch (err) {
    logger.warn("onboarding.lookup_failed", { userId: user.id, error: err });
    return fail(providerErrorMessage(err));
  }
}

/** Step 3: confirm. Re-fetches the profile server-side; never trusts client-provided data. */
export async function confirmPlayerAction(rawId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Your session expired. Please log in again.");

  const parsed = cfnUserIdSchema.safeParse(rawId);
  if (!parsed.success) return fail("Invalid CFN User ID");

  try {
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data);
    await upsertPlayerForUser(getDb(), user.id, profile);
    logger.info("onboarding.player_registered", { userId: user.id });
  } catch (err) {
    logger.warn("onboarding.confirm_failed", { userId: user.id, error: err });
    return fail(providerErrorMessage(err));
  }
  redirect("/dashboard?welcome=1");
}
