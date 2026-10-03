/**
 * Audit tests (read-only w.r.t. architecture): IDOR protection on owned resources, public overlay
 * payload minimization, and idempotency of concurrent ingestion (lease-overlap race).
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
const { authUser, match } = await import("@/server/db/schema");
const { ingestMatches } = await import("@/server/ingestion/ingest");
const { getOwnedOverlay, listOverlays } = await import("@/server/overlays/service");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { getOwnedSession, startSession } = await import("@/server/sessions/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");

describe.skipIf(!TEST_DB)("authorization & idempotency audit (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const mock = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  const provider = TEST_DB
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);

  afterAll(async () => {
    await closeDb();
  });

  async function newPlayer() {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "audit", email: `${userId}@test.local` });
    const cfn = String(4_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn));
    const [overlay] = await listOverlays(db, player.id);
    if (!overlay) throw new Error("no overlay");
    return { userId, cfn, player, overlay };
  }

  it("user A cannot load user B's overlay or session by id (IDOR)", async () => {
    const a = await newPlayer();
    const b = await newPlayer();
    const bSession = await startSession(db, provider, b.player);

    expect(await getOwnedOverlay(db, a.userId, b.overlay.id)).toBeNull();
    expect(await getOwnedOverlay(db, b.userId, b.overlay.id)).not.toBeNull();
    expect(await getOwnedSession(db, a.player.id, bSession.id)).toBeNull();
    expect(await getOwnedSession(db, b.player.id, bSession.id)).not.toBeNull();
  });

  it("public overlay payload exposes no internal identifiers", async () => {
    const a = await newPlayer();
    await startSession(db, provider, a.player);
    const result = await loadOverlayPayload(a.overlay.publicToken);
    const json = JSON.stringify(result?.payload);
    for (const secret of [a.cfn, a.player.id, a.userId, a.overlay.id, a.overlay.publicToken]) {
      expect(json).not.toContain(secret);
    }
    expect(result?.payload.live.session.sessionId).toBeNull();
  });

  it("two workers ingesting the same matches concurrently count each match once", async () => {
    const a = await newPlayer();
    const session = await startSession(db, provider, a.player);
    await mock.simulateMatch(a.cfn, { result: "win" });
    await mock.simulateMatch(a.cfn, { result: "loss" });
    const matches = await provider.getRecentMatches(a.cfn);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ingestMatches(db, matches, {
          playerId: a.player.id,
          sessionId: session.id,
          startGraceMs: 0,
        }),
      ),
    );
    expect(results.reduce((n, r) => n + r.inserted, 0)).toBe(2);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(match)
      .where(eq(match.sessionId, session.id));
    expect(row?.n).toBe(2);
  });
});
