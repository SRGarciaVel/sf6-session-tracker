import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { DEFAULT_OVERLAY_CONFIG, parseOverlayConfig, type OverlayConfig } from "@/domain/overlay/config";
import type { DbExecutor } from "@/server/db/client";
import { overlay, overlayConnection, sf6Player, type OverlayRow } from "@/server/db/schema";
import { publishEvent } from "@/server/realtime/events";
import { generateOverlayToken, isValidOverlayTokenFormat } from "@/server/security/tokens";

/** Connections not heartbeated within this window are considered gone. */
export const CONNECTION_STALE_MS = 90_000;

export interface OverlayView {
  id: string;
  playerId: string;
  publicToken: string;
  name: string;
  config: OverlayConfig;
  updatedAt: Date;
}

function toView(row: OverlayRow): OverlayView {
  return {
    id: row.id,
    playerId: row.playerId,
    publicToken: row.publicToken,
    name: row.name,
    config: parseOverlayConfig(row.config),
    updatedAt: row.updatedAt,
  };
}

export async function createOverlay(
  db: DbExecutor,
  playerId: string,
  name: string,
  config: OverlayConfig = DEFAULT_OVERLAY_CONFIG,
): Promise<OverlayView> {
  const [row] = await db
    .insert(overlay)
    .values({ playerId, name, publicToken: generateOverlayToken(), config })
    .returning();
  if (!row) throw new Error("Failed to create overlay");
  return toView(row);
}

export async function listOverlays(db: DbExecutor, playerId: string): Promise<OverlayView[]> {
  const rows = await db
    .select()
    .from(overlay)
    .where(eq(overlay.playerId, playerId))
    .orderBy(asc(overlay.createdAt));
  return rows.map(toView);
}

/** Public lookup for OBS. Returns null for malformed or unknown tokens. */
export async function getOverlayByToken(db: DbExecutor, token: string): Promise<OverlayView | null> {
  if (!isValidOverlayTokenFormat(token)) return null;
  const [row] = await db.select().from(overlay).where(eq(overlay.publicToken, token)).limit(1);
  return row ? toView(row) : null;
}

export async function getOverlayById(db: DbExecutor, overlayId: string): Promise<OverlayView | null> {
  const [row] = await db.select().from(overlay).where(eq(overlay.id, overlayId)).limit(1);
  return row ? toView(row) : null;
}

/** Overlay owned by the given auth user (IDOR-safe). */
export async function getOwnedOverlay(
  db: DbExecutor,
  userId: string,
  overlayId: string,
): Promise<OverlayView | null> {
  const [row] = await db
    .select({ overlay })
    .from(overlay)
    .innerJoin(sf6Player, eq(sf6Player.id, overlay.playerId))
    .where(and(eq(overlay.id, overlayId), eq(sf6Player.userId, userId)))
    .limit(1);
  return row ? toView(row.overlay) : null;
}

export async function updateOverlay(
  db: DbExecutor,
  target: OverlayView,
  changes: { name?: string; config?: OverlayConfig },
): Promise<void> {
  await db
    .update(overlay)
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.config !== undefined ? { config: changes.config } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(overlay.id, target.id));
  await publishEvent(db, { kind: "overlay", playerId: target.playerId, overlayId: target.id });
}

/** New public URL; the old token stops working immediately (open SSE streams are closed). */
export async function rotateOverlayToken(db: DbExecutor, target: OverlayView): Promise<string> {
  const token = generateOverlayToken();
  await db
    .update(overlay)
    .set({ publicToken: token, updatedAt: sql`now()` })
    .where(eq(overlay.id, target.id));
  await publishEvent(db, { kind: "overlay", playerId: target.playerId, overlayId: target.id });
  return token;
}

export async function deleteOverlay(db: DbExecutor, target: OverlayView): Promise<void> {
  await db.delete(overlay).where(eq(overlay.id, target.id));
  await publishEvent(db, { kind: "overlay", playerId: target.playerId, overlayId: target.id });
}

/* ───────────────────────── Presence ───────────────────────── */

export async function registerConnection(
  db: DbExecutor,
  overlayId: string,
  instanceId: string,
): Promise<string> {
  const [row] = await db
    .insert(overlayConnection)
    .values({ overlayId, instanceId })
    .returning({ id: overlayConnection.id });
  if (!row) throw new Error("Failed to register connection");
  return row.id;
}

export async function heartbeatConnection(db: DbExecutor, connectionId: string): Promise<void> {
  await db
    .update(overlayConnection)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(overlayConnection.id, connectionId));
}

export async function removeConnection(db: DbExecutor, connectionId: string): Promise<void> {
  await db.delete(overlayConnection).where(eq(overlayConnection.id, connectionId));
}

export async function countPlayerConnections(db: DbExecutor, playerId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(overlayConnection)
    .innerJoin(overlay, eq(overlay.id, overlayConnection.overlayId))
    .where(
      and(
        eq(overlay.playerId, playerId),
        gt(overlayConnection.lastSeenAt, sql`now() - ${`${CONNECTION_STALE_MS} milliseconds`}::interval`),
      ),
    );
  return row?.n ?? 0;
}

export async function pruneStaleConnections(db: DbExecutor): Promise<number> {
  const rows = await db
    .delete(overlayConnection)
    .where(sql`${overlayConnection.lastSeenAt} < now() - ${`${CONNECTION_STALE_MS * 2} milliseconds`}::interval`)
    .returning({ id: overlayConnection.id });
  return rows.length;
}
