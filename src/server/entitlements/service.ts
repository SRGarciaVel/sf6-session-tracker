/**
 * The ONE server-side authority for plans and entitlements (docs/entitlements.md).
 *
 * Features call `getEntitlements(db, userId)` and read typed values; nothing else compares plan
 * ids. Input is always the authenticated user id resolved on the server (session, or the owner
 * of an overlay/device) — never a client-supplied plan, cookie or flag.
 *
 * Cost: two indexed lookups (account_plan by PK, entitlement_grant by user). No cross-request
 * cache, so one account's plan can never be served to another; if a request ever needs several
 * checks, memoize per request keyed by userId (e.g. React `cache`) — never a module-level map.
 */
import { and, eq, isNull } from "drizzle-orm";
import {
  canCreateMore,
  isPlanId,
  resolvePlan,
  type PlanGrant,
  type PlanId,
  type ResolvedPlan,
} from "@/domain/entitlements/plans";
import type { DbExecutor } from "@/server/db/client";
import { accountPlan, entitlementGrant } from "@/server/db/schema";
import { logger } from "@/server/logger";

const log = logger.child({ component: "entitlements" });

export async function resolveAccountPlan(
  db: DbExecutor,
  userId: string,
  now = new Date(),
): Promise<ResolvedPlan> {
  const [[row], grantRows] = await Promise.all([
    db
      .select({ plan: accountPlan.plan })
      .from(accountPlan)
      .where(eq(accountPlan.userId, userId))
      .limit(1),
    db
      .select({
        plan: entitlementGrant.plan,
        startsAt: entitlementGrant.startsAt,
        expiresAt: entitlementGrant.expiresAt,
        revokedAt: entitlementGrant.revokedAt,
      })
      .from(entitlementGrant)
      .where(and(eq(entitlementGrant.userId, userId), isNull(entitlementGrant.revokedAt))),
  ]);

  // The DB CHECK constraints already restrict values; this guards against drift (e.g. a plan
  // added to the DB before the code knows it) by falling back to the safe default.
  let base: PlanId | null = null;
  if (row) {
    if (isPlanId(row.plan)) base = row.plan;
    else log.warn("entitlements.unknown_plan", { plan: String(row.plan).slice(0, 32) });
  }
  const grants: PlanGrant[] = grantRows.filter((g) => isPlanId(g.plan));
  return resolvePlan({ accountPlan: base, grants, now });
}

/** Typed entitlements of an account (what features check). */
export async function getEntitlements(db: DbExecutor, userId: string, now = new Date()) {
  return (await resolveAccountPlan(db, userId, now)).entitlements;
}

export interface PlanSummary {
  plan: PlanId;
  /** ISO end of the effective plan when it comes from a time-bound grant; else null. */
  activeUntil: string | null;
}

/**
 * Safe subset for UI display only (never authority; no row ids, sources, keys or notes).
 */
export async function getPlanSummary(db: DbExecutor, userId: string): Promise<PlanSummary> {
  const resolved = await resolveAccountPlan(db, userId);
  return { plan: resolved.plan, activeUntil: resolved.activeUntil?.toISOString() ?? null };
}

/**
 * Overlay creation check (server-side, owner's entitlements). Over-limit accounts keep every
 * existing overlay; they only cannot create more (downgrade safety).
 */
export async function canCreateOverlay(
  db: DbExecutor,
  input: { userId: string; currentCount: number },
): Promise<{ ok: true } | { ok: false; max: number }> {
  const { overlays } = await getEntitlements(db, input.userId);
  return canCreateMore(input.currentCount, overlays.max)
    ? { ok: true }
    : { ok: false, max: overlays.max };
}
