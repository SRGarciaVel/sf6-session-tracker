import { buildCompanionState } from "@/server/companion/service";
import { json, limitDevice, preflight, requireDevice, tooMany } from "@/server/companion/http";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** What the companion needs to decide its next step (active session, known ids, cadence). */
export async function GET(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return auth.response;
  const limit = await limitDevice(auth.device.id, "state");
  if (!limit.ok) return tooMany(limit.retryAfterSeconds);
  return json(await buildCompanionState(getDb(), auth.device.userId));
}
