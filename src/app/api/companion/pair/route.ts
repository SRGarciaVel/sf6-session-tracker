import { companionPairRequestSchema } from "@sf6/capcom-core";
import { buildCompanionState, exchangePairingCode } from "@/server/companion/service";
import { json, preflight, readJson, tooMany } from "@/server/companion/http";
import { getDb } from "@/server/db/client";
import { getClientIp } from "@/server/security/client-ip";
import { rateLimit } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Exchange a one-time pairing code (from the dashboard) for a companion device token. */
export async function POST(request: Request) {
  const limit = await rateLimit(`companion-pair:${getClientIp(request.headers)}`, 10, 60_000, {
    failClosed: true, // brute-force target
  });
  if (!limit.ok) return tooMany(limit.retryAfterSeconds);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = companionPairRequestSchema.safeParse(body.body);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);

  const db = getDb();
  const paired = await exchangePairingCode(db, parsed.data.code, parsed.data.deviceName);
  if (!paired) return json({ error: "invalid_or_expired_code" }, 400);
  return json({
    deviceId: paired.device.id,
    deviceToken: paired.token,
    state: await buildCompanionState(db, paired.device.userId),
  });
}
