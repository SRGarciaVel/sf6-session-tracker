/**
 * Phase 4.5 Creator Overlay Suite against a real Postgres (TEST_DATABASE_URL): premium theme
 * lifecycle (save → expire → Free fallback → Free edit → renew), crafted Free requests, public
 * payload hygiene, and Creator presets (entitlements, ownership/IDOR, limits, downgrade).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { OverlayConfig } from "@/domain/overlay/config";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;
process.env.LOG_LEVEL = "error";

const { getDb, closeDb } = await import("@/server/db/client");
const { authUser, creatorOverlayPreset, entitlementGrant, overlay } =
  await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const { listOverlays, updateOverlay, getOverlayById } = await import("@/server/overlays/service");
const { prepareOverlayConfigForSave } = await import("@/server/overlays/effective");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const presets = await import("@/server/overlays/presets");
const { DEFAULT_THEME_VARIANTS } = await import("@/domain/overlay/variants");
const { PRESETS_PER_ACCOUNT_MAX } = await import("@/domain/overlay/presets");
const { DEFAULT_CREATOR_CUSTOMIZATION } = await import("@/domain/overlay/creator");

const DAY = 86_400_000;

describe.skipIf(!TEST_DB)("Creator Overlay Suite (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  async function owner() {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "CS", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    const [ov] = await listOverlays(db, player.id);
    if (!ov) throw new Error("no overlay");
    return { userId, overlayId: ov.id };
  }
  const grant = async (userId: string, days = 90) => {
    const [g] = await db
      .insert(entitlementGrant)
      .values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + days * DAY),
      })
      .returning({ id: entitlementGrant.id });
    return g?.id ?? "";
  };
  const revoke = (grantId: string) =>
    db
      .update(entitlementGrant)
      .set({ revokedAt: new Date() })
      .where(eq(entitlementGrant.id, grantId));
  const stored = async (overlayId: string) => {
    const view = await getOverlayById(db, overlayId);
    if (!view) throw new Error("gone");
    return view;
  };
  /** The real save path (owner entitlements + merge), as saveOverlayAction does. */
  async function save(userId: string, overlayId: string, edit: Partial<OverlayConfig>) {
    const view = await stored(overlayId);
    const merged = await prepareOverlayConfigForSave(db, {
      userId,
      stored: view.config,
      incoming: { ...view.config, ...edit },
    });
    await updateOverlay(db, view, { config: merged });
  }
  const payloadOf = async (overlayId: string) => {
    const p = await loadOverlayPayload((await stored(overlayId)).publicToken);
    if (!p) throw new Error("no payload");
    return p.payload;
  };
  const variants = {
    ...DEFAULT_THEME_VARIANTS,
    "rank-card": { ...DEFAULT_THEME_VARIANTS["rank-card"], glow: "strong" as const },
  };

  it("CRITICAL lifecycle: premium theme → expire → Free fallback → Free edits title → renew → restored", async () => {
    const { userId, overlayId } = await owner();
    const g = await grant(userId);

    await save(userId, overlayId, { theme: "rank-card", preset: "detailed", variants });
    let p = await payloadOf(overlayId);
    expect(p.config.theme).toBe("rank-card");
    expect(p.config.variants?.["rank-card"].glow).toBe("strong");

    await revoke(g);
    p = await payloadOf(overlayId);
    expect(p.config.theme).toBe("competitive"); // registered fallback
    expect(p.config.variants).toBeUndefined();
    expect((await stored(overlayId)).config.theme).toBe("rank-card"); // DB untouched

    // The Free editor sends back what it loaded (stored theme) plus a title change.
    await save(userId, overlayId, { title: "FREE EDIT" });
    const after = (await stored(overlayId)).config;
    expect(after.title).toBe("FREE EDIT");
    expect(after.theme).toBe("rank-card");
    expect(after.variants).toEqual(variants);
    expect((await payloadOf(overlayId)).config.title).toBe("FREE EDIT");

    await grant(userId);
    p = await payloadOf(overlayId);
    expect(p.config.theme).toBe("rank-card");
    expect(p.config.variants).toEqual(variants);
    expect(p.config.title).toBe("FREE EDIT");
  });

  it("crafted Free request cannot install a never-stored premium theme or variants", async () => {
    const { userId, overlayId } = await owner();
    const before = (await stored(overlayId)).config;
    await save(userId, overlayId, { theme: "prestige", variants, preset: "detailed" });
    const after = (await stored(overlayId)).config;
    expect(after.theme).toBe(before.theme);
    expect(after.variants).toBeUndefined();
    expect((await payloadOf(overlayId)).config.theme).toBe(before.theme);
  });

  it("public payload: owner entitlements only, no plan or entitlement fields", async () => {
    const free = await owner();
    await db
      .update(overlay)
      .set({ config: { ...(await stored(free.overlayId)).config, theme: "broadcast", variants } })
      .where(eq(overlay.id, free.overlayId));
    const json = JSON.stringify(await payloadOf(free.overlayId));
    expect(json).toContain('"theme":"minimal"');
    expect(json).not.toMatch(
      /broadcast|rank-card|variants|creator_beta|premiumThemes|creatorPresets|plan/,
    );
  });

  it("presets: Free cannot create or apply; Creator can create, rename, duplicate, update, apply, delete", async () => {
    const free = await owner();
    const freeCfg = (await stored(free.overlayId)).config;
    expect(
      await presets.createPreset(db, { userId: free.userId, name: "x", config: freeCfg }),
    ).toEqual({
      ok: false,
      error: "not_entitled",
    });

    const c = await owner();
    await grant(c.userId);
    const cfg: OverlayConfig = {
      ...(await stored(c.overlayId)).config,
      theme: "prestige",
      preset: "detailed",
      accentColor: "#f5c451",
      title: "MY PRIVATE TITLE",
      ratingCharacterKey: "ryu",
      variants,
    };
    const created = await presets.createPreset(db, { userId: c.userId, name: "Gold", config: cfg });
    if (!created.ok) throw new Error(created.error);
    // Appearance only: no title text, language or rating character.
    const [row] = await db
      .select()
      .from(creatorOverlayPreset)
      .where(eq(creatorOverlayPreset.id, created.value.id));
    const raw = JSON.stringify(row?.config);
    expect(raw).not.toContain("MY PRIVATE TITLE");
    expect(raw).not.toMatch(/"title"|"locale"|"ratingCharacterKey"|"version"/);
    expect(row?.config).toMatchObject({ theme: "prestige", accentColor: "#f5c451" });

    expect(
      await presets.renamePreset(db, {
        userId: c.userId,
        presetId: created.value.id,
        name: "Gold 2",
      }),
    ).toEqual({ ok: true, value: null });
    const dup = await presets.duplicatePreset(db, {
      userId: c.userId,
      presetId: created.value.id,
      name: "Copy",
    });
    expect(dup.ok).toBe(true);
    expect(
      (
        await presets.updatePresetFromConfig(db, {
          userId: c.userId,
          presetId: created.value.id,
          config: { ...cfg, accentColor: "#ff0000" },
        })
      ).ok,
    ).toBe(true);

    // Apply to an overlay currently on a Free theme: appearance replaced, title kept.
    await save(c.userId, c.overlayId, { theme: "minimal", title: "KEEP ME" });
    const applied = await presets.applyPresetToOverlay(db, {
      userId: c.userId,
      presetId: created.value.id,
      overlayId: c.overlayId,
    });
    if (!applied.ok) throw new Error(applied.error);
    const after = (await stored(c.overlayId)).config;
    expect(after).toMatchObject({ theme: "prestige", accentColor: "#ff0000", title: "KEEP ME" });
    expect((await payloadOf(c.overlayId)).config.theme).toBe("prestige");

    expect(
      (await presets.deletePreset(db, { userId: c.userId, presetId: created.value.id })).ok,
    ).toBe(true);
    expect((await presets.listPresets(db, c.userId)).map((p) => p.name)).toEqual(["Copy"]);
  });

  it("IDOR: another account's preset or overlay behaves as not found and is never changed", async () => {
    const a = await owner();
    const b = await owner();
    await grant(a.userId);
    await grant(b.userId);
    const aCfg = (await stored(a.overlayId)).config;
    const pa = await presets.createPreset(db, { userId: a.userId, name: "A", config: aCfg });
    const pb = await presets.createPreset(db, {
      userId: b.userId,
      name: "B",
      config: { ...aCfg, theme: "broadcast" },
    });
    if (!pa.ok || !pb.ok) throw new Error("setup");
    const nf = { ok: false, error: "not_found" };

    expect(
      await presets.renamePreset(db, { userId: b.userId, presetId: pa.value.id, name: "pwn" }),
    ).toEqual(nf);
    expect(
      await presets.updatePresetFromConfig(db, {
        userId: b.userId,
        presetId: pa.value.id,
        config: aCfg,
      }),
    ).toEqual(nf);
    expect(
      await presets.duplicatePreset(db, { userId: b.userId, presetId: pa.value.id, name: "steal" }),
    ).toEqual(nf);
    expect(await presets.deletePreset(db, { userId: b.userId, presetId: pa.value.id })).toEqual(nf);
    // B's preset onto A's overlay, and A's preset onto B's own overlay.
    expect(
      await presets.applyPresetToOverlay(db, {
        userId: b.userId,
        presetId: pb.value.id,
        overlayId: a.overlayId,
      }),
    ).toEqual(nf);
    expect(
      await presets.applyPresetToOverlay(db, {
        userId: b.userId,
        presetId: pa.value.id,
        overlayId: b.overlayId,
      }),
    ).toEqual(nf);
    // Unknown ids too (no existence oracle).
    expect(
      await presets.renamePreset(db, { userId: b.userId, presetId: randomUUID(), name: "x" }),
    ).toEqual(nf);

    expect((await presets.listPresets(db, a.userId)).map((p) => p.name)).toEqual(["A"]);
    expect((await presets.listPresets(db, b.userId)).map((p) => p.name)).toEqual(["B"]);
    expect((await stored(a.overlayId)).config).toEqual(aCfg);
  });

  it("downgrade keeps presets (listed, deletable) but blocks use; renew restores", async () => {
    const { userId, overlayId } = await owner();
    const g = await grant(userId);
    const cfg = (await stored(overlayId)).config;
    const p1 = await presets.createPreset(db, {
      userId,
      name: "Keep",
      config: { ...cfg, theme: "rank-card" },
    });
    const p2 = await presets.createPreset(db, { userId, name: "Drop", config: cfg });
    if (!p1.ok || !p2.ok) throw new Error("setup");
    await revoke(g);

    expect((await presets.listPresets(db, userId)).length).toBe(2);
    const blocked = { ok: false, error: "not_entitled" };
    expect(
      await presets.applyPresetToOverlay(db, { userId, presetId: p1.value.id, overlayId }),
    ).toEqual(blocked);
    expect(await presets.renamePreset(db, { userId, presetId: p1.value.id, name: "n" })).toEqual(
      blocked,
    );
    expect(await presets.duplicatePreset(db, { userId, presetId: p1.value.id, name: "n" })).toEqual(
      blocked,
    );
    expect(
      await presets.updatePresetFromConfig(db, { userId, presetId: p1.value.id, config: cfg }),
    ).toEqual(blocked);
    expect((await presets.deletePreset(db, { userId, presetId: p2.value.id })).ok).toBe(true);
    expect((await stored(overlayId)).config.theme).toBe(cfg.theme);

    await grant(userId);
    expect(
      (await presets.applyPresetToOverlay(db, { userId, presetId: p1.value.id, overlayId })).ok,
    ).toBe(true);
    expect((await payloadOf(overlayId)).config.theme).toBe("rank-card");
  });

  it("technical limit holds under concurrent creates", async () => {
    const { userId, overlayId } = await owner();
    await grant(userId);
    const cfg = (await stored(overlayId)).config;
    const results = await Promise.all(
      Array.from({ length: PRESETS_PER_ACCOUNT_MAX + 5 }, (_, i) =>
        presets.createPreset(db, { userId, name: `P${i}`, config: cfg }),
      ),
    );
    expect(results.filter((r) => r.ok).length).toBe(PRESETS_PER_ACCOUNT_MAX);
    expect(results.filter((r) => !r.ok && r.error === "limit").length).toBe(5);
    expect((await presets.listPresets(db, userId)).length).toBe(PRESETS_PER_ACCOUNT_MAX);
  });

  it("DB constraints reject oversized / non-object configs and bad names; malformed rows are never applied", async () => {
    const { userId, overlayId } = await owner();
    await grant(userId);
    const insert = (name: string, config: unknown) =>
      db.insert(creatorOverlayPreset).values({ userId, name, config });
    await expect(insert("big", { pad: "x".repeat(9000) })).rejects.toThrow();
    await expect(insert("arr", [1, 2])).rejects.toThrow();
    await expect(insert("", {})).rejects.toThrow();
    await expect(insert("n".repeat(41), {})).rejects.toThrow();

    const [bad] = await db
      .insert(creatorOverlayPreset)
      .values({ userId, name: "Broken", config: { theme: "rank-card", customCss: "body{}" } })
      .returning();
    const listed = await presets.listPresets(db, userId);
    expect(listed.find((p) => p.id === bad?.id)?.appearance).toBeNull();
    expect(
      await presets.applyPresetToOverlay(db, { userId, presetId: bad?.id ?? "", overlayId }),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("presets are deleted with the account (FK cascade)", async () => {
    const { userId, overlayId } = await owner();
    await grant(userId);
    await presets.createPreset(db, {
      userId,
      name: "Bye",
      config: (await stored(overlayId)).config,
    });
    await db.delete(authUser).where(eq(authUser.id, userId));
    expect(
      await db.select().from(creatorOverlayPreset).where(eq(creatorOverlayPreset.userId, userId)),
    ).toEqual([]);
  });
});

describe.skipIf(!TEST_DB)("Phase 5.0: Creator motion lifecycle (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const motion = {
    updateStyle: "impact" as const,
    intensity: "strong" as const,
    resultEmphasis: true,
    accentMotion: "sweep" as const,
    rankMotion: "emphasized" as const,
  };

  it("save → expire (no motion in OBS) → Free edit keeps it → renew → restored; presets carry it", async () => {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "M", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    const [ov] = await listOverlays(db, player.id);
    if (!ov) throw new Error("no overlay");
    const [g] = await db
      .insert(entitlementGrant)
      .values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      })
      .returning({ id: entitlementGrant.id });
    const current = async () => {
      const v = await getOverlayById(db, ov.id);
      if (!v) throw new Error("gone");
      return v;
    };
    const save = async (edit: Partial<OverlayConfig>) => {
      const v = await current();
      const merged = await prepareOverlayConfigForSave(db, {
        userId,
        stored: v.config,
        incoming: { ...v.config, ...edit },
      });
      await updateOverlay(db, v, { config: merged });
    };
    const payload = async () => (await loadOverlayPayload((await current()).publicToken))?.payload;

    await save({ creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion } });
    expect((await payload())?.config.creator?.motion).toEqual(motion);
    const preset = await presets.createPreset(db, {
      userId,
      name: "Motion",
      config: (await current()).config,
    });
    if (!preset.ok) throw new Error(preset.error);
    expect(preset.value.appearance?.creator?.motion).toEqual(motion);

    await db
      .update(entitlementGrant)
      .set({ revokedAt: new Date() })
      .where(eq(entitlementGrant.id, g?.id ?? ""));
    const free = await payload();
    expect(free?.config.creator?.motion).toBeUndefined();
    expect(JSON.stringify(free)).not.toMatch(/motionEffects|impact|creator_beta/);

    await save({ title: "FREE EDIT", creator: undefined });
    expect((await current()).config.title).toBe("FREE EDIT");
    expect((await current()).config.creator?.motion).toEqual(motion);
    // A crafted Free change is ignored.
    await save({
      creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion: { ...motion, intensity: "subtle" } },
    });
    expect((await current()).config.creator?.motion).toEqual(motion);
    expect(
      await presets.applyPresetToOverlay(db, {
        userId,
        presetId: preset.value.id,
        overlayId: ov.id,
      }),
    ).toEqual({ ok: false, error: "not_entitled" });

    await db.insert(entitlementGrant).values({
      userId,
      plan: "creator_beta",
      source: "operator",
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    });
    expect((await payload())?.config.creator?.motion).toEqual(motion);
  });
});

describe.skipIf(!TEST_DB)("Phase 5.2: character rotation lifecycle (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);
  const rotation = {
    enabled: true,
    intervalSeconds: 15 as const,
    transition: "slide" as const,
    prioritizeLatestMatch: true,
    prioritySeconds: 30 as const,
    order: "mostPlayed" as const,
  };

  it("Creator enables → OBS gets it → expiry drops it (stored kept) → Free edit/crafted ignored → renew restores → revocation drops; presets carry it", async () => {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "R", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(8_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    const [ov] = await listOverlays(db, player.id);
    if (!ov) throw new Error("no overlay");
    const current = async () => {
      const v = await getOverlayById(db, ov.id);
      if (!v) throw new Error("gone");
      return v;
    };
    const save = async (edit: Partial<OverlayConfig>) => {
      const v = await current();
      const merged = await prepareOverlayConfigForSave(db, {
        userId,
        stored: v.config,
        incoming: { ...v.config, ...edit },
      });
      await updateOverlay(db, v, { config: merged });
    };
    const payload = async () => (await loadOverlayPayload((await current()).publicToken))?.payload;
    const withRotation = (r: typeof rotation) => ({
      creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, characterRotation: r },
    });

    // Free (no grant) cannot enable it, even with a crafted request.
    await save(withRotation(rotation));
    expect((await current()).config.creator?.characterRotation).toBeUndefined();
    expect((await payload())?.config.creator?.characterRotation).toBeUndefined();

    const [g] = await db
      .insert(entitlementGrant)
      .values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      })
      .returning({ id: entitlementGrant.id });
    await save(withRotation(rotation));
    expect((await payload())?.config.creator?.characterRotation).toEqual(rotation);
    const preset = await presets.createPreset(db, {
      userId,
      name: "Rotation",
      config: (await current()).config,
    });
    if (!preset.ok) throw new Error(preset.error);
    expect(preset.value.appearance?.creator?.characterRotation).toEqual(rotation);
    expect(preset.value.appearance).not.toHaveProperty("statsScope");

    // Expiry: the public overlay stops rotating; nothing is deleted.
    await db
      .update(entitlementGrant)
      .set({
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      })
      .where(eq(entitlementGrant.id, g?.id ?? ""));
    const expired = await payload();
    expect(expired?.config.creator?.characterRotation).toBeUndefined();
    expect(JSON.stringify(expired)).not.toMatch(/characterRotation|creator_beta/);
    await save({ title: "FREE EDIT", creator: undefined });
    await save(withRotation({ ...rotation, intervalSeconds: 5 as never, enabled: false }));
    expect((await current()).config).toMatchObject({ title: "FREE EDIT" });
    expect((await current()).config.creator?.characterRotation).toEqual(rotation);

    // Renewal restores it exactly.
    const [g2] = await db
      .insert(entitlementGrant)
      .values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      })
      .returning({ id: entitlementGrant.id });
    expect((await payload())?.config.creator?.characterRotation).toEqual(rotation);

    // Revocation is immediate.
    await db
      .update(entitlementGrant)
      .set({ revokedAt: new Date() })
      .where(eq(entitlementGrant.id, g2?.id ?? ""));
    expect((await payload())?.config.creator?.characterRotation).toBeUndefined();
    expect((await current()).config.creator?.characterRotation).toEqual(rotation);
  });
});

afterAll(async () => {
  if (TEST_DB) await closeDb();
});
