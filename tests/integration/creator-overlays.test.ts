/**
 * Creator Beta overlay customization against a real Postgres (TEST_DATABASE_URL): server-side
 * save enforcement with the owner's entitlements, public (OBS) effective config, expiry,
 * downgrade preservation (including Free edits), renewal and crafted Free requests.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { CreatorCustomization } from "@/domain/overlay/creator";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, entitlementGrant, overlay } = await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { listOverlays, updateOverlay, getOverlayById } = await import("@/server/overlays/service");
const { prepareOverlayConfigForSave, resolveEffectiveOverlayConfig } =
  await import("@/server/overlays/effective");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const { DEFAULT_CREATOR_CUSTOMIZATION } = await import("@/domain/overlay/creator");

const DAY = 86_400_000;
const custom: CreatorCustomization = {
  ...DEFAULT_CREATOR_CUSTOMIZATION,
  secondaryAccent: "#ffb000",
  numberScale: 1.15,
};

describe.skipIf(!TEST_DB)("Creator overlay customization (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  afterAll(async () => {
    await closeDb();
  });

  async function owner() {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "CO", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    const [ov] = await listOverlays(db, player.id);
    if (!ov) throw new Error("no overlay");
    return { userId, player, overlayId: ov.id };
  }
  const grant = (userId: string, expiresAt: Date) =>
    db
      .insert(entitlementGrant)
      .values({ userId, plan: "creator_beta", source: "operator", expiresAt })
      .returning({ id: entitlementGrant.id });
  const stored = async (overlayId: string) => {
    const view = await getOverlayById(db, overlayId);
    if (!view) throw new Error("gone");
    return view;
  };
  /** The real save path: owner's entitlements + merge, then persist. */
  async function save(
    userId: string,
    overlayId: string,
    edit: (c: CreatorCustomization | undefined) => object,
  ) {
    const view = await stored(overlayId);
    const incoming = { ...view.config, ...edit(view.config.creator) };
    const merged = await prepareOverlayConfigForSave(db, {
      userId,
      stored: view.config,
      incoming: incoming as typeof view.config,
    });
    await updateOverlay(db, view, { name: view.name, config: merged });
  }

  it("CRITICAL downgrade cycle: save → expire → Free edits base → still stored → renew → back", async () => {
    const { userId, overlayId } = await owner();
    const [g] = await grant(userId, new Date(Date.now() + 90 * DAY));

    // 1. Creator saves customization; OBS renders it.
    await save(userId, overlayId, () => ({ creator: custom }));
    expect((await stored(overlayId)).config.creator).toEqual(custom);
    expect((await resolveEffectiveOverlayConfig(db, await stored(overlayId))).creator).toEqual(
      custom,
    );

    // 2. Creator Beta expires (no write: the resolver just sees an expired grant).
    const later = new Date(Date.now() + 91 * DAY);
    expect(
      (await resolveEffectiveOverlayConfig(db, await stored(overlayId), later)).creator,
    ).toBeUndefined();
    // …make it expired for real for the next steps.
    await db
      .update(entitlementGrant)
      .set({ revokedAt: new Date() })
      .where(eq(entitlementGrant.id, g?.id ?? ""));

    // 3. Free edits base settings (the editor sends whatever creator block it holds, or none).
    await save(userId, overlayId, () => ({ locale: "en", theme: "fighter", creator: undefined }));
    let view = await stored(overlayId);
    expect(view.config.locale).toBe("en");
    expect(view.config.theme).toBe("fighter");
    // 4/5. Customization NOT deleted; public render is the Free fallback.
    expect(view.config.creator).toEqual(custom);
    expect((await resolveEffectiveOverlayConfig(db, view)).creator).toBeUndefined();

    // 6. Renewed: it comes back unchanged.
    await grant(userId, new Date(Date.now() + 90 * DAY));
    view = await stored(overlayId);
    expect((await resolveEffectiveOverlayConfig(db, view)).creator).toEqual(custom);
  });

  it("crafted Free request cannot add or change Creator values", async () => {
    const { userId, overlayId } = await owner();
    await save(userId, overlayId, () => ({ creator: custom }));
    expect((await stored(overlayId)).config.creator).toBeUndefined();

    // Owner had Creator before: Free tampering keeps the stored values.
    const other = await owner();
    const [g] = await grant(other.userId, new Date(Date.now() + DAY));
    await save(other.userId, other.overlayId, () => ({ creator: custom }));
    await db
      .update(entitlementGrant)
      .set({ revokedAt: new Date() })
      .where(eq(entitlementGrant.id, g?.id ?? ""));
    await save(other.userId, other.overlayId, (c) => ({
      creator: { ...(c ?? custom), secondaryAccent: "#000000", numberScale: 1.25 },
    }));
    expect((await stored(other.overlayId)).config.creator).toEqual(custom);
  });

  it("public OBS payload uses the OWNER's entitlements and leaks nothing for Free owners", async () => {
    const free = await owner();
    // Simulate a Free owner with a stored block (e.g. after a downgrade).
    await db
      .update(overlay)
      .set({ config: { ...(await stored(free.overlayId)).config, creator: custom } })
      .where(eq(overlay.id, free.overlayId));
    const freeView = await stored(free.overlayId);
    const freePayload = await loadOverlayPayload(freeView.publicToken);
    expect(freePayload?.payload.config.creator).toBeUndefined();
    expect(JSON.stringify(freePayload?.payload)).not.toContain("#ffb000");
    expect(JSON.stringify(freePayload?.payload)).not.toMatch(
      /creator_beta|advancedCustomization|plan/,
    );

    const creator = await owner();
    await grant(creator.userId, new Date(Date.now() + DAY));
    await save(creator.userId, creator.overlayId, () => ({ creator: custom }));
    const view = await stored(creator.overlayId);
    const payload = await loadOverlayPayload(view.publicToken);
    expect(payload?.payload.config.creator).toEqual(custom);
    // Another account's entitlements never affect this overlay.
    expect((await resolveEffectiveOverlayConfig(db, freeView)).creator).toBeUndefined();
  });
});
