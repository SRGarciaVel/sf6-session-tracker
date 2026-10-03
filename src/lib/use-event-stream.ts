"use client";

import { useEffect, useRef, useState } from "react";

export type StreamStatus = "connecting" | "open" | "fallback";

export interface EventStreamOptions {
  url: string;
  enabled?: boolean;
  /** Named SSE events → handlers (data is the parsed JSON). */
  handlers: Record<string, (data: unknown) => void>;
  /** Plain JSON endpoint polled while the stream is down. */
  fallback?: {
    url: string;
    intervalMs: number;
    onData: (data: unknown) => void;
    onGone?: () => void;
  };
  /** Reconnect if nothing (not even a ping) arrives for this long. */
  watchdogMs?: number;
}

/**
 * Resilient EventSource:
 *  - server sends the full state on every (re)connect, so reconnecting == resyncing
 *  - watchdog closes zombie connections (OBS sleep, proxies)
 *  - exponential backoff with jitter on hard failures
 *  - falls back to polling the JSON endpoint while SSE is unavailable
 */
export function useEventStream({
  url,
  enabled = true,
  handlers,
  fallback,
  watchdogMs = 45_000,
}: EventStreamOptions): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const handlersRef = useRef(handlers);
  const fallbackRef = useRef(fallback);

  useEffect(() => {
    handlersRef.current = handlers;
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let disposed = false;
    let failures = 0;
    let lastSeen = Date.now();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      const fb = fallbackRef.current;
      if (!fb) return;
      try {
        const res = await fetch(fb.url, { cache: "no-store" });
        if (res.status === 404) fb.onGone?.();
        else if (res.ok) fb.onData(await res.json());
      } catch {
        // offline; next tick retries
      }
    };

    const startPolling = () => {
      const fb = fallbackRef.current;
      if (!fb || pollTimer || disposed) return;
      setStatus("fallback");
      void poll();
      pollTimer = setInterval(() => void poll(), fb.intervalMs);
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const scheduleReconnect = () => {
      es?.close();
      es = null;
      if (disposed || reconnectTimer) return;
      failures++;
      if (failures >= 3) startPolling();
      const delay = Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)) + Math.random() * 1_000;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      setStatus((s) => (s === "fallback" ? s : "connecting"));
      lastSeen = Date.now();
      const source = new EventSource(url);
      es = source;
      source.onopen = () => {
        failures = 0;
        lastSeen = Date.now();
        stopPolling();
        setStatus("open");
      };
      source.addEventListener("ping", () => {
        lastSeen = Date.now();
      });
      for (const name of Object.keys(handlersRef.current)) {
        source.addEventListener(name, (event) => {
          lastSeen = Date.now();
          try {
            const data: unknown = JSON.parse((event as MessageEvent<string>).data);
            handlersRef.current[name]?.(data);
          } catch {
            // ignore malformed message; the next full state will fix it
          }
        });
      }
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED) scheduleReconnect();
        else setStatus((s) => (s === "fallback" ? s : "connecting"));
      };
    };

    const watchdog = setInterval(() => {
      if (es && Date.now() - lastSeen > watchdogMs) scheduleReconnect();
    }, 5_000);

    connect();
    return () => {
      disposed = true;
      clearInterval(watchdog);
      clearTimeout(reconnectTimer);
      stopPolling();
      es?.close();
    };
  }, [url, enabled, watchdogMs]);

  return status;
}
