/**
 * Phase 5.4A — overlay kind foundation against a real Postgres (TEST_DATABASE_URL): legacy rows
 * (no kind) are Session overlays and are never rewritten on read, the stored kind is authoritative
 * (forged / unknown kinds), creation writes kind "session", the public payload is unchanged, and
 * Session presets never cross kinds.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
const { authUser, creatorOverlayPreset, entitlementGrant, overlay } =
  await import("@/server/db/schema");
const { upsertPlayerForUser } = await import("@/server/players/service");
const { MockSF6DataProvider } = await import("@/server/sf6/providers/mock");
const service = await import("@/server/overlays/service");
const { prepareOverlayConfigForSave } = await import("@/server/overlays/effective");
const { loadOverlayPayload } = await import("@/server/overlays/public");
const presets = await import("@/server/overlays/presets");
const { generateOverlayToken } = await import("@/server/security/tokens");
const { appearanceFromConfig } = await import("@/domain/overlay/presets");
const { checkOverlayKindEdit } = await import("@/domain/overlay/kind");
const {
  DEFAULT_OVERLAY_CONFIG,
  DEFAULT_SESSION_OVERLAY_CONFIG,
  applyThemeDefaults,
  defaultOverlayConfigForKind,
  overlayConfigSchema,
  sessionConfigOf,
} = await import("@/domain/overlay/config");

describe.skipIf(!TEST_DB)("overlay kind foundation (integration)", () => {
  const db = TEST_DB ? getDb() : (null as never);

  afterAll(async () => {
    await closeDb();
  });

  async function owner(creator = false) {
    const userId = randomUUID();
    await db.insert(authUser).values({ id: userId, name: "OK", email: `${userId}@test.local` });
    const mock = new MockSF6DataProvider(db);
    const cfn = String(6_000_000_000 + Math.floor(Math.random() * 999_999_999));
    const player = await upsertPlayerForUser(db, userId, await mock.getPlayerProfile(cfn));
    if (creator) {
      await db.insert(entitlementGrant).values({
        userId,
        plan: "creator_beta",
        source: "operator",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
    }
    return { userId, playerId: player.id };
  }
  /** A row as stored before 5.4A (no kind), or with a forged kind. */
  async function rawRow(playerId: string, config: Record<string, unknown>) {
    const [row] = await db
      .insert(overlay)
      .values({ playerId, name: "Raw", publicToken: generateOverlayToken(), config })
      .returning();
    return row!;
  }
  const legacyJson = () => {
    const raw: Record<string, unknown> = {
      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "fighter"),
      title: "LEGACY",
    };
    delete raw.kind;
    return raw;
  };
  const storedJson = async (id: string) =>
    (await db.select({ c: overlay.config }).from(overlay).where(eq(overlay.id, id)))[0]!
      .c as Record<string, unknown>;

  it("a legacy row (no kind) is a Session overlay; reading never rewrites it", async () => {
    const { userId, playerId } = await owner();
    const row = await rawRow(playerId, legacyJson());
    const view = await service.getOwnedOverlay(db, userId, row.id);
    expect(view?.storedKind).toBe("session");
    expect(view?.config.kind).toBe("session");
    const config = view && sessionConfigOf(view.config);
    expect(config?.title).toBe("LEGACY");
    expect(config?.theme).toBe("fighter");
    await service.getOverlayByToken(db, row.publicToken);
    await service.listOverlays(db, playerId);
    expect("kind" in (await storedJson(row.id))).toBe(false); // untouched
  });

  it("the public payload of a legacy row equals that of the same config with kind: session", async () => {
    const { playerId } = await owner();
    const legacy = await rawRow(playerId, legacyJson());
    const explicit = await rawRow(playerId, { ...legacyJson(), kind: "session" });
    const a = await loadOverlayPayload(legacy.publicToken);
    const b = await loadOverlayPayload(explicit.publicToken);
    expect(a && b).toBeTruthy();
    expect(a!.payload.config).toEqual(b!.payload.config);
    // Same live state (each payload is built at its own instant: only generatedAt differs).
    expect({ ...a!.payload.live, generatedAt: null }).toEqual({
      ...b!.payload.live,
      generatedAt: null,
    });
    expect(Object.keys(a!.payload).sort()).toEqual(["config", "live"]); // same transport shape
  });

  it("creation writes kind: session with the historical defaults; onboarding overlay too", async () => {
    const { playerId } = await owner();
    const [onboarding] = await service.listOverlays(db, playerId);
    expect((await storedJson(onboarding!.id)).kind).toBe("session");
    expect(defaultOverlayConfigForKind("session")).toBe(DEFAULT_SESSION_OVERLAY_CONFIG);
    const created = await service.createOverlay(db, playerId, "New", {
      ...applyThemeDefaults(DEFAULT_SESSION_OVERLAY_CONFIG, "minimal"),
      locale: "en",
    });
    const json = await storedJson(created.id);
    expect(json.kind).toBe("session");
    expect(json.theme).toBe("minimal");
    expect(created.storedKind).toBe("session");
  });

  it("unknown stored kinds are not editable and render the safe Session default", async () => {
    const { userId, playerId } = await owner();
    const row = await rawRow(playerId, { ...legacyJson(), kind: "evil-widget" });
    const view = (await service.getOwnedOverlay(db, userId, row.id))!;
    expect(view.storedKind).toBeNull();
    expect(view.config).toEqual(DEFAULT_OVERLAY_CONFIG); // lenient parse ⇒ safe default
    for (const incoming of ["session", "rank-progress"] as const) {
      expect(checkOverlayKindEdit(view.storedKind, incoming)).toEqual({
        ok: false,
        error: "unsupported_kind",
      });
    }
    // Public route still answers (no crash), with the Session default; never Rank Progress.
    const p = await loadOverlayPayload(row.publicToken);
    expect(p?.payload.config.kind).toBe("session");
  });

  it("a crafted save claiming another kind is rejected; the stored kind always wins", async () => {
    const { userId, playerId } = await owner(true);
    const [ov] = await service.listOverlays(db, playerId);
    const base = ov!.config;
    const forged = { ...base, kind: "rank-progress" };
    expect(overlayConfigSchema.safeParse(forged).success).toBe(false);
    expect(checkOverlayKindEdit(ov!.storedKind, "rank-progress")).toEqual({
      ok: false,
      error: "kind_mismatch",
    });
    // Even past validation, the merge pins the stored kind.
    const merged = await prepareOverlayConfigForSave(db, {
      userId,
      stored: base,
      incoming: forged as unknown as typeof base,
    });
    expect(merged.kind).toBe("session");
  });

  it("presets: new ones store kind session; duplicate / update keep it; legacy ones still apply", async () => {
    const { userId, playerId } = await owner(true);
    const [ov] = await service.listOverlays(db, playerId);
    const created = await presets.createPreset(db, {
      userId,
      name: "Mine",
      config: applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "broadcast"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const json = async (id: string) =>
      (await db.select().from(creatorOverlayPreset).where(eq(creatorOverlayPreset.id, id)))[0]!
        .config as Record<string, unknown>;
    expect((await json(created.value.id)).kind).toBe("session");
    const dup = await presets.duplicatePreset(db, {
      userId,
      presetId: created.value.id,
      name: "Copy",
    });
    expect(dup.ok && (await json(dup.value.id)).kind).toBe("session");
    await presets.updatePresetFromConfig(db, {
      userId,
      presetId: created.value.id,
      config: applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "minimal"),
    });
    expect((await json(created.value.id)).kind).toBe("session");

    // A legacy preset row (no kind) is a Session preset: still applies to a Session overlay.
    const legacyAppearance: Record<string, unknown> = {
      ...appearanceFromConfig(applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "fighter")),
    };
    delete legacyAppearance.kind;
    const [legacyPreset] = await db
      .insert(creatorOverlayPreset)
      .values({ userId, name: "Old", config: legacyAppearance })
      .returning();
    const applied = await presets.applyPresetToOverlay(db, {
      userId,
      presetId: legacyPreset!.id,
      overlayId: ov!.id,
    });
    expect(applied.ok).toBe(true);
    expect(applied.ok && applied.value.theme).toBe("fighter");
    expect(applied.ok && applied.value.kind).toBe("session");
  });

  it("a Session preset never applies to an overlay of another / unknown kind", async () => {
    const { userId, playerId } = await owner(true);
    const created = await presets.createPreset(db, {
      userId,
      name: "Session look",
      config: DEFAULT_OVERLAY_CONFIG,
    });
    if (!created.ok) throw new Error("preset");
    for (const kind of ["rank-progress", "evil-widget"]) {
      const row = await rawRow(playerId, { ...legacyJson(), kind });
      const before = await storedJson(row.id);
      const res = await presets.applyPresetToOverlay(db, {
        userId,
        presetId: created.value.id,
        overlayId: row.id,
      });
      expect(res).toEqual({ ok: false, error: "incompatible_kind" });
      expect(await storedJson(row.id)).toEqual(before); // nothing written
    }
  });
});
