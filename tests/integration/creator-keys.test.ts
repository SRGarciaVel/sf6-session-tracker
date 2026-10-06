/**
 * Creator Keys against a real Postgres (TEST_DATABASE_URL): issuance (no plaintext stored),
 * atomic one-time redeem under concurrency, rollback when the grant insert fails, generic
 * failures, fail-closed rate limits, revocation, renewal semantics, deleted users and logs.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.RATE_LIMIT_STORE = "memory";
process.env.LOG_LEVEL = "error";
const PEPPER = "integration-test-pepper-9c1e4b7a2d6f8e0c3b5a7d9f1e2c4b6a";
process.env.CREATOR_KEY_PEPPER = PEPPER;

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, creatorKey, entitlementGrant } = await import("@/server/db/schema");
const service = await import("@/server/creator-keys/service");
const { normalizeCreatorKey } = await import("@/server/creator-keys/crypto");
const { resolveAccountPlan, getEntitlements } = await import("@/server/entitlements/service");
const { PLAN_ENTITLEMENTS } = await import("@/domain/entitlements/plans");
const { memoryStore, resetRateLimits, setRateLimitStore } =
  await import("@/server/security/rate-limit");

const DAY = 86_400_000;

describe.skipIf(!TEST_DB)("Creator Keys (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  beforeEach(() => {
    resetRateLimits();
    setRateLimitStore(memoryStore);
  });
  afterEach(() => setRateLimitStore(null));
  afterAll(async () => {
    await closeDb();
  });

  async function newUser() {
    const id = randomUUID();
    await db.insert(authUser).values({ id, name: "CK", email: `${id}@test.local` });
    return id;
  }
  const issue = (now?: Date) =>
    service.issueCreatorKey(db, { pepper: PEPPER, issuedBy: "test-operator", now });
  const keyRow = async (id: string) =>
    (await db.select().from(creatorKey).where(eq(creatorKey.id, id)))[0];

  it("issuance: plaintext never stored; frozen plan/days; 30-day redemption window", async () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const k = await issue(now);
    const body = normalizeCreatorKey(k.key);
    const row = await keyRow(k.id);
    expect(row).toBeDefined();
    const stored = JSON.stringify(row, (_k, v: unknown) =>
      Buffer.isBuffer(v) ? v.toString("hex") : v,
    );
    expect(stored).not.toContain(k.key);
    expect(stored).not.toContain(body);
    expect(row?.keyHash).toHaveLength(32);
    expect(row).toMatchObject({
      keyHint: body?.slice(-4),
      plan: "creator_beta",
      grantDays: 90,
      issuedBy: "test-operator",
      redeemedAt: null,
      revokedAt: null,
    });
    expect(row?.expiresAt.getTime()).toBe(now.getTime() + 30 * DAY);
  });

  it("redeem: creator_beta grant for exactly 90 days, linked to the key; resolver picks it up", async () => {
    const userId = await newUser();
    const k = await issue();
    const now = new Date();
    const res = await service.redeemCreatorKey(db, { userId, rawKey: k.key, pepper: PEPPER, now });
    expect(res).toMatchObject({ ok: true, plan: "creator_beta", keyId: k.id });
    if (!res.ok) throw new Error("unreachable");
    expect(res.grantExpiresAt.getTime()).toBe(now.getTime() + 90 * DAY);

    const [grant] = await db
      .select()
      .from(entitlementGrant)
      .where(eq(entitlementGrant.creatorKeyId, k.id));
    expect(grant).toMatchObject({
      userId,
      plan: "creator_beta",
      source: "creator_key",
      revokedAt: null,
    });
    expect(grant?.startsAt.getTime()).toBe(now.getTime());
    expect(grant?.expiresAt?.getTime()).toBe(now.getTime() + 90 * DAY);
    expect((await keyRow(k.id))?.redeemedBy).toBe(userId);

    const resolved = await resolveAccountPlan(db, userId);
    expect(resolved).toMatchObject({ plan: "creator_beta", source: "grant" });
    expect(resolved.activeUntil?.getTime()).toBe(now.getTime() + 90 * DAY);
    // Since Phase 4 the redeemed plan unlocks advanced overlay customization.
    expect(await getEntitlements(db, userId)).toEqual(PLAN_ENTITLEMENTS.creator_beta);
  });

  it("CONCURRENT redeem of one key: exactly one success and exactly one grant", async () => {
    const k = await issue();
    const users = await Promise.all(Array.from({ length: 6 }, newUser));
    const results = await Promise.all(
      users.map((userId) =>
        service.redeemCreatorKey(db, { userId, rawKey: k.key, pepper: PEPPER }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(5);
    expect(await service.countGrantsForKey(db, k.id)).toBe(1);
    const winner = users[results.findIndex((r) => r.ok)];
    expect((await keyRow(k.id))?.redeemedBy).toBe(winner);
    for (const userId of users.filter((u) => u !== winner)) {
      expect((await resolveAccountPlan(db, userId)).plan).toBe("free");
    }
  });

  it("ROLLBACK: if the grant insert fails, the key is NOT consumed and stays redeemable", async () => {
    const userId = await newUser();
    const k = await issue();
    await db.execute(sql`
      create or replace function test_fail_grant() returns trigger language plpgsql as $$
      begin raise exception 'injected grant failure'; end $$;`);
    await db.execute(sql`create trigger test_fail_grant before insert on entitlement_grant
      for each row execute function test_fail_grant()`);
    try {
      await expect(
        service.redeemCreatorKey(db, { userId, rawKey: k.key, pepper: PEPPER }),
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_grant on entitlement_grant`);
      await db.execute(sql`drop function if exists test_fail_grant()`);
    }
    expect((await keyRow(k.id))?.redeemedAt).toBeNull();
    expect(await service.countGrantsForKey(db, k.id)).toBe(0);
    expect((await service.redeemCreatorKey(db, { userId, rawKey: k.key, pepper: PEPPER })).ok).toBe(
      true,
    );
  });

  it("generic failure for wrong, malformed, expired, revoked and already-used keys", async () => {
    const userId = await newUser();
    const other = await newUser();
    const used = await issue();
    await service.redeemCreatorKey(db, { userId: other, rawKey: used.key, pepper: PEPPER });
    const expired = await issue(new Date(Date.now() - 31 * DAY));
    const revoked = await issue();
    await service.revokeCreatorKey(db, { keyId: revoked.id, revokedBy: "op", revokeGrant: false });
    const valid = await issue();
    const wrongPepper = await service.issueCreatorKey(db, {
      pepper: `${PEPPER}-other`,
      issuedBy: "op",
    });

    for (const rawKey of [
      "SST-0000-0000-0000-0000-0000", // well-formed, unknown
      "not a key",
      `${valid.key}X`,
      expired.key,
      revoked.key,
      used.key,
      wrongPepper.key, // hashed with another pepper ⇒ unknown here
    ]) {
      expect(await service.redeemCreatorKey(db, { userId, rawKey, pepper: PEPPER })).toEqual({
        ok: false,
      });
      resetRateLimits();
      expect(
        await service.attemptCreatorKeyRedeem(db, { userId, ip: "198.51.100.7", rawKey }),
      ).toEqual({ status: "invalid" });
    }
    expect((await resolveAccountPlan(db, userId)).plan).toBe("free");
    // The valid key was untouched by all of the above.
    expect((await keyRow(valid.id))?.redeemedAt).toBeNull();
  });

  it("a key always grants the authenticated redeemer, never anyone else", async () => {
    const a = await newUser();
    const b = await newUser();
    const k = await issue();
    await service.attemptCreatorKeyRedeem(db, { userId: a, ip: "local", rawKey: k.key });
    expect((await resolveAccountPlan(db, a)).plan).toBe("creator_beta");
    expect((await resolveAccountPlan(db, b)).plan).toBe("free");
  });

  it("rate limits: per user, and FAIL-CLOSED when the limiter store is down (key not consumed)", async () => {
    const userId = await newUser();
    const k = await issue();
    for (let i = 0; i < service.REDEEM_LIMITS.perUser.max; i++) {
      expect(
        (await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: "nope" })).status,
      ).toBe("invalid");
    }
    expect(
      await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: k.key }),
    ).toMatchObject({ status: "rate_limited" });
    expect((await keyRow(k.id))?.redeemedAt).toBeNull();

    resetRateLimits();
    setRateLimitStore({
      consume: () => Promise.reject(new Error("limiter store unreachable")),
    });
    expect(
      await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: k.key }),
    ).toMatchObject({ status: "rate_limited" });
    expect((await keyRow(k.id))?.redeemedAt).toBeNull();
  });

  it("per-IP limit applies across accounts", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < service.REDEEM_LIMITS.perIp.max; i++) {
      const userId = await newUser();
      expect(
        (await service.attemptCreatorKeyRedeem(db, { userId, ip, rawKey: "nope" })).status,
      ).toBe("invalid");
    }
    const userId = await newUser();
    expect(await service.attemptCreatorKeyRedeem(db, { userId, ip, rawKey: "nope" })).toMatchObject(
      { status: "rate_limited" },
    );
  });

  it("revocation: unredeemed key stops working; redeemed key's grant only with --revoke-grant", async () => {
    const userId = await newUser();
    const unused = await issue();
    expect(
      await service.revokeCreatorKey(db, { keyId: unused.id, revokedBy: "op", revokeGrant: false }),
    ).toEqual({ found: true, keyRevoked: true, wasRedeemed: false, grantRevoked: false });
    expect(
      (await service.redeemCreatorKey(db, { userId, rawKey: unused.key, pepper: PEPPER })).ok,
    ).toBe(false);

    const used = await issue();
    await service.redeemCreatorKey(db, { userId, rawKey: used.key, pepper: PEPPER });
    expect(
      await service.revokeCreatorKey(db, { keyId: used.id, revokedBy: "op", revokeGrant: false }),
    ).toEqual({ found: true, keyRevoked: true, wasRedeemed: true, grantRevoked: false });
    expect((await resolveAccountPlan(db, userId)).plan).toBe("creator_beta");
    expect(
      await service.revokeCreatorKey(db, { keyId: used.id, revokedBy: "op", revokeGrant: true }),
    ).toEqual({ found: true, keyRevoked: false, wasRedeemed: true, grantRevoked: true });
    expect((await resolveAccountPlan(db, userId)).plan).toBe("free");
    // Nothing deleted: audit rows remain.
    expect(await keyRow(used.id)).toBeDefined();
    expect(await service.countGrantsForKey(db, used.id)).toBe(1);
    expect(
      (
        await service.revokeCreatorKey(db, {
          keyId: randomUUID(),
          revokedBy: "op",
          revokeGrant: true,
        })
      ).found,
    ).toBe(false);
  });

  it("second key during an active grant: independent 90-day grant, latest end wins (no summing)", async () => {
    const userId = await newUser();
    const t0 = new Date();
    const t1 = new Date(t0.getTime() + 20 * DAY); // inside the second key's 30-day window
    const first = await issue(t0);
    const second = await issue(t0);
    await service.redeemCreatorKey(db, { userId, rawKey: first.key, pepper: PEPPER, now: t0 });
    // Exactly at its 30-day expiry a key is no longer redeemable…
    const third = await issue(t0);
    expect(
      (
        await service.redeemCreatorKey(db, {
          userId,
          rawKey: third.key,
          pepper: PEPPER,
          now: new Date(t0.getTime() + 30 * DAY),
        })
      ).ok,
    ).toBe(false);
    // …but inside it, it is.
    await service.redeemCreatorKey(db, { userId, rawKey: second.key, pepper: PEPPER, now: t1 });
    const resolved = await resolveAccountPlan(db, userId, new Date(t1.getTime() + 1000));
    expect(resolved.plan).toBe("creator_beta");
    expect(resolved.activeUntil?.getTime()).toBe(t1.getTime() + 90 * DAY); // not t0 + 180 days
  });

  it("deleting the redeemer keeps the key's audit row (redeemed_by → NULL) and it stays used", async () => {
    const userId = await newUser();
    const k = await issue();
    await service.redeemCreatorKey(db, { userId, rawKey: k.key, pepper: PEPPER });
    await db.delete(authUser).where(eq(authUser.id, userId));
    const row = await keyRow(k.id);
    expect(row?.redeemedBy).toBeNull();
    expect(row?.redeemedAt).not.toBeNull();
    const other = await newUser();
    expect(
      (await service.redeemCreatorKey(db, { userId: other, rawKey: k.key, pepper: PEPPER })).ok,
    ).toBe(false);
  });

  it("DB constraints: unique hash, plan, grant days, window, link ⇔ source", async () => {
    const k = await issue();
    const row = await keyRow(k.id);
    await expect(
      db.insert(creatorKey).values({
        keyHash: row?.keyHash ?? Buffer.alloc(32),
        keyHint: "ABCD",
        plan: "creator_beta",
        grantDays: 90,
        expiresAt: new Date(Date.now() + DAY),
        issuedBy: "op",
      }),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into creator_key (key_hash, key_hint, plan, grant_days, expires_at, issued_by)
        values (${Buffer.alloc(32, 1)}, 'ABCD', 'creator_beta', 0, now() + interval '1 day', 'op')`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`insert into creator_key (key_hash, key_hint, plan, grant_days, expires_at, issued_by)
        values (${Buffer.alloc(32, 2)}, 'ABCD', 'plus', 90, now() + interval '1 day', 'op')`),
    ).rejects.toThrow();
    const userId = await newUser();
    await expect(
      db.execute(sql`insert into entitlement_grant (user_id, plan, source)
        values (${userId}, 'creator_beta', 'creator_key')`),
    ).rejects.toThrow(); // creator_key source without a key id
  });

  it("least privilege: the proposed runtime grants are enough to redeem, and nothing more", async () => {
    const role = `sst_rt_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const password = randomUUID();
    const [roleRow] = (await db.execute(
      sql`select rolcreaterole or rolsuper as can from pg_roles where rolname = current_user`,
    )) as unknown as Array<{ can: boolean }>;
    if (!roleRow?.can) return; // test DB user cannot create roles: nothing to verify here
    await db.execute(sql.raw(`create role ${role} login password '${password}'`));
    try {
      await db.execute(sql.raw(`grant usage on schema public to ${role}`));
      // Exactly the production runtime grants documented in docs/creator-keys.md:
      await db.execute(sql.raw(`grant select on creator_key, entitlement_grant to ${role}`));
      await db.execute(
        sql.raw(`grant update (redeemed_by, redeemed_at) on creator_key to ${role}`),
      );
      await db.execute(sql.raw(`grant insert on entitlement_grant to ${role}`));

      const url = new URL(TEST_DB ?? "");
      url.username = role;
      url.password = password;
      const postgres = (await import("postgres")).default;
      const { drizzle } = await import("drizzle-orm/postgres-js");
      const schema = await import("@/server/db/schema");
      const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
      const runtimeDb = drizzle(client, { schema });
      try {
        const userId = await newUser();
        const k = await issue();
        const res = await service.redeemCreatorKey(runtimeDb, {
          userId,
          rawKey: k.key,
          pepper: PEPPER,
        });
        expect(res.ok).toBe(true);
        // The runtime role can neither issue nor revoke.
        await expect(
          service.issueCreatorKey(runtimeDb, { pepper: PEPPER, issuedBy: "rt" }),
        ).rejects.toThrow();
        await expect(
          service.revokeCreatorKey(runtimeDb, { keyId: k.id, revokedBy: "rt", revokeGrant: true }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    } finally {
      await db.execute(sql.raw(`drop owned by ${role}`));
      await db.execute(sql.raw(`drop role ${role}`));
    }
  });

  it("never logs the key, its normalized form or the pepper", async () => {
    process.env.LOG_LEVEL = "debug";
    const lines: string[] = [];
    const spyLog = vi.spyOn(console, "log").mockImplementation((l: unknown) => {
      lines.push(String(l));
    });
    const spyErr = vi.spyOn(console, "error").mockImplementation((l: unknown) => {
      lines.push(String(l));
    });
    try {
      const userId = await newUser();
      const k = await issue();
      await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: k.key });
      await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: k.key });
      await service.attemptCreatorKeyRedeem(db, { userId, ip: "local", rawKey: "SST-bad" });
      const all = lines.join("\n");
      expect(all).toContain("creator_key.redeem");
      expect(all).not.toContain(k.key);
      expect(all).not.toContain(normalizeCreatorKey(k.key));
      expect(all).not.toContain(PEPPER);
      expect(all).not.toContain("SST-bad");
    } finally {
      spyLog.mockRestore();
      spyErr.mockRestore();
      process.env.LOG_LEVEL = "error";
    }
  });
});
