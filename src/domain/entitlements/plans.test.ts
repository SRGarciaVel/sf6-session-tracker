import { describe, expect, it } from "vitest";
import {
  canCreateMore,
  DEFAULT_PLAN,
  isGrantActive,
  isPlanId,
  PLAN_ENTITLEMENTS,
  PLAN_IDS,
  resolvePlan,
  type PlanGrant,
} from "./plans";

const NOW = new Date("2026-10-05T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 86_400_000;
const grant = (over: Partial<PlanGrant> = {}): PlanGrant => ({
  plan: "creator_beta",
  startsAt: at(-DAY),
  expiresAt: at(89 * DAY),
  revokedAt: null,
  ...over,
});

describe("plans", () => {
  it("exactly free and creator_beta exist in Phase 2", () => {
    expect(PLAN_IDS).toEqual(["free", "creator_beta"]);
    expect(DEFAULT_PLAN).toBe("free");
  });

  it("rejects anything that is not a known plan id", () => {
    for (const bad of ["plus", "creator", "FREE", "", null, undefined, 1, { plan: "free" }]) {
      expect(isPlanId(bad), String(bad)).toBe(false);
    }
    expect(isPlanId("creator_beta")).toBe(true);
  });

  it("free preserves today's behaviour (10 overlays, no history purge)", () => {
    expect(PLAN_ENTITLEMENTS.free).toEqual({
      overlays: {
        max: 10,
        advancedCustomization: false,
        premiumThemes: false,
        creatorPresets: false,
        motionEffects: false,
      },
      history: { retentionDays: null },
    });
  });

  it("Phase 4/4.5: creator_beta differs from free ONLY by NEW overlay capabilities", () => {
    for (const key of [
      "advancedCustomization",
      "premiumThemes",
      "creatorPresets",
      "motionEffects",
    ] as const) {
      expect(PLAN_ENTITLEMENTS.free.overlays[key]).toBe(false);
      expect(PLAN_ENTITLEMENTS.creator_beta.overlays[key]).toBe(true);
    }
    expect(PLAN_ENTITLEMENTS.creator_beta.overlays.max).toBe(10);
    expect(PLAN_ENTITLEMENTS.free.overlays.max).toBe(10);
    expect({
      ...PLAN_ENTITLEMENTS.creator_beta,
      overlays: {
        ...PLAN_ENTITLEMENTS.creator_beta.overlays,
        advancedCustomization: false,
        premiumThemes: false,
        creatorPresets: false,
        motionEffects: false,
      },
    }).toEqual(PLAN_ENTITLEMENTS.free);
  });
});

describe("resolvePlan", () => {
  it("no account_plan row ⇒ free (default)", () => {
    expect(resolvePlan({ accountPlan: null, grants: [], now: NOW })).toMatchObject({
      plan: "free",
      source: "default",
      entitlements: PLAN_ENTITLEMENTS.free,
    });
  });

  it("explicit free / creator_beta rows", () => {
    expect(resolvePlan({ accountPlan: "free", grants: [], now: NOW })).toMatchObject({
      plan: "free",
      source: "account_plan",
    });
    expect(resolvePlan({ accountPlan: "creator_beta", grants: [], now: NOW })).toMatchObject({
      plan: "creator_beta",
      source: "account_plan",
    });
  });

  it("grant states: active applies; future, expired and revoked do not", () => {
    const base = { accountPlan: null, now: NOW };
    expect(resolvePlan({ ...base, grants: [grant()] })).toMatchObject({
      plan: "creator_beta",
      source: "grant",
    });
    for (const g of [
      grant({ startsAt: at(DAY) }), // future
      grant({ expiresAt: at(-1) }), // expired
      grant({ expiresAt: NOW }), // expires exactly now ⇒ inactive
      grant({ revokedAt: at(-DAY / 2) }), // revoked
      grant({ revokedAt: at(DAY) }), // any revocation is final
    ]) {
      expect(resolvePlan({ ...base, grants: [g] }).plan).toBe("free");
    }
    expect(isGrantActive(grant({ expiresAt: null }), NOW)).toBe(true); // open-ended
  });

  it("a grant never lowers the base plan", () => {
    expect(resolvePlan({ accountPlan: "creator_beta", grants: [grant()], now: NOW })).toMatchObject(
      { plan: "creator_beta", source: "account_plan" },
    );
  });

  it("overlapping grants give a deterministic result regardless of order", () => {
    const grants = [grant({ expiresAt: at(-1) }), grant(), grant({ startsAt: at(DAY) })];
    const a = resolvePlan({ accountPlan: "free", grants, now: NOW });
    const b = resolvePlan({ accountPlan: "free", grants: [...grants].reverse(), now: NOW });
    expect(a).toEqual(b);
    expect(a.plan).toBe("creator_beta");
  });

  it("shared plan definitions are deep-frozen (no cross-account mutation)", () => {
    const r = resolvePlan({ accountPlan: null, grants: [], now: NOW });
    expect(Object.isFrozen(PLAN_ENTITLEMENTS)).toBe(true);
    expect(Object.isFrozen(r.entitlements.overlays)).toBe(true);
    expect(() => {
      (r.entitlements.overlays as { max: number }).max = 999;
    }).toThrow(TypeError);
    expect(PLAN_ENTITLEMENTS.free.overlays.max).toBe(10);
  });
});

describe("canCreateMore", () => {
  it("allows up to max - 1 existing, refuses at max and above (never deletes)", () => {
    expect(canCreateMore(9, 10)).toBe(true);
    expect(canCreateMore(10, 10)).toBe(false);
    expect(canCreateMore(12, 10)).toBe(false);
  });
});
