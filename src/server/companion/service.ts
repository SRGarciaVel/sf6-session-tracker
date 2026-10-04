/**
 * SF6 Session Companion — pairing, device auth and sync.
 *
 * The companion is ONLY a data source. It reports normalized observations; this module validates
 * them, stores the latest snapshot (served by the "companion" provider) and — when
 * SF6_PROVIDER=companion — hands matches to the normal ingestion pipeline (dedupe + session
 * assignment under lock). Sessions, W/L, baselines and deltas remain server-side.
 *
 * Secrets: pairing codes and device tokens are random and stored as SHA-256 only.
 */
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import {
  COMPANION_LIMITS,
  COMPANION_POLLING,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  type CompanionState,
  type CompanionSyncParsed,
} from "@sf6/capcom-core";
import type { Database, DbExecutor } from "@/server/db/client";
import {
  companionDevice,
  companionPairingCode,
  companionSnapshot,
  match,
  type CompanionDeviceRow,
  type CompanionWireMatch,
} from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { ingestMatches } from "@/server/ingestion/ingest";
import { logger } from "@/server/logger";
import { findPlayerByUserId, updatePlayerProfile } from "@/server/players/service";
import { publishEvent } from "@/server/realtime/events";
import { getActiveSession } from "@/server/sessions/service";

const log = logger.child({ component: "companion" });

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
/** Snapshots kept per CFN (newest first) for the companion provider's getRecentMatches. */
const SNAPSHOT_MATCHES = 30;
/** SF6 release; anything older is not a real SF6 replay. */
const EARLIEST_MATCH = Date.parse("2023-06-01T00:00:00Z");
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const LAST_SEEN_THROTTLE_MS = 60_000;
/**
 * A device token unused for this long is revoked on its next use (SEC-010): a forgotten or
 * stolen browser profile does not keep a working credential forever. Active companions sync
 * every 30–120 s, so this never affects real use.
 */
export const DEVICE_INACTIVITY_REVOKE_MS = 90 * 86_400_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** 256 random bits, base64url, prefixed so leaked tokens are recognizable. */
export function generateDeviceToken(): string {
  return `sf6c_${randomBytes(32).toString("base64url")}`;
}

export const formatPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/* ───────── pairing ───────── */

/** New one-time code for the user; previous unused codes are invalidated. */
export async function createPairingCode(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const code = generatePairingCode();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(companionPairingCode)
      .where(and(eq(companionPairingCode.userId, userId), isNull(companionPairingCode.usedAt)));
    await tx.insert(companionPairingCode).values({ userId, codeHash: sha256(code), expiresAt });
  });
  return { code: formatPairingCode(code), expiresAt };
}

/** Exchange a (normalized) pairing code for a device token. One-time; null if invalid/expired. */
export async function exchangePairingCode(
  db: Database,
  code: string,
  deviceName: string,
  now = new Date(),
): Promise<{ device: CompanionDeviceRow; token: string } | null> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(companionPairingCode)
      .where(
        and(
          eq(companionPairingCode.codeHash, sha256(code)),
          isNull(companionPairingCode.usedAt),
          gt(companionPairingCode.expiresAt, now),
        ),
      )
      .for("update");
    if (!row) return null;
    await tx
      .update(companionPairingCode)
      .set({ usedAt: now })
      .where(eq(companionPairingCode.id, row.id));
    const token = generateDeviceToken();
    const [device] = await tx
      .insert(companionDevice)
      .values({ userId: row.userId, name: deviceName, tokenHash: sha256(token), lastSeenAt: now })
      .returning();
    return device ? { device, token } : null;
  });
  if (result)
    log.info("companion_paired", { userId: result.device.userId, deviceId: result.device.id });
  return result;
}

/** Remove expired / used codes (housekeeping; cheap, called opportunistically). */
export async function purgePairingCodes(db: DbExecutor, now = new Date()): Promise<void> {
  await db.delete(companionPairingCode).where(lt(companionPairingCode.expiresAt, now));
}

/* ───────── device auth ───────── */

const BEARER = /^Bearer\s+(sf6c_[A-Za-z0-9_-]{43})$/;

export async function authenticateDevice(
  db: DbExecutor,
  authorization: string | null,
  now = new Date(),
): Promise<CompanionDeviceRow | null> {
  const token = authorization ? BEARER.exec(authorization.trim())?.[1] : undefined;
  if (!token) return null;
  const [device] = await db
    .select()
    .from(companionDevice)
    .where(and(eq(companionDevice.tokenHash, sha256(token)), isNull(companionDevice.revokedAt)))
    .limit(1);
  if (!device) return null;
  const lastUse = device.lastSeenAt ?? device.createdAt;
  if (now.getTime() - lastUse.getTime() > DEVICE_INACTIVITY_REVOKE_MS) {
    await db
      .update(companionDevice)
      .set({ revokedAt: now })
      .where(eq(companionDevice.id, device.id));
    log.info("companion_device_revoked", {
      userId: device.userId,
      deviceId: device.id,
      reason: "inactive",
    });
    return null;
  }
  if (!device.lastSeenAt || now.getTime() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await db
      .update(companionDevice)
      .set({ lastSeenAt: now })
      .where(eq(companionDevice.id, device.id));
  }
  return device;
}

export async function listDevices(db: DbExecutor, userId: string): Promise<CompanionDeviceRow[]> {
  return db
    .select()
    .from(companionDevice)
    .where(and(eq(companionDevice.userId, userId), isNull(companionDevice.revokedAt)))
    .orderBy(desc(companionDevice.createdAt));
}

/** Client-safe view of a device (no hash). */
export const toDeviceSummary = (d: CompanionDeviceRow) => ({
  id: d.id,
  name: d.name,
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
});

/** Revoke one of the user's devices (IDOR-safe). Returns false if not found / not owned. */
export async function revokeDevice(
  db: DbExecutor,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const rows = await db
    .update(companionDevice)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(companionDevice.id, deviceId),
        eq(companionDevice.userId, userId),
        isNull(companionDevice.revokedAt),
      ),
    )
    .returning({ id: companionDevice.id });
  if (rows.length > 0) log.info("companion_device_revoked", { userId, deviceId });
  return rows.length > 0;
}

/* ───────── state ───────── */

export function companionIngestEnabled(): boolean {
  return getEnv().SF6_PROVIDER === "companion";
}

export async function buildCompanionState(
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<CompanionState> {
  const player = await findPlayerByUserId(db, userId);
  const [session, known] = player
    ? await Promise.all([
        getActiveSession(db, player.id),
        db
          .select({ id: match.externalMatchId })
          .from(match)
          .where(eq(match.playerId, player.id))
          .orderBy(desc(match.playedAt))
          .limit(COMPANION_LIMITS.knownReplayIds),
      ])
    : [null, []];
  return {
    cfnUserId: player?.cfnUserId ?? null,
    displayName: player?.displayName ?? null,
    activeSession: session !== null,
    knownReplayIds: known.map((k) => k.id),
    ingestEnabled: companionIngestEnabled(),
    polling: { ...COMPANION_POLLING },
    serverTime: now.toISOString(),
  };
}

/* ───────── sync ───────── */

export type SyncRejection = "cfn_mismatch" | "profile_cfn_mismatch" | "invalid_timestamp";

export type SyncResult =
  | { ok: true; inserted: number; duplicates: number; state: CompanionState }
  | { ok: false; reason: SyncRejection };

const toWire = (m: CompanionSyncParsed["matches"][number]): CompanionWireMatch => ({
  ...m,
  playedAt: m.playedAt.toISOString(),
});

export async function applyCompanionSync(
  db: Database,
  device: CompanionDeviceRow,
  payload: CompanionSyncParsed,
  now = new Date(),
): Promise<SyncResult> {
  const reject = (reason: SyncRejection): SyncResult => {
    log.warn("companion_sync_rejected", { deviceId: device.id, reason });
    return { ok: false, reason };
  };

  const player = await findPlayerByUserId(db, device.userId);
  if (player && player.cfnUserId !== payload.cfnUserId) return reject("cfn_mismatch");
  if (payload.profile && payload.profile.cfnUserId !== payload.cfnUserId) {
    return reject("profile_cfn_mismatch");
  }
  const badTime = payload.matches.some((m) => {
    const t = m.playedAt.getTime();
    return t < EARLIEST_MATCH || t > now.getTime() + FUTURE_TOLERANCE_MS;
  });
  if (badTime) return reject("invalid_timestamp");

  /*
   * Snapshot of THIS account only (SEC-001). Companion data is client-asserted: it must never
   * be readable by, or block, another account that tracks the same CFN.
   */
  const [existing] = await db
    .select()
    .from(companionSnapshot)
    .where(
      and(
        eq(companionSnapshot.userId, device.userId),
        eq(companionSnapshot.cfnUserId, payload.cfnUserId),
      ),
    )
    .limit(1);
  const merged = new Map<string, CompanionWireMatch>();
  for (const m of [...payload.matches.map(toWire), ...(existing?.matches ?? [])]) {
    if (!merged.has(m.externalMatchId)) merged.set(m.externalMatchId, m);
  }
  const matches = [...merged.values()]
    .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
    .slice(0, SNAPSHOT_MATCHES);
  const values = {
    cfnUserId: payload.cfnUserId,
    userId: device.userId,
    deviceId: device.id,
    matches,
    matchesObservedAt: now,
    updatedAt: now,
    ...(payload.profile ? { profile: payload.profile, profileObservedAt: now } : {}),
  };
  await db
    .insert(companionSnapshot)
    .values(values)
    .onConflictDoUpdate({
      target: [companionSnapshot.userId, companionSnapshot.cfnUserId],
      set: values,
    });

  /* Ingestion through the normal pipeline (only in companion mode, only for the owner's player). */
  let inserted = 0;
  let duplicates = 0;
  if (companionIngestEnabled() && player) {
    const session = await getActiveSession(db, player.id);
    const result = await ingestMatches(db, payload.matches, {
      playerId: player.id,
      sessionId: session?.id ?? null,
      startGraceMs: getEnv().SESSION_START_GRACE_SECONDS * 1000,
    });
    inserted = result.inserted;
    duplicates = result.duplicates;
    if (payload.profile) {
      const changed = await updatePlayerProfile(db, player.id, payload.profile, now);
      if (changed) await publishEvent(db, { kind: "player", playerId: player.id });
    }
  }

  log.info("companion_sync", {
    deviceId: device.id,
    matches: payload.matches.length,
    inserted,
    duplicates,
    profile: payload.profile !== null,
    gapSuspected: payload.gapSuspected,
    transport: payload.client.transport,
  });
  return {
    ok: true,
    inserted,
    duplicates,
    state: await buildCompanionState(db, device.userId, now),
  };
}
