/**
 * Web-side realtime hub. One LISTEN connection per web instance; fans events out to every SSE
 * subscriber of the affected player.
 *
 * For a "player" event the live snapshot is built ONCE (debounced) and shared by all of that
 * player's subscribers — 10 open overlays cost one set of DB reads, and zero CFN requests.
 */
import { randomBytes } from "node:crypto";
import type { PlayerLiveState } from "@/domain/overlay/state";
import { getDb, getSql } from "@/server/db/client";
import { logger } from "@/server/logger";
import { buildPlayerLiveState } from "@/server/sessions/service";
import { EVENTS_CHANNEL, parseEvent } from "./events";

export type HubMessage =
  | { type: "live"; live: PlayerLiveState }
  /** Overlay config/token changed. overlayId "*" = re-check all (after a missed-event window). */
  | { type: "overlay"; overlayId: string }
  | { type: "presence" };

export type HubListener = (message: HubMessage) => void;

const DEBOUNCE_MS = 120;
const log = logger.child({ component: "realtime-hub" });

/** Identifies this web process in overlay_connection rows. */
export const INSTANCE_ID = `web-${process.pid}-${randomBytes(3).toString("hex")}`;

class RealtimeHub {
  private readonly listeners = new Map<string, Set<HubListener>>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private listening: Promise<void> | null = null;
  private listenCount = 0;

  async ensureListening(): Promise<void> {
    this.listening ??= getSql()
      .listen(
        EVENTS_CHANNEL,
        (payload) => this.dispatch(payload),
        () => this.onListen(),
      )
      .then(() => undefined)
      .catch((err: unknown) => {
        this.listening = null;
        throw err;
      });
    return this.listening;
  }

  subscribe(playerId: string, listener: HubListener): () => void {
    let set = this.listeners.get(playerId);
    if (!set) {
      set = new Set();
      this.listeners.set(playerId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(playerId);
      current?.delete(listener);
      if (current && current.size === 0) this.listeners.delete(playerId);
    };
  }

  subscriberCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  /** Called on every (re)connection of the LISTEN socket. */
  private onListen(): void {
    this.listenCount++;
    if (this.listenCount === 1) {
      log.info("hub.listening", { instanceId: INSTANCE_ID });
      return;
    }
    // Reconnected: notifications sent while disconnected are lost → resync everyone.
    log.warn("hub.relistened_resync", { players: this.listeners.size });
    for (const playerId of this.listeners.keys()) {
      this.emit(playerId, { type: "overlay", overlayId: "*" });
      this.scheduleLive(playerId);
    }
  }

  private dispatch(payload: string): void {
    const event = parseEvent(payload);
    if (!event || !this.listeners.has(event.playerId)) return;
    switch (event.kind) {
      case "player":
        this.scheduleLive(event.playerId);
        break;
      case "overlay":
        this.emit(event.playerId, { type: "overlay", overlayId: event.overlayId });
        break;
      case "presence":
        this.emit(event.playerId, { type: "presence" });
        break;
    }
  }

  private scheduleLive(playerId: string): void {
    if (this.pending.has(playerId)) return;
    this.pending.set(
      playerId,
      setTimeout(() => {
        this.pending.delete(playerId);
        void this.publishLive(playerId);
      }, DEBOUNCE_MS),
    );
  }

  private async publishLive(playerId: string): Promise<void> {
    if (!this.listeners.has(playerId)) return;
    try {
      const live = await buildPlayerLiveState(getDb(), playerId);
      if (live) this.emit(playerId, { type: "live", live });
    } catch (err) {
      // DB hiccup: clients keep their last state; the next event or reconnect resyncs.
      log.error("hub.build_failed", { playerId, error: err });
    }
  }

  private emit(playerId: string, message: HubMessage): void {
    for (const listener of this.listeners.get(playerId) ?? []) {
      try {
        listener(message);
      } catch (err) {
        log.error("hub.listener_failed", { playerId, error: err });
      }
    }
  }
}

interface HubGlobal {
  __sf6Hub?: RealtimeHub;
}
const g = globalThis as HubGlobal;

export function getHub(): RealtimeHub {
  g.__sf6Hub ??= new RealtimeHub();
  return g.__sf6Hub;
}
