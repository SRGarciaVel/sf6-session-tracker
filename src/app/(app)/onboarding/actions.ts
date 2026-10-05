"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ratingPointOf } from "@/domain/sf6/rating";
import type { NormalizedPlayerProfile, RatingSystem } from "@/domain/sf6/types";
import { getRequestLocale } from "@/i18n/server";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import { upsertPlayerForUser } from "@/server/players/service";
import { rateLimit } from "@/server/security/rate-limit";
import { cfnUserIdSchema, getSF6DataProvider } from "@/server/sf6";
import { isMissingCompanionData, providerErrorKey } from "@/server/sf6/messages";
import { setUserLocale } from "@/server/users/locale";

export interface PlayerPreview {
  cfnUserId: string;
  displayName: string;
  /** Favorite character (or the first with a rating): shown as the headline card. */
  character: {
    characterName: string;
    rank: string | null;
    ratingSystem: RatingSystem;
    value: number;
  } | null;
  characterCount: number;
}

function toPreview(profile: NormalizedPlayerProfile): PlayerPreview {
  const rated = profile.characters.filter((c) => ratingPointOf(c) !== null);
  const featured =
    rated.find((c) => c.characterKey === profile.favoriteCharacterKey) ?? rated[0] ?? null;
  const point = featured ? ratingPointOf(featured) : null;
  return {
    cfnUserId: profile.cfnUserId,
    displayName: profile.displayName,
    character:
      featured && point
        ? {
            characterName: featured.characterName,
            rank: featured.rank,
            ratingSystem: point.system,
            value: point.value,
          }
        : null,
    characterCount: profile.characters.length,
  };
}

/** Step 2: validate a CFN User ID through the data provider. */
export async function lookupPlayerAction(rawId: string): Promise<ActionResult<PlayerPreview>> {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));

  const parsed = cfnUserIdSchema.safeParse(rawId);
  if (!parsed.success) return fail(t("cfnInvalid"));

  // Protects Capcom from lookup spam; each lookup may hit CFN.
  const limit = await rateLimit(`cfn-lookup:${user.id}`, 10, 60_000);
  if (!limit.ok) return fail(t("tooManyLookups", { seconds: limit.retryAfterSeconds }));

  try {
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data, {
      scope: { userId: user.id },
    });
    return ok(toPreview(profile));
  } catch (err) {
    logger.warn("onboarding.lookup_failed", { userId: user.id, error: err });
    if (isMissingCompanionData(err)) return fail(t("companionNoDataCfn"));
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
    const profile = await getSF6DataProvider().getPlayerProfile(parsed.data, {
      scope: { userId: user.id },
    });
    const tOnboarding = await getTranslations("Onboarding");
    await upsertPlayerForUser(db, user.id, profile, {
      name: tOnboarding("defaultOverlayName"),
      locale,
    });
    logger.info("onboarding.player_registered", { userId: user.id });
  } catch (err) {
    logger.warn("onboarding.confirm_failed", { userId: user.id, error: err });
    if (isMissingCompanionData(err)) return fail(t("companionNoDataCfn"));
    return fail(t(`provider.${providerErrorKey(err)}`));
  }
  redirect("/dashboard?welcome=1");
}
