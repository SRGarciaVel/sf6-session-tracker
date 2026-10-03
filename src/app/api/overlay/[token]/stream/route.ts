import type { OverlayConfig } from "@/domain/overlay/config";
import { toPublicLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import { getDb } from "@/server/db/client";
import { logger } from "@/server/logger";
import {
  NO_STORE_HEADERS,
  limitOverlayRequest,
  loadOverlayPayload,
} from "@/server/overlays/public";
import {
  getOverlayById,
  heartbeatConnection,
  registerConnection,
  removeConnection,
} from "@/server/overlays/service";
import { publishEvent } from "@/server/realtime/events";
import { INSTANCE_ID, getHub } from "@/server/realtime/hub";
import { sseResponse } from "@/server/realtime/sse";
import { getClientIp } from "@/server/security/client-ip";

export const dynamic = "force-dynamic";

const PING_MS = 15_000;
const log = logger.child({ component: "sse" });

/**
 * OBS overlay event stream. The first event is always the full current state; every later
 * `state` event is also a full replacement, never a delta.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/overlay/[token]/stream">) {
  const limit = limitOverlayRequest(getClientIp(request.headers), "stream");
  if (!limit.ok) {
    return new Response("rate limited", {
      status: 429,
      headers: { ...NO_STORE_HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  const { token } = await ctx.params;
  const initial = await loadOverlayPayload(token);
  if (!initial) return new Response("not found", { status: 404, headers: NO_STORE_HEADERS });

  const db = getDb();
  const hub = getHub();
  await hub.ensureListening();
  const { overlay } = initial;

  return sseResponse(request.signal, async (sse) => {
    let config: OverlayConfig = initial.payload.config;
    let live: PlayerLiveState = initial.payload.live;
    const sendState = () => sse.send("state", { config, live });
    sendState();

    const unsubscribe = hub.subscribe(overlay.playerId, (message) => {
      if (message.type === "live") {
        live = toPublicLiveState(message.live);
        sendState();
      } else if (
        message.type === "overlay" &&
        (message.overlayId === overlay.id || message.overlayId === "*")
      ) {
        void getOverlayById(db, overlay.id).then((fresh) => {
          if (!fresh || fresh.publicToken !== token) {
            // Deleted or URL rotated: this token is no longer valid.
            sse.send("revoked", {});
            sse.close();
            return;
          }
          config = fresh.config;
          sendState();
        });
      }
    });

    const connectionId = await registerConnection(db, overlay.id, INSTANCE_ID);
    await publishEvent(db, { kind: "presence", playerId: overlay.playerId });
    log.info("sse.connect", { overlayId: overlay.id, subscribers: hub.subscriberCount() });

    let ticks = 0;
    const ping = setInterval(() => {
      sse.send("ping", { t: Date.now() });
      if (++ticks % 2 === 0) {
        void heartbeatConnection(db, connectionId).catch(() => undefined);
      }
    }, PING_MS);

    return async () => {
      clearInterval(ping);
      unsubscribe();
      await removeConnection(db, connectionId).catch(() => undefined);
      await publishEvent(db, { kind: "presence", playerId: overlay.playerId }).catch(
        () => undefined,
      );
      log.info("sse.disconnect", { overlayId: overlay.id, subscribers: hub.subscriberCount() });
    };
  });
}
