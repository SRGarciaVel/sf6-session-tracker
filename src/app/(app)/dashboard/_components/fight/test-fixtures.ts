/** Test-only: dashboard live states built from the real engine + real readiness inputs. */
import type { CompanionSignals } from "@/domain/companion/readiness";
import type { LiveSessionState } from "@/domain/overlay/state";
import type { DashboardLiveState } from "@/server/dashboard/state";
import { engineSession } from "@/components/fight-session/test-support";

export const NOW = Date.parse("2026-10-21T20:40:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

export const SIGNALS: Record<
  "ready" | "unpaired" | "quiet" | "bucklerNever" | "stale",
  CompanionSignals
> = {
  ready: {
    required: true,
    deviceCount: 1,
    lastSeenAt: ago(10_000),
    installedVersion: "0.4.0",
    profileObservedAt: ago(30_000),
    matchesObservedAt: ago(10_000),
    hasProfile: true,
    characterCount: 2,
    maxAgeMs: 300_000,
    serverTime: new Date(NOW).toISOString(),
  },
  unpaired: {
    required: true,
    deviceCount: 0,
    lastSeenAt: null,
    installedVersion: null,
    profileObservedAt: null,
    matchesObservedAt: null,
    hasProfile: false,
    characterCount: 0,
    maxAgeMs: 300_000,
    serverTime: new Date(NOW).toISOString(),
  },
  quiet: {
    required: true,
    deviceCount: 1,
    lastSeenAt: ago(6 * 60_000),
    installedVersion: "0.4.0",
    profileObservedAt: ago(6 * 60_000),
    matchesObservedAt: ago(6 * 60_000),
    hasProfile: true,
    characterCount: 2,
    maxAgeMs: 300_000,
    serverTime: new Date(NOW).toISOString(),
  },
  /** Companion connected, but no Buckler data was ever received. */
  bucklerNever: {
    required: true,
    deviceCount: 1,
    lastSeenAt: ago(10_000),
    installedVersion: "0.4.0",
    profileObservedAt: null,
    matchesObservedAt: null,
    hasProfile: false,
    characterCount: 0,
    maxAgeMs: 300_000,
    serverTime: new Date(NOW).toISOString(),
  },
  /** Connected, but the baseline data is older than the freshness window. */
  stale: {
    required: true,
    deviceCount: 1,
    lastSeenAt: ago(10_000),
    installedVersion: "0.4.0",
    profileObservedAt: ago(20 * 60_000),
    matchesObservedAt: ago(20 * 60_000),
    hasProfile: true,
    characterCount: 2,
    maxAgeMs: 300_000,
    serverTime: new Date(NOW).toISOString(),
  },
};

export const SESSION = {
  none: (): LiveSessionState => ({
    ...engineSession({ results: [] }),
    status: "none",
    sessionId: null,
  }),
  active: () =>
    engineSession({ results: ["win", "loss", "win"], snapshot: { value: 1594, after: 2 } }),
  ended: () =>
    engineSession({
      results: ["win", "win", "loss"],
      status: "ended",
      snapshot: { value: 1594, after: 2 },
    }),
};

export function dashState(
  session: LiveSessionState,
  over: { signals?: CompanionSignals; tracker?: DashboardLiveState["tracker"]["state"] } = {},
): DashboardLiveState {
  return {
    live: { player: { displayName: "Yasmine" }, session, generatedAt: new Date(NOW).toISOString() },
    player: { cfnUserId: "9990000200" },
    tracker: {
      state: over.tracker ?? (session.status === "active" ? "ok" : "idle"),
      lastSuccessAt: ago(20_000),
      lastPollAt: ago(20_000),
      nextPollAt: null,
      consecutiveFailures: over.tracker === "degraded" ? 3 : 0,
      lastError: null,
    },
    overlayConnections: 1,
    companion: over.signals ?? SIGNALS.ready,
  };
}
