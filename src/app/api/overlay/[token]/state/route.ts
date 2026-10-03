import { getClientIp } from "@/server/security/client-ip";
import {
  NO_STORE_HEADERS,
  limitOverlayRequest,
  loadOverlayPayload,
} from "@/server/overlays/public";

export const dynamic = "force-dynamic";

/** Authoritative overlay state (used on reconnect and as the polling fallback). */
export async function GET(request: Request, ctx: RouteContext<"/api/overlay/[token]/state">) {
  const limit = limitOverlayRequest(getClientIp(request.headers), "state");
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }
  const { token } = await ctx.params;
  const result = await loadOverlayPayload(token);
  if (!result) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE_HEADERS });
  }
  return Response.json(result.payload, { headers: NO_STORE_HEADERS });
}
