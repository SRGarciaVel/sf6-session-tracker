/**
 * Plans and entitlements (RFC 0001 §11) — pure definitions and resolution rules.
 *
 *   PLAN         commercial label of an account: "free" | "creator_beta"
 *   ENTITLEMENTS what the code checks. Derived from the effective plan, never stored.
 *
 * The server is the only authority (src/server/entitlements). Features ask for entitlements,
 * never compare plan ids.
 *
 * Phase 2: both plans resolve to the SAME entitlements, so nothing changes for anyone. Values
 * mirror today's behaviour; they are NOT the final commercial Free policy (decided later from
 * beta usage data). Creator value arrives with new entitlements in Phase 4, never by lowering Free.
 *
 * Downgrade rule (all phases): losing a plan never deletes data. Over-limit resources stay
 * readable/usable, and only the creation of new ones is refused.
 */

export const PLAN_IDS = ["free", "creator_beta"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Account without an explicit plan row. */
export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/**
 * Plan order for precedence: a grant can only raise the effective plan, never lower it.
 * Ties resolve to the same plan, so the result is deterministic regardless of row order.
 */
const PLAN_RANK: Record<PlanId, number> = { free: 0, creator_beta: 1 };

export interface Entitlements {
  overlays: {
    /**
     * Max overlays an account can CREATE. 10 is the current technical/product behaviour, not a
     * final commercial Free policy. Existing overlays above the max are never deleted.
     */
    max: number;
  };
  history: {
    /**
     * Days of session history kept. null = no retention policy (current behaviour: nothing is
     * ever purged). The dashboard's 10 visible rows are a display choice, not an entitlement.
     */
    retentionDays: number | null;
  };
}

type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };

/**
 * Plan definitions are shared by every request in the process, so they are deep-frozen: a
 * caller can't mutate one account's result and leak it into everyone else's.
 */
function deepFreeze<T extends object>(value: T): DeepReadonly<T> {
  for (const v of Object.values(value)) {
    if (v !== null && typeof v === "object") deepFreeze(v as object);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

/** Today's behaviour, shared by every plan in Phase 2. */
const CURRENT_BEHAVIOUR: Entitlements = {
  overlays: { max: 10 },
  history: { retentionDays: null },
};

export const PLAN_ENTITLEMENTS: DeepReadonly<Record<PlanId, Entitlements>> = deepFreeze({
  free: CURRENT_BEHAVIOUR,
  // Behaviour-equivalent to free until Phase 4 adds the first Creator capability.
  creator_beta: CURRENT_BEHAVIOUR,
});

/** A time-bound plan grant (entitlement_grant row), as the resolver needs it. */
export interface PlanGrant {
  plan: PlanId;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export function isGrantActive(grant: PlanGrant, now: Date): boolean {
  if (grant.revokedAt !== null) return false; // revocation is immediate and final
  if (grant.startsAt.getTime() > now.getTime()) return false;
  return grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime();
}

export type PlanSource = "default" | "account_plan" | "grant";

export interface ResolvedPlan {
  plan: PlanId;
  /** Where the effective plan came from (server-side diagnostics only; never sent to clients). */
  source: PlanSource;
  /**
   * When the effective plan ends if it comes from grants: the LATEST expiry among the active
   * grants of that plan (overlapping grants are not summed); null when it comes from the base
   * plan or an open-ended grant.
   */
  activeUntil: Date | null;
  entitlements: DeepReadonly<Entitlements>;
}

/**
 * Effective plan = highest-ranked of { base plan (account_plan row, or "free" when missing),
 * every ACTIVE grant }. Inactive grants (future, expired, revoked) are ignored.
 */
export function resolvePlan(input: {
  accountPlan: PlanId | null;
  grants: readonly PlanGrant[];
  now: Date;
}): ResolvedPlan {
  let plan: PlanId = input.accountPlan ?? DEFAULT_PLAN;
  let source: PlanSource = input.accountPlan === null ? "default" : "account_plan";
  const active = input.grants.filter((g) => isGrantActive(g, input.now));
  for (const grant of active) {
    if (PLAN_RANK[grant.plan] > PLAN_RANK[plan]) {
      plan = grant.plan;
      source = "grant";
    }
  }
  let activeUntil: Date | null = null;
  if (source === "grant") {
    const window = active.filter((g) => g.plan === plan);
    activeUntil = window.some((g) => g.expiresAt === null)
      ? null
      : new Date(Math.max(...window.map((g) => (g.expiresAt as Date).getTime())));
  }
  return { plan, source, activeUntil, entitlements: PLAN_ENTITLEMENTS[plan] };
}

/** True when one more resource fits under a count limit. */
export function canCreateMore(currentCount: number, max: number): boolean {
  return currentCount < max;
}
