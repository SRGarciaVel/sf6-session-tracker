"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatTimeAgo } from "@/domain/format";
import { useEventStream, type StreamStatus } from "@/lib/use-event-stream";
import { useSessionHeartbeat } from "@/lib/session-heartbeat";
import type { DashboardLiveState } from "@/server/dashboard/state";

interface LiveDashboardValue {
  state: DashboardLiveState;
  stream: StreamStatus;
}

const LiveDashboardContext = createContext<LiveDashboardValue | null>(null);

export function useLiveDashboard(): LiveDashboardValue {
  const value = useContext(LiveDashboardContext);
  if (!value) throw new Error("useLiveDashboard must be used inside <LiveDashboardProvider>");
  return value;
}

function isDashboardState(data: unknown): data is DashboardLiveState {
  return typeof data === "object" && data !== null && "live" in data && "tracker" in data;
}

/** Holds the authoritative dashboard state, replaced wholesale by each SSE snapshot. */
export function LiveDashboardProvider({
  initial,
  children,
}: {
  initial: DashboardLiveState;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);

  // Server-rendered parts (history list) follow session lifecycle and new matches.
  const { sessionId, status, totalGames } = state.live.session;
  const lastSession = useRef(`${sessionId}:${status}:${totalGames}`);
  useEffect(() => {
    const key = `${sessionId}:${status}:${totalGames}`;
    if (key !== lastSession.current) {
      lastSession.current = key;
      router.refresh();
    }
  }, [sessionId, status, totalGames, router]);

  // A fresh server render (router.refresh / navigation) is authoritative too. Adjusting state
  // during render (instead of in an effect) avoids an extra render pass.
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    if (initial.live.generatedAt > state.live.generatedAt) setState(initial);
  }

  const apply = useCallback((data: unknown) => {
    if (!isDashboardState(data)) return;
    setState((current) =>
      data.live.generatedAt >= current.live.generatedAt ||
      data.overlayConnections !== current.overlayConnections
        ? data
        : current,
    );
  }, []);

  const stream = useEventStream({ url: "/api/me/stream", handlers: { dashboard: apply } });
  // Keeps a single-service deploy awake during an active session (see session-heartbeat.ts).
  useSessionHeartbeat(status === "active" && sessionId ? sessionId : null);

  return (
    <LiveDashboardContext.Provider value={{ state, stream }}>
      {children}
    </LiveDashboardContext.Provider>
  );
}

/** Re-renders every `intervalMs`; null on the server/first paint to avoid hydration mismatches. */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

/** Localized "12 s ago" / "hace 12 s" for tracker status. */
export function timeAgo(
  iso: string | null,
  now: number | null,
  locale: string,
  labels: { never: string; justNow: string },
): string {
  if (!iso) return labels.never;
  if (now === null) return "…";
  const { seconds, text } = formatTimeAgo(iso, now, locale);
  return seconds < 5 ? labels.justNow : text;
}
