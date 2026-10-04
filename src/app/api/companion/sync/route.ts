import { companionSyncRequestSchema } from "@sf6/capcom-core";
import { applyCompanionSync } from "@/server/companion/service";
import {
  json,
  limitDevice,
  preflight,
  readJson,
  requireDevice,
  tooMany,
} from "@/server/companion/http";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const STATUS = {
  cfn_mismatch: 409,
  cfn_owned_by_other: 409,
  profile_cfn_mismatch: 422,
  invalid_timestamp: 422,
} as const;

/** Normalized observations from the companion → validation → snapshot → ingestion. */
export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return auth.response;
  const limit = limitDevice(auth.device.id, "sync");
  if (!limit.ok) return tooMany(limit.retryAfterSeconds);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = companionSyncRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    // Issue paths only — never the payload itself.
    logger.warn("companion_sync_rejected", {
      deviceId: auth.device.id,
      reason: "invalid_payload",
      issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".") || "(root)"),
    });
    return json({ error: "invalid_payload" }, 422);
  }
  const result = await applyCompanionSync(getDb(), auth.device, parsed.data);
  if (!result.ok) return json({ error: result.reason }, STATUS[result.reason]);
  return json({ inserted: result.inserted, duplicates: result.duplicates, state: result.state });
}
