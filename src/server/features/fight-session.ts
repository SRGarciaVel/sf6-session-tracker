/**
 * Phase 5.6B2 — who sees the experimental Fight Session dashboard.
 *
 * Server-controlled and off by default: only accounts listed in FIGHT_SESSION_UI_USERS (auth_user
 * ids, set in the server environment) are eligible. Nothing the browser sends can grant access;
 * the only request input honoured is a DOWNGRADE (`?ui=classic`) so testers can compare with, or
 * fall back to, the classic dashboard. Rollback: clear the variable (and restart).
 */
import { getEnv } from "@/server/env";

export type DashboardUi = "classic" | "fight-session";

/** Pure decision (testable): eligibility comes only from the server-side allowlist. */
export function decideDashboardUi(input: {
  userId: string;
  allowlist: readonly string[];
  /** Raw `ui` search param; can only opt OUT. */
  requested?: string | string[] | null;
}): DashboardUi {
  const eligible = input.allowlist.includes(input.userId);
  if (!eligible) return "classic";
  const requested = Array.isArray(input.requested) ? input.requested[0] : input.requested;
  return requested === "classic" ? "classic" : "fight-session";
}

export function dashboardUiFor(userId: string, requested?: string | string[] | null): DashboardUi {
  return decideDashboardUi({ userId, allowlist: getEnv().FIGHT_SESSION_UI_USERS, requested });
}
