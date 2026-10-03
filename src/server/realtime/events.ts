/**
 * Realtime event bus over Postgres LISTEN/NOTIFY.
 *
 * Events are *invalidation signals only* ("player X changed"). Subscribers react by reading the
 * authoritative state from the database — events never carry increments.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/server/db/client";

export const EVENTS_CHANNEL = "sf6_events";

const eventSchema = z.discriminatedUnion("kind", [
  /** Session / match / rating / tracker state changed. */
  z.object({ kind: z.literal("player"), playerId: z.string().uuid() }),
  /** Overlay config or token changed. */
  z.object({ kind: z.literal("overlay"), playerId: z.string().uuid(), overlayId: z.string().uuid() }),
  /** Overlay connection count changed (dashboard only). */
  z.object({ kind: z.literal("presence"), playerId: z.string().uuid() }),
]);

export type RealtimeEvent = z.infer<typeof eventSchema>;

/**
 * Publish an event. When `executor` is a transaction, Postgres delivers the notification only
 * after COMMIT (and drops it on ROLLBACK), so subscribers never see uncommitted state.
 */
export async function publishEvent(executor: DbExecutor, event: RealtimeEvent): Promise<void> {
  await executor.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}

export function parseEvent(payload: string): RealtimeEvent | null {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
