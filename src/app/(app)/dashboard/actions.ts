"use server";

/**
 * Dashboard mutations. Each action re-authenticates and resolves the player from the session
 * user — client-supplied ids (overlayId) are always checked for ownership (IDOR).
 * Server actions carry Next.js' built-in Origin check (CSRF).
 */
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getRequestLocale } from "@/i18n/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  applyThemeDefaults,
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
} from "@/domain/overlay/config";
import { MATCH_MODES, MATCH_RESULTS } from "@/domain/sf6/types";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getCurrentUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { sf6Player } from "@/server/db/schema";
import { devToolsEnabled } from "@/server/env";
import { logger } from "@/server/logger";
import {
  createOverlay,
  deleteOverlay,
  getOwnedOverlay,
  listOverlays,
  rotateOverlayToken,
  updateOverlay,
} from "@/server/overlays/service";
import { findPlayerByUserId } from "@/server/players/service";
import { publishEvent } from "@/server/realtime/events";
import { rateLimit } from "@/server/security/rate-limit";
import { endSession, startSession } from "@/server/sessions/service";
import { getMockProvider, getSF6DataProvider } from "@/server/sf6";
import { providerErrorKey } from "@/server/sf6/messages";

async function authorizedPlayer() {
  const user = await getCurrentUser();
  if (!user) return null;
  const player = await findPlayerByUserId(getDb(), user.id);
  return player ? { user, player } : null;
}

const uuid = z.string().uuid();

/* ───────────────────────── Sessions ───────────────────────── */

export async function startSessionAction(): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const limit = rateLimit(`session-start:${ctx.user.id}`, 6, 60_000);
  if (!limit.ok) return fail(t("slowDown", { seconds: limit.retryAfterSeconds }));

  try {
    await startSession(getDb(), getSF6DataProvider(), ctx.player);
  } catch (err) {
    logger.warn("session.start_failed", { playerId: ctx.player.id, error: err });
    return fail(t("startFailed", { reason: t(`provider.${providerErrorKey(err)}`) }));
  }
  revalidatePath("/dashboard");
  return ok(undefined);
}

export async function endSessionAction(): Promise<ActionResult<{ sessionId: string | null }>> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const ended = await endSession(getDb(), ctx.player.id, getSF6DataProvider());
  revalidatePath("/dashboard");
  return ok({ sessionId: ended?.id ?? null });
}

/* ───────────────────────── Overlays ───────────────────────── */

const overlayNameSchema = z.string().trim().min(1).max(40);

export async function createOverlayAction(
  rawName: string,
  theme: "minimal" | "competitive" | "fighter" = "competitive",
): Promise<ActionResult<{ overlayId: string }>> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const name = overlayNameSchema.safeParse(rawName);
  if (!name.success) return fail(t("overlayNameInvalid"));
  const themeParsed = z.enum(["minimal", "competitive", "fighter"]).safeParse(theme);
  if (!themeParsed.success) return fail(t("invalidTheme"));

  const db = getDb();
  if ((await listOverlays(db, ctx.player.id)).length >= 10) return fail(t("maxOverlays"));
  const created = await createOverlay(
    db,
    ctx.player.id,
    name.data,
    // New overlays start in the streamer's language; they can be changed independently later.
    {
      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, themeParsed.data),
      locale: await getRequestLocale(),
    },
  );
  revalidatePath("/dashboard");
  return ok({ overlayId: created.id });
}

export async function saveOverlayAction(
  overlayId: string,
  input: { name: string; config: unknown },
): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  if (!uuid.safeParse(overlayId).success) return fail(t("overlayNotFound"));

  const name = overlayNameSchema.safeParse(input.name);
  if (!name.success) return fail(t("overlayNameInvalid"));
  const config = overlayConfigSchema.safeParse(input.config);
  if (!config.success) {
    const issue = config.error.issues[0];
    return fail(t("invalidSetting", { field: issue ? issue.path.join(".") : "?" }));
  }

  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail(t("overlayNotFound"));
  await updateOverlay(db, target, { name: name.data, config: config.data });
  revalidatePath("/dashboard");
  return ok(undefined);
}

export async function rotateOverlayTokenAction(overlayId: string): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  if (!uuid.safeParse(overlayId).success) return fail(t("overlayNotFound"));
  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail(t("overlayNotFound"));
  await rotateOverlayToken(db, target);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/overlays/${overlayId}`);
  return ok(undefined);
}

export async function deleteOverlayAction(overlayId: string): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  if (!uuid.safeParse(overlayId).success) return fail(t("overlayNotFound"));
  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail(t("overlayNotFound"));
  await deleteOverlay(db, target);
  revalidatePath("/dashboard");
  return ok(undefined);
}

/* ─────────────── Dev tools (mock provider only, never in production) ─────────────── */

const simulateSchema = z.object({
  result: z.enum(MATCH_RESULTS).optional(),
  mode: z.enum(MATCH_MODES).optional(),
  secondsAgo: z.number().int().min(0).max(3600).optional(),
});

export async function simulateMatchAction(
  input: z.input<typeof simulateSchema>,
): Promise<ActionResult<{ result: string }>> {
  const t = await getTranslations("Errors");
  if (!devToolsEnabled()) return fail(t("devToolsDisabled"));
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const parsed = simulateSchema.safeParse(input);
  if (!parsed.success) return fail(t("invalidInput"));
  const mock = getMockProvider();
  if (!mock) return fail(t("mockInactive"));

  // Only writes to the FAKE CFN. Detection still goes through the worker → ingestion pipeline.
  const created = await mock.simulateMatch(ctx.player.cfnUserId, parsed.data);
  await nudgeTracker(ctx.player.id);
  logger.info("dev.mock_match", { playerId: ctx.player.id, result: created.result });
  return ok({ result: created.result });
}

export async function simulateOutageAction(seconds: number): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  if (!devToolsEnabled()) return fail(t("devToolsDisabled"));
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const mock = getMockProvider();
  if (!mock) return fail(t("mockInactive"));
  const s = z.number().int().min(0).max(600).safeParse(seconds);
  if (!s.success) return fail(t("invalidDuration"));
  await mock.setOutage(ctx.player.cfnUserId, s.data);
  await nudgeTracker(ctx.player.id);
  return ok(undefined);
}

const MOCK_CHARACTERS = ["aki", "kimberly", "cammy", "sagat"] as const;

/** Dev only: switch the character the mock CFN uses for the next simulated matches. */
export async function simulateCharacterAction(
  characterKey: string,
): Promise<ActionResult<{ characterName: string }>> {
  const t = await getTranslations("Errors");
  if (!devToolsEnabled()) return fail(t("devToolsDisabled"));
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(t("sessionExpired"));
  const key = z.enum(MOCK_CHARACTERS).safeParse(characterKey);
  if (!key.success) return fail(t("invalidInput"));
  const mock = getMockProvider();
  if (!mock) return fail(t("mockInactive"));
  const characterName = await mock.setCharacter(ctx.player.cfnUserId, key.data);
  return ok({ characterName });
}

/** Dev convenience: poll on the next worker tick instead of waiting for the interval. */
async function nudgeTracker(playerId: string) {
  const db = getDb();
  await db
    .update(sf6Player)
    .set({ nextPollAt: sql`now()` })
    .where(eq(sf6Player.id, playerId));
  await publishEvent(db, { kind: "player", playerId });
}
