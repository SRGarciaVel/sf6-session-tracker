"use server";

/**
 * Dashboard mutations. Each action re-authenticates and resolves the player from the session
 * user — client-supplied ids (overlayId) are always checked for ownership (IDOR).
 * Server actions carry Next.js' built-in Origin check (CSRF).
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
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
import { createPairingCode, purgePairingCodes, revokeDevice } from "@/server/companion/service";
import { getDb } from "@/server/db/client";
import { sf6Player } from "@/server/db/schema";
import { attemptCreatorKeyRedeem } from "@/server/creator-keys/service";
import { canCreateOverlay } from "@/server/entitlements/service";
import { prepareOverlayConfigForSave } from "@/server/overlays/effective";
import {
  applyPresetToOverlay,
  createPreset,
  deletePreset,
  duplicatePreset,
  renamePreset,
  updatePresetFromConfig,
  type PresetError,
} from "@/server/overlays/presets";
import { PRESETS_PER_ACCOUNT_MAX, presetNameSchema } from "@/domain/overlay/presets";
import type { OverlayConfig } from "@/domain/overlay/config";
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
import { getClientIp } from "@/server/security/client-ip";
import { rateLimit } from "@/server/security/rate-limit";
import { endSession, startSession } from "@/server/sessions/service";
import { getMockProvider, getSF6DataProvider } from "@/server/sf6";
import { isMissingCompanionData, providerErrorKey } from "@/server/sf6/messages";

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
  const limit = await rateLimit(`session-start:${ctx.user.id}`, 6, 60_000);
  if (!limit.ok) return fail(t("slowDown", { seconds: limit.retryAfterSeconds }));

  try {
    await startSession(getDb(), getSF6DataProvider(), ctx.player);
  } catch (err) {
    logger.warn("session.start_failed", { playerId: ctx.player.id, error: err });
    if (isMissingCompanionData(err)) return fail(t("companionNoData"));
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
  const quota = await canCreateOverlay(db, {
    userId: ctx.user.id,
    currentCount: (await listOverlays(db, ctx.player.id)).length,
  });
  if (!quota.ok) return fail(t("maxOverlays", { max: quota.max }));
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
  // Creator customization is persisted only for entitled owners; otherwise the stored block is
  // kept untouched (server-side; the editor's locked controls are only a convenience).
  const merged = await prepareOverlayConfigForSave(db, {
    userId: ctx.user.id,
    stored: target.config,
    incoming: config.data,
  });
  await updateOverlay(db, target, { name: name.data, config: merged });
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

/* ───────────── Creator presets (Phase 4.5; rules in server/overlays/presets.ts) ───────────── */

async function presetError(error: PresetError): Promise<string> {
  const t = await getTranslations("Errors");
  switch (error) {
    case "not_entitled":
      return t("presetsNotEntitled");
    case "limit":
      return t("presetLimit", { max: PRESETS_PER_ACCOUNT_MAX });
    case "too_large":
      return t("presetTooLarge");
    case "not_found":
      return t("presetNotFound");
  }
}

/** Shared validation for actions that take a preset id / name / config from the client. */
async function presetInput(input: { presetId?: string; name?: string; config?: unknown }) {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return { valid: false, error: t("sessionExpired") } as const;
  if (input.presetId !== undefined && !uuid.safeParse(input.presetId).success)
    return { valid: false, error: t("presetNotFound") } as const;
  let name: string | undefined;
  if (input.name !== undefined) {
    const parsed = presetNameSchema.safeParse(input.name);
    if (!parsed.success) return { valid: false, error: t("presetNameInvalid") } as const;
    name = parsed.data;
  }
  let config: OverlayConfig | undefined;
  if (input.config !== undefined) {
    const parsed = overlayConfigSchema.safeParse(input.config);
    if (!parsed.success) return { valid: false, error: t("invalidInput") } as const;
    config = parsed.data;
  }
  return { valid: true, userId: user.id, name, config } as const;
}

export async function createPresetAction(input: {
  name: string;
  config: unknown;
}): Promise<ActionResult<{ presetId: string }>> {
  const v = await presetInput(input);
  if (!v.valid) return fail(v.error);
  if (v.name === undefined || v.config === undefined) return fail(await presetError("not_found"));
  const res = await createPreset(getDb(), { userId: v.userId, name: v.name, config: v.config });
  return res.ok ? ok({ presetId: res.value.id }) : fail(await presetError(res.error));
}

export async function duplicatePresetAction(input: {
  presetId: string;
  name: string;
}): Promise<ActionResult<{ presetId: string }>> {
  const v = await presetInput(input);
  if (!v.valid) return fail(v.error);
  const res = await duplicatePreset(getDb(), {
    userId: v.userId,
    presetId: input.presetId,
    name: v.name ?? "",
  });
  return res.ok ? ok({ presetId: res.value.id }) : fail(await presetError(res.error));
}

export async function renamePresetAction(input: {
  presetId: string;
  name: string;
}): Promise<ActionResult> {
  const v = await presetInput(input);
  if (!v.valid) return fail(v.error);
  const res = await renamePreset(getDb(), {
    userId: v.userId,
    presetId: input.presetId,
    name: v.name ?? "",
  });
  return res.ok ? ok(undefined) : fail(await presetError(res.error));
}

export async function updatePresetAction(input: {
  presetId: string;
  config: unknown;
}): Promise<ActionResult> {
  const v = await presetInput(input);
  if (!v.valid) return fail(v.error);
  if (v.config === undefined) return fail(await presetError("not_found"));
  const res = await updatePresetFromConfig(getDb(), {
    userId: v.userId,
    presetId: input.presetId,
    config: v.config,
  });
  return res.ok ? ok(undefined) : fail(await presetError(res.error));
}

export async function deletePresetAction(input: { presetId: string }): Promise<ActionResult> {
  const v = await presetInput(input);
  if (!v.valid) return fail(v.error);
  const res = await deletePreset(getDb(), { userId: v.userId, presetId: input.presetId });
  return res.ok ? ok(undefined) : fail(await presetError(res.error));
}

/** Applies AND saves (server-side rules); returns the stored config for the editor. */
export async function applyPresetAction(input: {
  presetId: string;
  overlayId: string;
}): Promise<ActionResult<{ config: OverlayConfig }>> {
  const v = await presetInput({ presetId: input.presetId });
  if (!v.valid) return fail(v.error);
  if (!uuid.safeParse(input.overlayId).success) return fail(await presetError("not_found"));
  const res = await applyPresetToOverlay(getDb(), {
    userId: v.userId,
    presetId: input.presetId,
    overlayId: input.overlayId,
  });
  if (!res.ok) return fail(await presetError(res.error));
  revalidatePath("/dashboard");
  return ok({ config: res.value });
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

/* ───────────────────────── Creator Beta ───────────────────────── */

/**
 * Redeem a Creator Key for the signed-in user (identity from the server session only). Every
 * failure except rate limiting returns the same message: no key-state probing.
 */
export async function redeemCreatorKeyAction(
  rawKey: string,
): Promise<ActionResult<{ activeUntil: string }>> {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));
  const result = await attemptCreatorKeyRedeem(getDb(), {
    userId: user.id,
    ip: getClientIp(await headers()),
    rawKey,
  });
  if (result.status === "rate_limited") {
    return fail(t("slowDown", { seconds: result.retryAfterSeconds }));
  }
  if (result.status === "invalid") return fail(t("creatorKeyInvalid"));
  revalidatePath("/dashboard");
  return ok({ activeUntil: result.grantExpiresAt.toISOString() });
}

/* ───────────────────────── Companion ───────────────────────── */

/** One-time pairing code (10 min) for the SF6 Session Companion browser extension. */
export async function createCompanionCodeAction(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));
  const limit = await rateLimit(`companion-code:${user.id}`, 5, 60_000, { failClosed: true });
  if (!limit.ok) return fail(t("slowDown", { seconds: limit.retryAfterSeconds }));
  const db = getDb();
  await purgePairingCodes(db);
  const { code, expiresAt } = await createPairingCode(db, user.id);
  return ok({ code, expiresAt: expiresAt.toISOString() });
}

export async function revokeCompanionDeviceAction(deviceId: string): Promise<ActionResult> {
  const t = await getTranslations("Errors");
  const user = await getCurrentUser();
  if (!user) return fail(t("sessionExpired"));
  if (!uuid.safeParse(deviceId).success) return fail(t("companionDeviceNotFound"));
  const revoked = await revokeDevice(getDb(), user.id, deviceId);
  if (!revoked) return fail(t("companionDeviceNotFound"));
  revalidatePath("/dashboard");
  return ok(undefined);
}
