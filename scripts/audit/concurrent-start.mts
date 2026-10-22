/**
 * Reproduction (LOCAL TEST DATABASE ONLY): three concurrent session starts for one player.
 *   pnpm exec tsx scripts/audit/concurrent-start.mts
 * Uses TEST_DATABASE_URL (must be loopback), fictitious data, and deletes it afterwards.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env");
const url = process.env.TEST_DATABASE_URL ?? "";
if (!["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname)) {
  throw new Error("REFUSING: TEST_DATABASE_URL must be local");
}
process.env.DATABASE_URL = url;
process.env.SF6_PROVIDER = "companion";
process.env.LOG_LEVEL = "error";

const core = await import("@sf6/capcom-core");
const { getDb, closeDb } = await import("../../src/server/db/client");
const { authUser, companionDevice, gameSession } = await import("../../src/server/db/schema");
const { applyCompanionSync } = await import("../../src/server/companion/service");
const { upsertPlayerForUser } = await import("../../src/server/players/service");
const { CompanionSF6DataProvider } = await import("../../src/server/sf6/providers/companion");
const { startSession } = await import("../../src/server/sessions/service");
const { eq } = await import("drizzle-orm");

const db = getDb();
const userId = randomUUID();
const cfn = "9990000777";
try {
  await db.insert(authUser).values({ id: userId, name: "SIM", email: `${userId}@test.local` });
  const [device] = await db
    .insert(companionDevice)
    .values({ userId, name: "SIM", tokenHash: randomUUID().replace(/-/g, "") })
    .returning();
  const raw = JSON.parse(readFileSync("tests/fixtures/capcom/play-1733837998.json", "utf8"));
  const p = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: "1733837998",
  }).profile;
  const profile = core.toWireProfile({ ...p, cfnUserId: cfn, displayName: "SIM" });
  const now = new Date();
  await applyCompanionSync(
    db,
    device!,
    core.companionSyncRequestSchema.parse({
      cfnUserId: cfn,
      observedAt: now.toISOString(),
      profile,
      matches: [],
      gapSuspected: false,
      client: { version: "0.4.0", transport: "service_worker" },
    }),
    now,
  );
  const provider = new CompanionSF6DataProvider(db, 300_000);
  const player = await upsertPlayerForUser(db, userId, profile);
  const settled = await Promise.allSettled([1, 2, 3].map(() => startSession(db, provider, player)));
  const rows = await db.select().from(gameSession).where(eq(gameSession.playerId, player.id));
  const result = {
    starts: settled.map((s) => s.status),
    sessions: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    endedEmpty: rows.filter((r) => r.status === "ended").length,
  };
  console.log(JSON.stringify(result));
  writeFileSync(
    "docs/audit/2026-10-22-evidence/concurrent-start.json",
    JSON.stringify(result, null, 2),
  );
} finally {
  await db.delete(authUser).where(eq(authUser.id, userId));
  await closeDb();
}
