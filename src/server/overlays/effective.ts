/**
 * Effective overlay config for public rendering (OBS page, /state, SSE): the OWNER's
 * entitlements decide whether Creator customization applies, never the viewer (who has no
 * session) and never the fact that the config was valid when saved. Resolved on every payload
 * build, so an expired Creator grant falls back to Free on the next render without any write.
 */
import { eq } from "drizzle-orm";
import type { OverlayConfig } from "@/domain/overlay/config";
import { getEffectiveOverlayConfig, mergeOverlayConfigForSave } from "@/domain/overlay/creator";
import type { DbExecutor } from "@/server/db/client";
import { sf6Player } from "@/server/db/schema";
import { getEntitlements } from "@/server/entitlements/service";

/** overlay.player_id → sf6_player.user_id (the account that owns the overlay). */
export async function getOverlayOwnerUserId(
  db: DbExecutor,
  playerId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ userId: sf6Player.userId })
    .from(sf6Player)
    .where(eq(sf6Player.id, playerId))
    .limit(1);
  return row?.userId ?? null;
}

export async function resolveEffectiveOverlayConfig(
  db: DbExecutor,
  overlay: { playerId: string; config: OverlayConfig },
  now = new Date(),
): Promise<OverlayConfig> {
  const ownerId = await getOverlayOwnerUserId(db, overlay.playerId);
  // No owner (should not happen: FK cascade) ⇒ safest is the Free rendering.
  if (!ownerId) return getEffectiveOverlayConfig(overlay.config, NOT_ENTITLED);
  return getEffectiveOverlayConfig(overlay.config, await getEntitlements(db, ownerId, now));
}

const NOT_ENTITLED = {
  overlays: {
    advancedCustomization: false,
    premiumThemes: false,
    motionEffects: false,
    characterRotation: false,
  },
} as const;

/**
 * Config to persist when `userId` (the authenticated owner) saves: base options from the
 * request; the Creator block from the request only if the owner is entitled, otherwise the
 * stored block is kept as is (Free can edit base options after a downgrade without losing it,
 * and a crafted request cannot add or change Creator values).
 */
export async function prepareOverlayConfigForSave(
  db: DbExecutor,
  input: { userId: string; stored: OverlayConfig; incoming: OverlayConfig },
): Promise<OverlayConfig> {
  const entitlements = await getEntitlements(db, input.userId);
  return mergeOverlayConfigForSave(input.stored, input.incoming, entitlements);
}
