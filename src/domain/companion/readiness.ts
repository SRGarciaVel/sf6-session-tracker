/**
 * "Ready to play?" — pure assessment of the browser companion's signals for the dashboard
 * (pre-session checklist, companion status, tracking banner). Presentation only: the server
 * still enforces freshness when a session starts (CompanionSF6DataProvider), so this can never
 * allow anything the backend would reject; it only explains it before the click.
 */

/** Raw, account-scoped facts gathered by the server (see server/companion/readiness.ts). */
export interface CompanionSignals {
  /** false when the server is not in companion mode (mock/dev): nothing to check. */
  required: boolean;
  /** Non-revoked paired devices of this account. */
  deviceCount: number;
  /** Most recent contact from any paired device (ISO). */
  lastSeenAt: string | null;
  /** Extension version reported by that most recent device (null until its first sync). */
  installedVersion: string | null;
  /** Latest snapshot for the player's CFN (ISO), pushed by the companion. */
  profileObservedAt: string | null;
  matchesObservedAt: string | null;
  hasProfile: boolean;
  /** Characters in the latest profile (0 when none or no profile). */
  characterCount: number;
  /** Same freshness window the server uses to start/end a session. */
  maxAgeMs: number;
  /** Server clock when the signals were read (deterministic first render). */
  serverTime: string;
}

export type CompanionLink = "connected" | "quiet" | "notPaired";
export type DataFreshness = "fresh" | "stale" | "never";

export type ReadinessStep =
  "pairCompanion" | "openCompanionBrowser" | "loginBuckler" | "syncNow" | null;

export interface CompanionReadiness {
  required: boolean;
  companion: CompanionLink;
  buckler: DataFreshness;
  profile: DataFreshness;
  characterDetected: boolean;
  /** Same rule as the server's session start: fresh profile AND fresh battle log. */
  canStart: boolean;
  /** The single most useful thing to do next (null when ready). */
  nextStep: ReadinessStep;
}

/**
 * A paired companion contacts the tracker every 30 s; the server records it at most once per
 * minute. Three minutes without contact ⇒ its browser is most likely closed.
 */
export const COMPANION_QUIET_AFTER_MS = 3 * 60_000;

function freshness(iso: string | null, now: number, maxAgeMs: number): DataFreshness {
  if (!iso) return "never";
  return now - Date.parse(iso) <= maxAgeMs ? "fresh" : "stale";
}

export function assessCompanion(signals: CompanionSignals, now: number): CompanionReadiness {
  const companion: CompanionLink =
    signals.deviceCount === 0
      ? "notPaired"
      : signals.lastSeenAt && now - Date.parse(signals.lastSeenAt) <= COMPANION_QUIET_AFTER_MS
        ? "connected"
        : "quiet";
  const buckler = freshness(signals.matchesObservedAt, now, signals.maxAgeMs);
  const profile = signals.hasProfile
    ? freshness(signals.profileObservedAt, now, signals.maxAgeMs)
    : "never";
  const dataReady = buckler === "fresh" && profile === "fresh";

  let nextStep: ReadinessStep = null;
  if (signals.required && !dataReady) {
    if (companion === "notPaired") nextStep = "pairCompanion";
    else if (companion === "quiet") nextStep = "openCompanionBrowser";
    else if (buckler === "never" || profile === "never") nextStep = "loginBuckler";
    else nextStep = "syncNow";
  }

  return {
    required: signals.required,
    companion,
    buckler,
    profile,
    characterDetected: signals.characterCount > 0,
    canStart: !signals.required || dataReady,
    nextStep,
  };
}
