/**
 * Phase 5.4B — Rank Progress overlay against a real Postgres (TEST_DATABASE_URL): created with its
 * own defaults in `overlay.config` (no migration), same token / public payload `{ config, live }`
 * as Session, same overlay limit, immutable kind both ways, no Session presets, and a rating
 * update reaching the projection through the existing payload path (no new query path).
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
const { authUser, entitlementGrant, overlay, sf6Player } = await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { ResilientProvider } = await import("@/server/sf6/resilient");
const { startSession } = await import("@/server/sessions/service");
const { claimDuePlayers, pollPlayer } = await import("@/server/tracking/tracker");
const { logger } = await import("@/server/logger");
const service = await import("@/server/overlays/service");
const { prepareOverlayConfigForSave } = await import("@/server/overlays/effective");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const presets = await import("@/server/overlays/presets");
const { canCreateOverlay } = await import("@/server/entitlements/service");
const { checkOverlayKindEdit } = await import("@/domain/overlay/kind");
const { DEFAULT_SESSION_OVERLAY_CONFIG, defaultOverlayConfigForKind, overlayConfigSchema } =
  await import("@/domain/overlay/config");
const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, resolveRankProgressView } =
  await import("@/domain/overlay/rank-progress");

const pollConfig = {
  polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
  leaseMs: 60_000,
  profileRefreshMs: 300_000,
  startGraceMs: 90_000,
};

describe.skipIf(!TEST_DB)("Rank Progress overlay (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const mock = TEST_DB ? new MockSF6DataProvider(db) : (null as never);
  const provider = TEST_DB
    ? new ResilientProvider(mock, { timeoutMs: 5_000, cacheTtlMs: 0 })
    : (null as never);
  afterAll(async () => {
    await closeDb();
  });

  async function owner(creator = false) {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "RP", email: `${userId}@test.local` });
    const cfn = String(6_500_000_000 + Math.floor(Math.random() * 99_999_999));
    const player = await upsertPlayerForUser(db, userId, await provider.getPlayerProfile(cfn));
    if (creator) {
      await db.insert(entitlementGrant).values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
    }
    const rp = await service.createOverlay(db, player.id, "Road to Master", {
      ...defaultOverlayConfigForKind("rank-progress"),
      locale: "en",
    });
    return { userId, cfn, player, rp };
  }
  const storedJson = async (id: string) =>
    (await db.select({ c: overlay.config }).from(overlay).where(eq(overlay.id, id)))[0]!
      .c as Record<string, unknown>;

  it("creation stores the Rank Progress default in overlay.config (kind rank-progress)", async () => {
    const { rp } = await owner();
    expect(await storedJson(rp.id)).toEqual({
      ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
      locale: "en",
    });
    expect(rp.storedKind).toBe("rank-progress");
    expect(rp.config.kind).toBe("rank-progress");
  });

  it("Session and Rank Progress overlays count against the same overlay limit", async () => {
    const { userId, player } = await owner();
    const all = await service.listOverlays(db, player.id);
    expect(all.map((o) => o.config.kind).sort()).toEqual(["rank-progress", "session"]);
    // The quota is computed from every overlay of the player, whatever its kind.
    expect(all).toHaveLength(2);
    const atLimit = await canCreateOverlay(db, { userId, currentCount: all.length + 100 });
    expect(atLimit.ok).toBe(false);
  });

  it("public payload: same token route and {config, live} shape; live identical to Session's", async () => {
    const { player, rp } = await owner();
    const [session] = (await service.listOverlays(db, player.id)).filter(
      (o) => o.config.kind === "session",
    );
    const a = await loadOverlayPayload(rp.publicToken);
    const b = await loadOverlayPayload(session!.publicToken);
    expect(Object.keys(a!.payload).sort()).toEqual(["config", "live"]);
    expect(a!.payload.config).toEqual({ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "en" });
    expect({ ...a!.payload.live, generatedAt: null }).toEqual({
      ...b!.payload.live,
      generatedAt: null,
    });
    // Nothing internal leaks through the public payload.
    expect(a!.payload.live.session.sessionId).toBeNull();
  });

  it("kind is immutable both ways: forged saves are rejected / keep the stored config", async () => {
    const { userId, player, rp } = await owner(true);
    const [session] = (await service.listOverlays(db, player.id)).filter(
      (o) => o.config.kind === "session",
    );
    // Rank Progress → Session
    expect(checkOverlayKindEdit(rp.storedKind, "session")).toEqual({
      ok: false,
      error: "kind_mismatch",
    });
    const kept = await prepareOverlayConfigForSave(db, {
      userId,
      stored: rp.config,
      incoming: DEFAULT_SESSION_OVERLAY_CONFIG,
    });
    expect(kept).toEqual(rp.config);
    // Session → Rank Progress
    expect(checkOverlayKindEdit(session!.storedKind, "rank-progress")).toEqual({
      ok: false,
      error: "kind_mismatch",
    });
    const keptSession = await prepareOverlayConfigForSave(db, {
      userId,
      stored: session!.config,
      incoming: DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
    });
    expect(keptSession).toEqual(session!.config);
    // A valid Rank Progress edit is saved as is (Free: no Creator merge).
    const edit = overlayConfigSchema.parse({ ...rp.config, style: "compact", goal: "master" });
    const merged = await prepareOverlayConfigForSave(db, {
      userId,
      stored: rp.config,
      incoming: edit,
    });
    await service.updateOverlay(db, rp, { config: merged });
    expect(await storedJson(rp.id)).toMatchObject({
      kind: "rank-progress",
      style: "compact",
      goal: "master",
    });
  });

  it("a Session preset never applies to a Rank Progress overlay (nothing written)", async () => {
    const { userId, rp } = await owner(true);
    const created = await presets.createPreset(db, {
      userId,
      name: "Session look",
      config: DEFAULT_SESSION_OVERLAY_CONFIG,
    });
    if (!created.ok) throw new Error(created.error);
    const before = await storedJson(rp.id);
    expect(
      await presets.applyPresetToOverlay(db, {
        userId,
        presetId: created.value.id,
        overlayId: rp.id,
      }),
    ).toEqual({ ok: false, error: "incompatible_kind" });
    expect(await storedJson(rp.id)).toEqual(before);
  });

  it("no session ever: the live roster is empty today ⇒ neutral no-rating state (documented gap)", async () => {
    const { rp } = await owner();
    const p = (await loadOverlayPayload(rp.publicToken))!.payload;
    expect(p.live.session.status).toBe("none");
    expect(p.live.session.characters).toEqual([]);
    const config = p.config.kind === "rank-progress" ? p.config : null;
    expect(resolveRankProgressView(p.live.session, config!).state).toEqual({ kind: "no-rating" });
  });

  it("a rating update reaches the projection through the same payload path", async () => {
    const { cfn, player, rp } = await owner();
    const [row] = await db.select().from(sf6Player).where(eq(sf6Player.id, player.id));
    await startSession(db, provider, row!);
    const view = async () => {
      const p = (await loadOverlayPayload(rp.publicToken))!.payload;
      if (p.config.kind !== "rank-progress") throw new Error("kind");
      return resolveRankProgressView(p.live.session, p.config);
    };
    const before = await view();
    expect(before.state.kind).not.toBe("no-rating");
    const valueOf = (v: Awaited<ReturnType<typeof view>>) =>
      v.state.kind === "no-rating" ? null : v.state.current.value;

    await mock.simulateMatch(cfn, { result: "win" });
    await db.execute(sql`update sf6_player set next_poll_at = now() where id = ${player.id}`);
    const claimed = (await claimDuePlayers(db, "rp", 50, 60_000)).filter((c) => c.id === player.id);
    for (const c of claimed) await pollPlayer(db, provider, c, pollConfig, "rp", logger);

    const after = await view();
    expect(valueOf(after)).not.toBe(valueOf(before));
    // Authoritative per-character delta, baseline known (session started with baselines).
    expect(after.sessionDelta).not.toBeNull();
    expect(after.sessionDelta!.value).toBe(valueOf(after)! - valueOf(before)!);
  });
});
