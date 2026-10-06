/**
 * Creator Keys — issue (operator), list, revoke (operator) and redeem (user). See
 * docs/creator-keys.md for the lifecycle, threat model and production permissions.
 *
 * Runtime (sf6_app) only redeems: UPDATE creator_key + INSERT entitlement_grant in one
 * transaction. Issuance and revocation run from the operator CLI with the admin connection.
 *
 * Logging: never the plaintext key, the normalized key, the HMAC input or the pepper; only key
 * ids/hints of matched rows, the user id and an outcome category.
 */
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { PlanId } from "@/domain/entitlements/plans";
import type { Database } from "@/server/db/client";
import { creatorKey, entitlementGrant } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/security/rate-limit";
import { creatorKeyHint, generateCreatorKey, hashCreatorKey, normalizeCreatorKey } from "./crypto";

const log = logger.child({ component: "creator-keys" });
const DAY_MS = 86_400_000;

/** RFC 0001 §12 (agreed): unredeemed keys expire after 30 days; the grant lasts 90 days. */
export const CREATOR_KEY_REDEEM_WINDOW_DAYS = 30;
export const CREATOR_BETA_GRANT_DAYS = 90;
export const CREATOR_KEY_PLAN: PlanId = "creator_beta";

/**
 * Redeem attempts (fail-closed: if the limiter's store is unreachable, nobody redeems).
 * Generous enough for typos, far too low for guessing 100-bit keys.
 */
export const REDEEM_LIMITS = {
  perUser: { max: 5, windowMs: 10 * 60_000 },
  perIp: { max: 20, windowMs: 60 * 60_000 },
} as const;

/* ───────── operator: issue / list / revoke ───────── */

export interface IssuedCreatorKey {
  /** Shown ONCE to the operator; never stored or logged. */
  key: string;
  id: string;
  hint: string;
  plan: PlanId;
  grantDays: number;
  issuedAt: Date;
  expiresAt: Date;
}

export async function issueCreatorKey(
  db: Database,
  input: { pepper: string; issuedBy: string; note?: string | null; now?: Date },
): Promise<IssuedCreatorKey> {
  const now = input.now ?? new Date();
  const key = generateCreatorKey();
  const body = normalizeCreatorKey(key);
  if (!body) throw new Error("generated key failed its own format check");
  const expiresAt = new Date(now.getTime() + CREATOR_KEY_REDEEM_WINDOW_DAYS * DAY_MS);
  const [row] = await db
    .insert(creatorKey)
    .values({
      keyHash: hashCreatorKey(body, input.pepper),
      keyHint: creatorKeyHint(body),
      plan: CREATOR_KEY_PLAN,
      grantDays: CREATOR_BETA_GRANT_DAYS,
      issuedAt: now,
      expiresAt,
      issuedBy: input.issuedBy,
      issuedNote: input.note ?? null,
    })
    .returning({ id: creatorKey.id, hint: creatorKey.keyHint });
  if (!row) throw new Error("creator key insert returned no row");
  log.info("creator_key.issued", { keyId: row.id, keyHint: row.hint });
  return {
    key,
    id: row.id,
    hint: row.hint,
    plan: CREATOR_KEY_PLAN,
    grantDays: CREATOR_BETA_GRANT_DAYS,
    issuedAt: now,
    expiresAt,
  };
}

export type CreatorKeyState = "issued" | "expired" | "redeemed" | "revoked";

/** Derived state (no status column to keep in sync). Revocation wins for display. */
export function creatorKeyState(
  row: { redeemedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): CreatorKeyState {
  if (row.revokedAt) return "revoked";
  if (row.redeemedAt) return "redeemed";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "issued";
}

export interface CreatorKeyListItem {
  id: string;
  hint: string;
  state: CreatorKeyState;
  issuedAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
}

/** Operator listing: never plaintext, hashes or notes. */
export async function listCreatorKeys(
  db: Database,
  now = new Date(),
): Promise<CreatorKeyListItem[]> {
  const rows = await db
    .select({
      id: creatorKey.id,
      hint: creatorKey.keyHint,
      issuedAt: creatorKey.issuedAt,
      expiresAt: creatorKey.expiresAt,
      redeemedAt: creatorKey.redeemedAt,
      revokedAt: creatorKey.revokedAt,
    })
    .from(creatorKey)
    .orderBy(desc(creatorKey.issuedAt));
  return rows.map((r) => ({ ...r, state: creatorKeyState(r, now) }));
}

export interface RevokeResult {
  found: boolean;
  /** False when the key was already revoked. */
  keyRevoked: boolean;
  wasRedeemed: boolean;
  grantRevoked: boolean;
}

/**
 * Revoke by id (never by plaintext). An unredeemed key simply stops being redeemable. For a
 * redeemed key, the resulting grant is revoked only when `revokeGrant` is explicitly set:
 * taking access away from a user is a deliberate operator decision. Nothing is deleted.
 */
export async function revokeCreatorKey(
  db: Database,
  input: { keyId: string; revokedBy: string; revokeGrant: boolean; now?: Date },
): Promise<RevokeResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [key] = await tx
      .select({
        id: creatorKey.id,
        redeemedAt: creatorKey.redeemedAt,
        revokedAt: creatorKey.revokedAt,
      })
      .from(creatorKey)
      .where(eq(creatorKey.id, input.keyId))
      .for("update");
    if (!key) return { found: false, keyRevoked: false, wasRedeemed: false, grantRevoked: false };
    let keyRevoked = false;
    if (!key.revokedAt) {
      await tx
        .update(creatorKey)
        .set({ revokedAt: now, revokedBy: input.revokedBy })
        .where(eq(creatorKey.id, key.id));
      keyRevoked = true;
    }
    let grantRevoked = false;
    if (input.revokeGrant && key.redeemedAt) {
      const rows = await tx
        .update(entitlementGrant)
        .set({ revokedAt: now })
        .where(and(eq(entitlementGrant.creatorKeyId, key.id), isNull(entitlementGrant.revokedAt)))
        .returning({ id: entitlementGrant.id });
      grantRevoked = rows.length > 0;
    }
    log.info("creator_key.revoked", { keyId: key.id, keyRevoked, grantRevoked });
    return { found: true, keyRevoked, wasRedeemed: key.redeemedAt !== null, grantRevoked };
  });
}

/* ───────── user: redeem ───────── */

export type RedeemResult =
  { ok: true; keyId: string; keyHint: string; plan: PlanId; grantExpiresAt: Date } | { ok: false };

/**
 * One transaction: a conditional UPDATE consumes the key only if it is unredeemed, unrevoked
 * and unexpired (concurrent redeems serialize on the row; the loser's WHERE no longer matches),
 * then the grant is inserted. Any failure rolls both back, so a key is never consumed without
 * its grant. The grant window starts at redemption and uses the key's own frozen plan/days.
 */
export async function redeemCreatorKey(
  db: Database,
  input: { userId: string; rawKey: unknown; pepper: string; now?: Date },
): Promise<RedeemResult> {
  const now = input.now ?? new Date();
  const body = normalizeCreatorKey(input.rawKey);
  if (!body) return { ok: false };
  const keyHash = hashCreatorKey(body, input.pepper);

  return db.transaction(async (tx) => {
    const [key] = await tx
      .update(creatorKey)
      .set({ redeemedBy: input.userId, redeemedAt: now })
      .where(
        and(
          eq(creatorKey.keyHash, keyHash),
          isNull(creatorKey.redeemedAt),
          isNull(creatorKey.revokedAt),
          gt(creatorKey.expiresAt, now),
        ),
      )
      .returning({
        id: creatorKey.id,
        hint: creatorKey.keyHint,
        plan: creatorKey.plan,
        grantDays: creatorKey.grantDays,
      });
    if (!key) return { ok: false } as const;
    const grantExpiresAt = new Date(now.getTime() + key.grantDays * DAY_MS);
    await tx.insert(entitlementGrant).values({
      userId: input.userId,
      plan: key.plan,
      source: "creator_key",
      creatorKeyId: key.id,
      startsAt: now,
      expiresAt: grantExpiresAt,
    });
    return { ok: true, keyId: key.id, keyHint: key.hint, plan: key.plan, grantExpiresAt } as const;
  });
}

export type RedeemAttempt =
  | { status: "ok"; grantExpiresAt: Date }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number };

/**
 * Full server-side redeem for an authenticated user: rate limits FIRST (fail-closed, per user
 * and per IP), then format/HMAC/transaction. Every non-success outcome other than rate limiting
 * is the same "invalid" (malformed, unknown, expired, revoked, already used, misconfigured).
 */
export async function attemptCreatorKeyRedeem(
  db: Database,
  input: { userId: string; ip: string; rawKey: unknown; now?: Date },
): Promise<RedeemAttempt> {
  const userLimit = await rateLimit(
    `creator-key:user:${input.userId}`,
    REDEEM_LIMITS.perUser.max,
    REDEEM_LIMITS.perUser.windowMs,
    { failClosed: true },
  );
  const ipLimit = userLimit.ok
    ? await rateLimit(
        `creator-key:ip:${input.ip}`,
        REDEEM_LIMITS.perIp.max,
        REDEEM_LIMITS.perIp.windowMs,
        { failClosed: true },
      )
    : userLimit;
  if (!userLimit.ok || !ipLimit.ok) {
    log.warn("creator_key.redeem", { outcome: "rate_limited", userId: input.userId });
    return {
      status: "rate_limited",
      retryAfterSeconds: Math.max(userLimit.retryAfterSeconds, ipLimit.retryAfterSeconds),
    };
  }

  const pepper = getEnv().CREATOR_KEY_PEPPER;
  if (!pepper) {
    // Only possible outside production (env validation requires it there).
    log.warn("creator_key.redeem", { outcome: "not_configured", userId: input.userId });
    return { status: "invalid" };
  }

  const result = await redeemCreatorKey(db, {
    userId: input.userId,
    rawKey: input.rawKey,
    pepper,
    now: input.now,
  });
  if (!result.ok) {
    log.info("creator_key.redeem", { outcome: "invalid", userId: input.userId });
    return { status: "invalid" };
  }
  log.info("creator_key.redeem", {
    outcome: "success",
    userId: input.userId,
    keyId: result.keyId,
    keyHint: result.keyHint,
  });
  return { status: "ok", grantExpiresAt: result.grantExpiresAt };
}

/** Test/ops helper: count of grants created from a key (never more than one; DB-enforced). */
export async function countGrantsForKey(db: Database, keyId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entitlementGrant)
    .where(eq(entitlementGrant.creatorKeyId, keyId));
  return row?.n ?? 0;
}
