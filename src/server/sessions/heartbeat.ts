/**
 * Session heartbeat: the dashboard pings it while a session is active so a single free web
 * service (TRACKER_RUNTIME_MODE=embedded) receives legitimate inbound traffic and is not spun
 * down mid-session. It is a READ-ONLY presence check: no rows written for the session, no stats
 * touched, no provider (Capcom) calls. The only write on the path is the shared rate-limit
 * bucket (one upserted row per user, expired rows purged).
 */
import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "@/server/db/client";
import { gameSession, sf6Player } from "@/server/db/schema";

export type HeartbeatResult = "active" | "no_active_session";

/** Does this account have an ACTIVE game session? Scoped by user id (no IDOR surface). */
export async function checkSessionHeartbeat(
  db: DbExecutor,
  userId: string,
): Promise<HeartbeatResult> {
  const [row] = await db
    .select({ id: gameSession.id })
    .from(gameSession)
    .innerJoin(sf6Player, eq(sf6Player.id, gameSession.playerId))
    .where(and(eq(sf6Player.userId, userId), eq(gameSession.status, "active")))
    .limit(1);
  return row ? "active" : "no_active_session";
}

/**
 * Same-origin guard for cookie-authenticated POSTs to route handlers (they don't get Next's
 * Server Action origin check). Browsers always send Origin on POST fetches.
 */
export function isSameOrigin(request: Request, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
