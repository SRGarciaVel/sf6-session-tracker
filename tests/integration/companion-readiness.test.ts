/**
 * Dashboard "ready to play?" signals against a real Postgres: account-scoped (never another
 * account's device or snapshot), read-only, and wired into the dashboard live state.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, companionDevice, companionSnapshot, sf6Player } =
  await import("@/server/db/schema");
const { loadCompanionSignals } = await import("@/server/companion/readiness");
const { assessCompanion } = await import("@/domain/companion/readiness");
const { buildDashboardLiveState } = await import("@/server/dashboard/state");
const { isMissingCompanionData } = await import("@/server/sf6/messages");
const { SF6ProviderError } = await import("@/server/sf6/provider");

describe.skipIf(!TEST_DB)("companion readiness signals (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  afterAll(async () => {
    await closeDb();
  });

  async function account(cfn: string) {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "R", email: `${userId}@test.local` });
    const [player] = await db
      .insert(sf6Player)
      .values({ userId, cfnUserId: cfn, displayName: "R" })
      .returning();
    if (!player) throw new Error("no player");
    return { userId, player };
  }
  const cfn = () => String(6_000_000_000 + Math.floor(Math.random() * 999_999_999));

  it("reports only the requesting account's devices and snapshot", async () => {
    const shared = cfn();
    const a = await account(shared);
    const b = await account(cfn());
    const now = new Date();
    await db.insert(companionDevice).values({
      userId: a.userId,
      name: "Brave",
      tokenHash: randomUUID(),
      lastSeenAt: now,
    });
    await db.insert(companionSnapshot).values({
      userId: a.userId,
      cfnUserId: shared,
      profile: {
        cfnUserId: shared,
        displayName: "R",
        favoriteCharacterKey: null,
        characters: [],
      },
      profileObservedAt: now,
      matchesObservedAt: now,
    });

    const signalsA = await loadCompanionSignals(db, a.userId, shared, now);
    expect(signalsA).toMatchObject({ required: true, deviceCount: 1, hasProfile: true });
    expect(assessCompanion(signalsA, now.getTime()).canStart).toBe(true);

    // B never paired: A's device/snapshot never leak, even for A's CFN.
    const signalsB = await loadCompanionSignals(db, b.userId, shared, now);
    expect(signalsB).toMatchObject({
      deviceCount: 0,
      lastSeenAt: null,
      profileObservedAt: null,
      matchesObservedAt: null,
      hasProfile: false,
    });
    expect(assessCompanion(signalsB, now.getTime())).toMatchObject({
      canStart: false,
      nextStep: "pairCompanion",
    });
  });

  it("revoked devices don't count; the live dashboard state carries the signals", async () => {
    const c = await account(cfn());
    await db.insert(companionDevice).values({
      userId: c.userId,
      name: "Old",
      tokenHash: randomUUID(),
      lastSeenAt: new Date(),
      revokedAt: new Date(),
    });
    const state = await buildDashboardLiveState(db, c.player.id);
    expect(state?.companion).toMatchObject({ required: true, deviceCount: 0 });
    // Nothing secret in the payload.
    expect(JSON.stringify(state?.companion)).not.toMatch(/token|hash/i);
  });

  it("missing companion data maps to the companion message, not a Capcom outage", () => {
    expect(isMissingCompanionData(new SF6ProviderError("unavailable", "stale"))).toBe(true);
    expect(isMissingCompanionData(new SF6ProviderError("not_found", "x"))).toBe(false);
  });
});
