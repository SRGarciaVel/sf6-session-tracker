/**
 * Creator presets (Phase 4.5, docs/creator-presets.md). Server-side rules:
 *  - every query is scoped to the authenticated account (`user_id`): another account's preset
 *    id behaves exactly like a missing one (no IDOR, no existence oracle);
 *  - create / rename / duplicate / update / apply need `overlays.creatorPresets` of the OWNER;
 *    listing and deleting your own presets never do (downgrade keeps them, and data stays yours);
 *  - apply = stored overlay + preset appearance → the normal save rules (owner entitlements)
 *    → persisted; renderers then use the effective config as always.
 */
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { OverlayConfig } from "@/domain/overlay/config";
import {
  PRESETS_PER_ACCOUNT_MAX,
  PRESET_CONFIG_MAX_BYTES,
  appearanceFromConfig,
  applyPresetToConfig,
  parsePresetAppearance,
  type PresetAppearance,
} from "@/domain/overlay/presets";
import type { Database, DbExecutor } from "@/server/db/client";
import { creatorOverlayPreset } from "@/server/db/schema";
import { getEntitlements } from "@/server/entitlements/service";
import { prepareOverlayConfigForSave } from "./effective";
import { getOwnedOverlay, updateOverlay } from "./service";

export interface PresetView {
  id: string;
  name: string;
  /** null = stored value no longer valid (listed, never applied). */
  appearance: PresetAppearance | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PresetError = "not_entitled" | "not_found" | "limit" | "too_large";
export type PresetResult<T> = { ok: true; value: T } | { ok: false; error: PresetError };

const ok = <T>(value: T): PresetResult<T> => ({ ok: true, value });
const err = <T>(error: PresetError): PresetResult<T> => ({ ok: false, error });

function toView(row: typeof creatorOverlayPreset.$inferSelect): PresetView {
  return {
    id: row.id,
    name: row.name,
    appearance: parsePresetAppearance(row.config),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function entitled(db: DbExecutor, userId: string): Promise<boolean> {
  return (await getEntitlements(db, userId)).overlays.creatorPresets;
}

function fits(appearance: PresetAppearance): boolean {
  return Buffer.byteLength(JSON.stringify(appearance), "utf8") <= PRESET_CONFIG_MAX_BYTES;
}

export async function listPresets(db: DbExecutor, userId: string): Promise<PresetView[]> {
  const rows = await db
    .select()
    .from(creatorOverlayPreset)
    .where(eq(creatorOverlayPreset.userId, userId))
    .orderBy(asc(creatorOverlayPreset.createdAt), asc(creatorOverlayPreset.id));
  return rows.map(toView);
}

async function getOwnedPreset(db: DbExecutor, userId: string, presetId: string) {
  const [row] = await db
    .select()
    .from(creatorOverlayPreset)
    .where(and(eq(creatorOverlayPreset.id, presetId), eq(creatorOverlayPreset.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Insert under a per-account advisory lock so concurrent creates can't exceed the limit. */
async function insertPreset(
  db: Database,
  userId: string,
  name: string,
  appearance: PresetAppearance,
): Promise<PresetResult<PresetView>> {
  if (!fits(appearance)) return err("too_large");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sst:preset:${userId}`}))`);
    const [row] = await tx
      .select({ n: count() })
      .from(creatorOverlayPreset)
      .where(eq(creatorOverlayPreset.userId, userId));
    if ((row?.n ?? 0) >= PRESETS_PER_ACCOUNT_MAX) return err<PresetView>("limit");
    const [created] = await tx
      .insert(creatorOverlayPreset)
      .values({ userId, name, config: appearance })
      .returning();
    if (!created) throw new Error("preset insert returned no row");
    return ok(toView(created));
  });
}

export async function createPreset(
  db: Database,
  input: { userId: string; name: string; config: OverlayConfig },
): Promise<PresetResult<PresetView>> {
  if (!(await entitled(db, input.userId))) return err("not_entitled");
  return insertPreset(db, input.userId, input.name, appearanceFromConfig(input.config));
}

export async function duplicatePreset(
  db: Database,
  input: { userId: string; presetId: string; name: string },
): Promise<PresetResult<PresetView>> {
  if (!(await entitled(db, input.userId))) return err("not_entitled");
  const source = await getOwnedPreset(db, input.userId, input.presetId);
  const appearance = source ? parsePresetAppearance(source.config) : null;
  if (!appearance) return err("not_found");
  return insertPreset(db, input.userId, input.name, appearance);
}

export async function renamePreset(
  db: DbExecutor,
  input: { userId: string; presetId: string; name: string },
): Promise<PresetResult<null>> {
  if (!(await entitled(db, input.userId))) return err("not_entitled");
  const updated = await db
    .update(creatorOverlayPreset)
    .set({ name: input.name, updatedAt: sql`now()` })
    .where(
      and(
        eq(creatorOverlayPreset.id, input.presetId),
        eq(creatorOverlayPreset.userId, input.userId),
      ),
    )
    .returning({ id: creatorOverlayPreset.id });
  return updated.length === 1 ? ok(null) : err("not_found");
}

/** Overwrite a preset with the current editor appearance ("update from current"). */
export async function updatePresetFromConfig(
  db: DbExecutor,
  input: { userId: string; presetId: string; config: OverlayConfig },
): Promise<PresetResult<null>> {
  if (!(await entitled(db, input.userId))) return err("not_entitled");
  const appearance = appearanceFromConfig(input.config);
  if (!fits(appearance)) return err("too_large");
  const updated = await db
    .update(creatorOverlayPreset)
    .set({ config: appearance, updatedAt: sql`now()` })
    .where(
      and(
        eq(creatorOverlayPreset.id, input.presetId),
        eq(creatorOverlayPreset.userId, input.userId),
      ),
    )
    .returning({ id: creatorOverlayPreset.id });
  return updated.length === 1 ? ok(null) : err("not_found");
}

/** Deleting your own preset is always allowed (also after a downgrade). */
export async function deletePreset(
  db: DbExecutor,
  input: { userId: string; presetId: string },
): Promise<PresetResult<null>> {
  const deleted = await db
    .delete(creatorOverlayPreset)
    .where(
      and(
        eq(creatorOverlayPreset.id, input.presetId),
        eq(creatorOverlayPreset.userId, input.userId),
      ),
    )
    .returning({ id: creatorOverlayPreset.id });
  return deleted.length === 1 ? ok(null) : err("not_found");
}

/**
 * Apply a preset to one of the owner's overlays and persist it. Both must belong to `userId`.
 * The merged config goes through the same save rules as the editor (owner entitlements), so a
 * preset can never install what the owner isn't entitled to.
 */
export async function applyPresetToOverlay(
  db: DbExecutor,
  input: { userId: string; presetId: string; overlayId: string },
): Promise<PresetResult<OverlayConfig>> {
  if (!(await entitled(db, input.userId))) return err("not_entitled");
  const [preset, target] = await Promise.all([
    getOwnedPreset(db, input.userId, input.presetId),
    getOwnedOverlay(db, input.userId, input.overlayId),
  ]);
  const appearance = preset ? parsePresetAppearance(preset.config) : null;
  if (!appearance || !target) return err("not_found");
  const config = await prepareOverlayConfigForSave(db, {
    userId: input.userId,
    stored: target.config,
    incoming: applyPresetToConfig(target.config, appearance),
  });
  await updateOverlay(db, target, { config });
  return ok(config);
}
