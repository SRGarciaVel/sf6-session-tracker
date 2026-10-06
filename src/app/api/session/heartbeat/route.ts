import { getVerifiedSession } from "@/server/auth/verified-session";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { rateLimit } from "@/server/security/rate-limit";
import { checkSessionHeartbeat, isSameOrigin } from "@/server/sessions/heartbeat";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** The dashboard sends one every ~4.5 min; a few tabs/reloads fit comfortably. */
const LIMIT = 6;
const WINDOW_MS = 60_000;

/**
 * Keep-alive for an ACTIVE session (see src/server/sessions/heartbeat.ts). 204 when the
 * signed-in account has an active session; 409 otherwise. Reveals nothing else.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request, getEnv().APP_URL)) {
    return new Response(null, { status: 403, headers: NO_STORE });
  }
  const session = await getVerifiedSession(request.headers);
  if (!session) return new Response(null, { status: 401, headers: NO_STORE });

  const limited = await rateLimit(`heartbeat:user:${session.user.id}`, LIMIT, WINDOW_MS);
  if (!limited.ok) {
    return new Response(null, {
      status: 429,
      headers: { ...NO_STORE, "Retry-After": String(limited.retryAfterSeconds) },
    });
  }

  const result = await checkSessionHeartbeat(getDb(), session.user.id);
  if (result !== "active") {
    return Response.json({ error: "no_active_session" }, { status: 409, headers: NO_STORE });
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
