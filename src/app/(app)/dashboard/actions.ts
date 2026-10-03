"use server";

/**
 * Dashboard mutations. Each action re-authenticates and resolves the player from the session
 * user — client-supplied ids (overlayId) are always checked for ownership (IDOR).
 * Server actions carry Next.js' built-in Origin check (CSRF).
 */
import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { applyThemeDefaults, DEFAULT_OVERLAY_CONFIG, overlayConfigSchema } from "@/domain/overlay/config";
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
import { providerErrorMessage } from "@/server/sf6/messages";

async function authorizedPlayer() {
  const user = await getCurrentUser();
  if (!user) return null;
  const player = await findPlayerByUserId(getDb(), user.id);
  return player ? { user, player } : null;
}

const UNAUTHORIZED = "Your session expired. Please log in again.";
const uuid = z.string().uuid();

/* ───────────────────────── Sessions ───────────────────────── */

export async function startSessionAction(): Promise<ActionResult> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  const limit = rateLimit(`session-start:${ctx.user.id}`, 6, 60_000);
  if (!limit.ok) return fail(`Slow down — try again in ${limit.retryAfterSeconds}s.`);

  try {
    await startSession(getDb(), getSF6DataProvider(), ctx.player);
  } catch (err) {
    logger.warn("session.start_failed", { playerId: ctx.player.id, error: err });
    return fail(`Could not start the session. ${providerErrorMessage(err)}`);
  }
  revalidatePath("/dashboard");
  return ok(undefined);
}

export async function endSessionAction(): Promise<ActionResult<{ sessionId: string | null }>> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  const ended = await endSession(getDb(), ctx.player.id);
  revalidatePath("/dashboard");
  return ok({ sessionId: ended?.id ?? null });
}

/* ───────────────────────── Overlays ───────────────────────── */

const overlayNameSchema = z.string().trim().min(1, "Name is required").max(40);

export async function createOverlayAction(
  rawName: string,
  theme: "minimal" | "competitive" | "fighter" = "competitive",
): Promise<ActionResult<{ overlayId: string }>> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  const name = overlayNameSchema.safeParse(rawName);
  if (!name.success) return fail(name.error.issues[0]?.message ?? "Invalid name");
  const themeParsed = z.enum(["minimal", "competitive", "fighter"]).safeParse(theme);
  if (!themeParsed.success) return fail("Invalid theme");

  const db = getDb();
  if ((await listOverlays(db, ctx.player.id)).length >= 10) return fail("You can have up to 10 overlays.");
  const created = await createOverlay(db, ctx.player.id, name.data, applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, themeParsed.data));
  revalidatePath("/dashboard");
  return ok({ overlayId: created.id });
}

export async function saveOverlayAction(
  overlayId: string,
  input: { name: string; config: unknown },
): Promise<ActionResult> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  if (!uuid.safeParse(overlayId).success) return fail("Overlay not found");

  const name = overlayNameSchema.safeParse(input.name);
  if (!name.success) return fail(name.error.issues[0]?.message ?? "Invalid name");
  const config = overlayConfigSchema.safeParse(input.config);
  if (!config.success) {
    const issue = config.error.issues[0];
    return fail(`Invalid setting${issue ? ` (${issue.path.join(".")}): ${issue.message}` : ""}`);
  }

  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail("Overlay not found");
  await updateOverlay(db, target, { name: name.data, config: config.data });
  revalidatePath("/dashboard");
  return ok(undefined);
}

export async function rotateOverlayTokenAction(overlayId: string): Promise<ActionResult> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  if (!uuid.safeParse(overlayId).success) return fail("Overlay not found");
  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail("Overlay not found");
  await rotateOverlayToken(db, target);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/overlays/${overlayId}`);
  return ok(undefined);
}

export async function deleteOverlayAction(overlayId: string): Promise<ActionResult> {
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  if (!uuid.safeParse(overlayId).success) return fail("Overlay not found");
  const db = getDb();
  const target = await getOwnedOverlay(db, ctx.user.id, overlayId);
  if (!target) return fail("Overlay not found");
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

export async function simulateMatchAction(input: z.input<typeof simulateSchema>): Promise<ActionResult<{ result: string }>> {
  if (!devToolsEnabled()) return fail("Dev tools are disabled.");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  const parsed = simulateSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");
  const mock = getMockProvider();
  if (!mock) return fail("Mock provider is not active.");

  // Only writes to the FAKE CFN. Detection still goes through the worker → ingestion pipeline.
  const created = await mock.simulateMatch(ctx.player.cfnUserId, parsed.data);
  await nudgeTracker(ctx.player.id);
  logger.info("dev.mock_match", { playerId: ctx.player.id, result: created.result });
  return ok({ result: created.result });
}

export async function simulateOutageAction(seconds: number): Promise<ActionResult> {
  if (!devToolsEnabled()) return fail("Dev tools are disabled.");
  const ctx = await authorizedPlayer();
  if (!ctx) return fail(UNAUTHORIZED);
  const mock = getMockProvider();
  if (!mock) return fail("Mock provider is not active.");
  const s = z.number().int().min(0).max(600).safeParse(seconds);
  if (!s.success) return fail("Invalid duration");
  await mock.setOutage(ctx.player.cfnUserId, s.data);
  await nudgeTracker(ctx.player.id);
  return ok(undefined);
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
