import { getAuth } from "@/server/auth/auth";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { findPlayerByUserId } from "@/server/players/service";
import { getHub } from "@/server/realtime/hub";
import { SSE_LIMITS, acquireSseSlots } from "@/server/realtime/connection-limits";
import { sseResponse } from "@/server/realtime/sse";

export const dynamic = "force-dynamic";

const PING_MS = 15_000;
/** Tracker health ("last check 12s ago") changes without events; refresh it periodically. */
const REFRESH_MS = 30_000;

/** Authenticated dashboard stream: session stats + tracker health + overlay connections. */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response("unauthorized", { status: 401 });

  const db = getDb();
  const player = await findPlayerByUserId(db, session.user.id);
  if (!player) return new Response("no player", { status: 404 });

  const release = acquireSseSlots([[`user:${session.user.id}`, SSE_LIMITS.perUser]]);
  if (!release) {
    return new Response("too many open streams", {
      status: 429,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }

  // Released when the stream ends, the client aborts, or setup fails (idempotent).
  request.signal.addEventListener("abort", release, { once: true });
  const hub = getHub();
  try {
    await hub.ensureListening();
  } catch (err) {
    release();
    throw err;
  }

  return sseResponse(request.signal, async (sse) => {
    const push = async (live?: Parameters<typeof buildDashboardLiveState>[2]) => {
      const state = await buildDashboardLiveState(db, player.id, live).catch(() => null);
      if (state) sse.send("dashboard", state);
    };
    await push();

    const unsubscribe = hub.subscribe(player.id, (message) => {
      if (message.type === "live") void push(message.live);
      else if (message.type === "presence") void push();
    });
    const ping = setInterval(() => sse.send("ping", { t: Date.now() }), PING_MS);
    const refresh = setInterval(() => void push(), REFRESH_MS);

    return () => {
      release();
      clearInterval(ping);
      clearInterval(refresh);
      unsubscribe();
    };
  });
}
