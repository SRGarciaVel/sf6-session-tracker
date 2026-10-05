/**
 * Client keep-alive while a session is ACTIVE: one POST /api/session/heartbeat every few
 * minutes. In the single-service free beta (TRACKER_RUNTIME_MODE=embedded) this is legitimate
 * inbound traffic that stops the host from spinning the web service (and the tracker inside it)
 * down mid-session; SSE alone does not count as inbound traffic.
 *
 * The controller is framework-free (unit tested with fake timers); useSessionHeartbeat wires it
 * to React. Failures are silent; a 409 (no active session) stops it until the state changes.
 */
import { useEffect, useRef } from "react";

export const HEARTBEAT_INTERVAL_MS = 270_000; // 4.5 min: well under a 15 min idle spin-down

export type HeartbeatOutcome = "ok" | "stop" | "error";

export interface HeartbeatTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface HeartbeatController {
  /** Call whenever the "session is active" flag may have changed. Idempotent. */
  update(active: boolean): void;
  dispose(): void;
  readonly running: boolean;
}

export function createHeartbeatController(options: {
  send: () => Promise<HeartbeatOutcome>;
  intervalMs?: number;
  timers?: HeartbeatTimers;
}): HeartbeatController {
  const timers: HeartbeatTimers = options.timers ?? {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  };
  let handle: unknown = null;
  let disposed = false;
  let inFlight = false;

  const stop = () => {
    if (handle !== null) timers.clearInterval(handle);
    handle = null;
  };
  const beat = () => {
    if (inFlight) return;
    inFlight = true;
    options
      .send()
      .then((outcome) => {
        if (outcome === "stop") stop();
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
      });
  };

  return {
    update(active) {
      if (disposed) return;
      if (!active) return stop();
      if (handle === null)
        handle = timers.setInterval(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
    },
    dispose() {
      disposed = true;
      stop();
    },
    get running() {
      return handle !== null;
    },
  };
}

export async function sendSessionHeartbeat(): Promise<HeartbeatOutcome> {
  try {
    const res = await fetch("/api/session/heartbeat", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.ok) return "ok";
    // No session / signed out: nothing to keep alive until the dashboard state changes.
    return res.status === 409 || res.status === 401 ? "stop" : "error";
  } catch {
    return "error";
  }
}

/**
 * One interval per mounted dashboard, only while a session is active (`activeSessionId` set);
 * restarted for a new session, cleared when it ends or on unmount.
 */
export function useSessionHeartbeat(activeSessionId: string | null): void {
  const controller = useRef<HeartbeatController | null>(null);
  useEffect(() => {
    const c = createHeartbeatController({ send: sendSessionHeartbeat });
    controller.current = c;
    return () => {
      c.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    const c = controller.current;
    if (!c) return;
    c.update(false);
    c.update(activeSessionId !== null);
  }, [activeSessionId]);
}
