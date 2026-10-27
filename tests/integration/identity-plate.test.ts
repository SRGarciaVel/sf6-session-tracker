/**
 * M2D — character plate setting against a real Postgres (TEST_DATABASE_URL): the onboarding
 * overlay starts Automatic; Off / Automatic go through the real save path (owner entitlements +
 * merge) into the public payload; rows saved before the setting, or with an unusable value, read
 * as Off without touching the stored JSON; a forged value never validates.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { OverlayConfig, SessionOverlayConfig } from "@/domain/overlay/config";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, overlay } = await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { listOverlays, updateOverlay, getOverlayById } = await import("@/server/overlays/service");
const { prepareOverlayConfigForSave } = await import("@/server/overlays/effective");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { overlayConfigSchema, sessionConfigOf } = await import("@/domain/overlay/config");

function session(config: OverlayConfig): SessionOverlayConfig {
  const s = sessionConfigOf(config);
  if (!s) throw new Error("expected a Session overlay");
  return s;
}

describe.skipIf(!TEST_DB)("character plate setting (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const users: string[] = [];

  async function owner() {
    const userId = randomUUID();
    users.push(userId);
    await db.insert(authUser).values({ id: userId, name: "IP", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    const [ov] = await listOverlays(db, player.id);
    if (!ov) throw new Error("no overlay");
    return { userId, overlayId: ov.id };
  }
  const stored = async (overlayId: string) => {
    const view = await getOverlayById(db, overlayId);
    if (!view) throw new Error("gone");
    return { ...view, config: session(view.config) };
  };
  async function save(userId: string, overlayId: string, edit: Partial<SessionOverlayConfig>) {
    const view = await stored(overlayId);
    const merged = await prepareOverlayConfigForSave(db, {
      userId,
      stored: view.config,
      incoming: { ...view.config, ...edit },
    });
    await updateOverlay(db, view, { config: merged });
  }
  const publicConfig = async (overlayId: string) => {
    const p = await loadOverlayPayload((await stored(overlayId)).publicToken);
    if (!p) throw new Error("no payload");
    return session(p.payload.config);
  };
  const rawConfig = async (overlayId: string) =>
    (await db.select({ c: overlay.config }).from(overlay).where(eq(overlay.id, overlayId)))[0]!
      .c as Record<string, unknown>;

  afterAll(async () => {
    for (const id of users) await db.delete(authUser).where(eq(authUser.id, id));
    await closeDb();
  });

  it("the onboarding overlay starts Automatic; Off and Automatic are saved and published", async () => {
    const { userId, overlayId } = await owner();
    expect((await publicConfig(overlayId)).identityPlate).toBe("auto");
    await save(userId, overlayId, { identityPlate: "off" });
    expect((await rawConfig(overlayId)).identityPlate).toBe("off");
    expect((await publicConfig(overlayId)).identityPlate).toBe("off");
    await save(userId, overlayId, { identityPlate: "auto" });
    expect((await publicConfig(overlayId)).identityPlate).toBe("auto");
  });

  it("a row saved before the setting reads Off; reading never rewrites it", async () => {
    const { overlayId } = await owner();
    const raw = await rawConfig(overlayId);
    delete raw.identityPlate;
    await db.update(overlay).set({ config: raw }).where(eq(overlay.id, overlayId));
    expect((await publicConfig(overlayId)).identityPlate).toBe("off");
    expect("identityPlate" in (await rawConfig(overlayId))).toBe(false);
  });

  it("an unusable stored value reads Off and keeps the rest of the overlay", async () => {
    const { overlayId } = await owner();
    const raw = { ...(await rawConfig(overlayId)), identityPlate: "portrait", title: "KEEP" };
    await db.update(overlay).set({ config: raw }).where(eq(overlay.id, overlayId));
    const config = await publicConfig(overlayId);
    expect(config.identityPlate).toBe("off");
    expect(config.title).toBe("KEEP");
  });

  it("a forged value never validates on save (the action's schema)", async () => {
    const { overlayId } = await owner();
    const view = await stored(overlayId);
    expect(overlayConfigSchema.safeParse({ ...view.config, identityPlate: "url" }).success).toBe(
      false,
    );
  });
});
