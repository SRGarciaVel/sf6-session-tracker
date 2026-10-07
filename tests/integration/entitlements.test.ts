/**
 * Plans & entitlements against a real Postgres (TEST_DATABASE_URL): missing row = free,
 * explicit plans, grant lifecycle, constraints, cascades, per-account isolation and the overlay
 * quota (identical to the pre-Phase-2 behaviour).
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { accountPlan, authUser, entitlementGrant, overlay } = await import("@/server/db/schema");
const { canCreateOverlay, getEntitlements, getPlanSummary, resolveAccountPlan } =
  await import("@/server/entitlements/service");
const { PLAN_ENTITLEMENTS } = await import("@/domain/entitlements/plans");
const { createOverlay, listOverlays } = await import("@/server/overlays/service");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");

const DAY = 86_400_000;

describe.skipIf(!TEST_DB)("plans & entitlements (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  afterAll(async () => {
    await closeDb();
  });

  async function newUser() {
    const id = randomUUID();
    await db.insert(authUser).values({ id, name: "Ent", email: `${id}@test.local` });
    return id;
  }

  it("account without account_plan row ⇒ free (no backfill needed)", async () => {
    const userId = await newUser();
    expect(await resolveAccountPlan(db, userId)).toMatchObject({
      plan: "free",
      source: "default",
      entitlements: PLAN_ENTITLEMENTS.free,
    });
    expect(await getPlanSummary(db, userId)).toEqual({ plan: "free", activeUntil: null });
  });

  it("explicit free and creator_beta rows; only Creator overlay capabilities differ (Phase 4/4.5)", async () => {
    const free = await newUser();
    const beta = await newUser();
    await db.insert(accountPlan).values([
      { userId: free, plan: "free" },
      { userId: beta, plan: "creator_beta" },
    ]);
    expect((await resolveAccountPlan(db, free)).plan).toBe("free");
    expect(await resolveAccountPlan(db, beta)).toMatchObject({
      plan: "creator_beta",
      source: "account_plan",
    });
    expect((await getEntitlements(db, beta)).overlays).toEqual({
      max: 10,
      advancedCustomization: true,
      premiumThemes: true,
      creatorPresets: true,
      motionEffects: true,
      characterRotation: true,
      brandFlag: true,
    });
    expect((await getEntitlements(db, free)).overlays).toEqual({
      max: 10,
      advancedCustomization: false,
      premiumThemes: false,
      creatorPresets: false,
      motionEffects: false,
      characterRotation: false,
      brandFlag: false,
    });
  });

  it("CHECK constraints reject unknown plans, sources and inverted windows", async () => {
    const userId = await newUser();
    await expect(
      db.execute(sql`insert into account_plan (user_id, plan) values (${userId}, 'plus')`),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into entitlement_grant (user_id, plan, source) values (${userId}, 'free', 'operator')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into entitlement_grant (user_id, plan, source) values (${userId}, 'creator_beta', 'client')`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into entitlement_grant (user_id, plan, source, starts_at, expires_at)
        values (${userId}, 'creator_beta', 'operator', now(), now() - interval '1 day')`),
    ).rejects.toThrow();
  });

  it("grant lifecycle: future, expired and revoked are ignored; active applies", async () => {
    const userId = await newUser();
    const now = Date.now();
    await db.insert(entitlementGrant).values([
      {
        userId,
        plan: "creator_beta",
        source: "operator",
        startsAt: new Date(now + DAY), // future (and short, so it is over by day 90)
        expiresAt: new Date(now + 2 * DAY),
      },
      {
        userId,
        plan: "creator_beta",
        source: "operator",
        startsAt: new Date(now - 10 * DAY),
        expiresAt: new Date(now - DAY),
      },
      { userId, plan: "creator_beta", source: "operator", revokedAt: new Date(now - 1000) },
    ]);
    expect((await resolveAccountPlan(db, userId)).plan).toBe("free");

    await db.insert(entitlementGrant).values({
      userId,
      plan: "creator_beta",
      source: "operator",
      startsAt: new Date(now - DAY),
      expiresAt: new Date(now + 89 * DAY),
    });
    expect(await resolveAccountPlan(db, userId)).toMatchObject({
      plan: "creator_beta",
      source: "grant",
    });
    // …and stops applying at expiry, with no write needed.
    expect((await resolveAccountPlan(db, userId, new Date(now + 90 * DAY))).plan).toBe("free");
  });

  it("one account's plan or grants never affect another account", async () => {
    const a = await newUser();
    const b = await newUser();
    await db.insert(accountPlan).values({ userId: a, plan: "creator_beta" });
    await db
      .insert(entitlementGrant)
      .values({ userId: a, plan: "creator_beta", source: "operator" });
    expect(await resolveAccountPlan(db, b)).toMatchObject({ plan: "free", source: "default" });
  });

  it("deleting the user cascades to account_plan and entitlement_grant", async () => {
    const userId = await newUser();
    await db.insert(accountPlan).values({ userId, plan: "creator_beta" });
    await db.insert(entitlementGrant).values({ userId, plan: "creator_beta", source: "operator" });
    await db.delete(authUser).where(eq(authUser.id, userId));
    expect(await db.select().from(accountPlan).where(eq(accountPlan.userId, userId))).toEqual([]);
    expect(
      await db.select().from(entitlementGrant).where(eq(entitlementGrant.userId, userId)),
    ).toEqual([]);
    expect((await resolveAccountPlan(db, userId)).plan).toBe("free"); // unknown id ⇒ default
  });

  it("overlay quota: same limit as before Phase 2 (10), existing overlays never touched", async () => {
    const userId = await newUser();
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    // Onboarding created the default overlay; fill up to 10 the way the action would.
    while ((await listOverlays(db, player.id)).length < 10) {
      const count = (await listOverlays(db, player.id)).length;
      expect(await canCreateOverlay(db, { userId, currentCount: count })).toEqual({ ok: true });
      await createOverlay(db, player.id, `Overlay ${count + 1}`);
    }
    expect(await canCreateOverlay(db, { userId, currentCount: 10 })).toEqual({
      ok: false,
      max: 10,
    });

    // creator_beta changes nothing in Phase 2.
    await db.insert(accountPlan).values({ userId, plan: "creator_beta" });
    expect(await canCreateOverlay(db, { userId, currentCount: 10 })).toEqual({
      ok: false,
      max: 10,
    });

    // Over the limit (e.g. after a future downgrade): nothing is deleted, only creation refused.
    await createOverlay(db, player.id, "Legacy extra");
    expect(await db.select().from(overlay).where(eq(overlay.playerId, player.id))).toHaveLength(11);
    expect(await canCreateOverlay(db, { userId, currentCount: 11 })).toMatchObject({ ok: false });
  });
});
