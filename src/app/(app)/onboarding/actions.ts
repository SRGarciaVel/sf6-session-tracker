"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { resolveRatingSystem, type RatingSystem } from "@/domain/sf6/rating";
import { getRequestLocale } from "@/i18n/server";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { upsertPlayerForUser } from "@/server/players/service";
import { rateLimit } from "@/server/security/rate-limit";
import { cfnUserIdSchema, getSF6DataProvider } from "@/server/sf6";
import { providerErrorKey } from "@/server/sf6/messages";
import { setUserLocale } from "@/server/users/locale";

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
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));

  const parsed = cfnUserIdSchema.safeParse(rawId);
  if (!parsed.success) return fail(t("cfnInvalid"));

  // Protects Capcom from lookup spam; each lookup may hit CFN.
  const limit = rateLimit(`cfn-lookup:${user.id}`, 10, 60_000);
  if (!limit.ok) return fail(t("tooManyLookups", { seconds: limit.retryAfterSeconds }));

  try {
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data);
    return ok({ ...profile, ratingSystem: resolveRatingSystem(profile) });
  } catch (err) {
    logger.warn("onboarding.lookup_failed", { userId: user.id, error: err });
    return fail(t(`provider.${providerErrorKey(err)}`));
  }
}

/** Step 3: confirm. Re-fetches the profile server-side; never trusts client-provided data. */
export async function confirmPlayerAction(rawId: string): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));

  const parsed = cfnUserIdSchema.safeParse(rawId);
  if (!parsed.success) return fail(t("cfnInvalid"));

  try {
    const db = getDb();
    const locale = await getRequestLocale();
    // First explicit-or-default language becomes the account preference if none is stored yet.
    if (!user.locale) await setUserLocale(db, user.id, locale);
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data);
    const tOnboarding = await getTranslations("Onboarding");
    await upsertPlayerForUser(db, user.id, profile, {
      name: tOnboarding("defaultOverlayName"),
      locale,
    });
    logger.info("onboarding.player_registered", { userId: user.id });
  } catch (err) {
    logger.warn("onboarding.confirm_failed", { userId: user.id, error: err });
    return fail(t(`provider.${providerErrorKey(err)}`));
  }
  redirect("/dashboard?welcome=1");
}
