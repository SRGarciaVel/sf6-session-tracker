import { getAuth } from "@/server/auth/auth";
import { buildDashboardLiveState } from "@/server/dashboard/state";
import { getDb } from "@/server/db/client";
import { findPlayerByUserId } from "@/server/players/service";
import { getHub } from "@/server/realtime/hub";
import { sseResponse } from "@/server/realtime/sse";

export const dynamic = "force-dynamic";

const PING_MS = 15_000;

/** Authenticated dashboard stream: session stats + tracker health + overlay connections. */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return new Response("unauthorized", { status: 401 });

  const db = getDb();
  const player = await findPlayerByUserId(db, session.user.id);
  if (!player) return new Response("no player", { status: 404 });

  const hub = getHub();
  await hub.ensureListening();

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

    return () => {
      clearInterval(ping);
      unsubscribe();
    };
  });
}
