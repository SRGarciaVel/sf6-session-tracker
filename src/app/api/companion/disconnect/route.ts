import { revokeDevice } from "@/server/companion/service";
import { json, preflight, requireDevice } from "@/server/companion/http";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** The companion revokes its own device token ("Disconnect" in the popup). */
export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (!auth.ok) return auth.response;
  await revokeDevice(getDb(), auth.device.userId, auth.device.id);
  return json({ ok: true });
}
