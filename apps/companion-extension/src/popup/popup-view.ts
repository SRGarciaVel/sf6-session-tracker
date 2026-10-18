/**
 * Popup presentation model (pure, unit tested). The ONLY input is the worker's PublicStatus (the
 * single source of truth) plus ephemeral popup facts (a local action in flight, the clock, the
 * build's version / origins / debug flag). Nothing here is persisted.
 *
 *   PublicStatus ──derivePopupView──▶ PopupView (state, tone, copy keys, actions, diagnostics)
 *
 * Strings are i18n KEYS (+ substitutions): popup.ts translates them with chrome.i18n.
 *
 * State precedence (first match wins):
 *   1. not paired (or revoked → "pair again")   2. tracker unreachable / error
 *   3. CFN missing (tracker answered without one and none was entered)
 *   4. Buckler: no validated transport → setup; login required; no tab; paused (403 / 429 —
 *      the worker's backoff); other Buckler failure
 *   5. ready — with an active SST session      6. ready — no active session (still READY)
 */
import type { PublicStatus } from "../lib/messages";
import type { TransportTestResult } from "../lib/storage";
import { failureReasonKey } from "../lib/test-summary";
import { allowedTrackerOrigin } from "../lib/tracker-origins";

export type PopupStateId =
  | "unpaired"
  | "tracker-revoked"
  | "tracker-error"
  | "needs-cfn"
  | "needs-buckler"
  | "needs-buckler-tab"
  | "needs-buckler-login"
  | "buckler-paused"
  | "buckler-error"
  | "ready-active"
  | "ready-idle";

/** ok = green · attention = amber (the user can act) · problem = red · setup = cyan. */
export type PopupTone = "ok" | "attention" | "problem" | "setup";

/** A local action the popup itself started and is awaiting (never persisted). */
export type BusyAction = "pair" | "test" | "sync" | "disconnect" | "cfn";

export type PopupAction = "openSst" | "openBuckler" | "test" | "sync";

export interface Msg {
  key: string;
  subs?: string[];
}

export interface DiagnosticRow {
  label: Msg;
  value: Msg | { raw: string };
}

export interface DiagnosticGroup {
  title: Msg;
  rows: DiagnosticRow[];
}

export interface PopupView {
  state: PopupStateId;
  tone: PopupTone;
  /** Small label above the title ("SST connected" while Buckler still needs setup). */
  eyebrow: Msg | null;
  title: Msg;
  body: Msg[];
  /** Numbered steps (Buckler login). */
  steps: Msg[];
  /** Relative "last sync" (only once something was synced). */
  lastSync: Msg | null;
  /** The SST session block (only when the Companion is ready). */
  session: { active: boolean; lastMatch: Msg; guidance: Msg } | null;
  /** One closing reassurance line (ready-active: "you can play"). */
  closing: Msg | null;
  primary: { action: PopupAction; label: Msg } | null;
  secondary: { action: PopupAction; label: Msg } | null;
  /** "Sync now" in the main view (hidden while Buckler is paused, never before pairing). */
  showSync: boolean;
  /**
   * "Test connection" inside Diagnostics. Hidden while Buckler is paused (403 / 429): a manual
   * test would query Buckler during the worker's backoff.
   */
  showDiagTest: boolean;
  form: "pair" | "cfn" | null;
  /** The tracker select is only shown when the build allows more than one origin (dev). */
  showTrackerSelect: boolean;
  diagnostics: DiagnosticGroup[] | null;
  busy: BusyAction | null;
}

export interface PopupContext {
  now: number;
  version: string;
  origins: readonly string[];
  debug: boolean;
  busy: BusyAction | null;
}

const m = (key: string, ...subs: string[]): Msg => (subs.length ? { key, subs } : { key });

/** chrome.i18n keys allow only [A-Za-z0-9_@]: "buckler-paused" → "state_buckler_paused". */
export const stateKey = (state: PopupStateId) => `state_${state.replace(/-/g, "_")}`;

/** "Now" · "8 s ago" · "2 min ago" · "16 h ago" · "—". */
export function ago(iso: string | null, now: number): Msg {
  if (!iso) return m("dash");
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return m("dash");
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return m("justNow");
  if (s < 60) return m("secondsAgo", String(s));
  if (s < 3600) return m("minutesAgo", String(Math.round(s / 60)));
  return m("hoursAgo", String(Math.round(s / 3600)));
}

const PAUSED = new Set(["rate_limited", "blocked"]);

/** CFN the Companion syncs for (tracker's, else the one entered by hand). */
export const cfnOf = (s: PublicStatus): string | null =>
  s.lastState?.cfnUserId ?? s.manualCfnUserId ?? null;

function deriveState(s: PublicStatus): PopupStateId {
  if (!s.paired) return s.trackerStatus === "revoked" ? "tracker-revoked" : "unpaired";
  if (s.trackerStatus === "revoked") return "tracker-revoked";
  if (s.trackerStatus === "disconnected" || s.trackerStatus === "error") return "tracker-error";
  // Only once the tracker answered: before that a missing CFN is just unknown.
  if (s.lastState && !cfnOf(s)) return "needs-cfn";
  const b = s.bucklerStatus;
  if (b === "login_required") return "needs-buckler-login";
  if (b === "no_tab") return "needs-buckler-tab";
  if (PAUSED.has(b)) return "buckler-paused";
  if (b !== "ok" && b !== "unknown") return "buckler-error";
  if (!s.transport) {
    // No transport validated yet: a failed connection test says why.
    const failures = s.lastTest?.verdict === "FAIL" ? failureReasonKey(s.lastTest.results) : null;
    if (failures === "testReasonLogin") return "needs-buckler-login";
    if (failures === "testReasonTab") return "needs-buckler-tab";
    return "needs-buckler";
  }
  return s.lastState?.activeSession ? "ready-active" : "ready-idle";
}

const TONE: Record<PopupStateId, PopupTone> = {
  unpaired: "setup",
  "tracker-revoked": "attention",
  "tracker-error": "problem",
  "needs-cfn": "attention",
  "needs-buckler": "attention",
  "needs-buckler-tab": "attention",
  "needs-buckler-login": "attention",
  "buckler-paused": "attention",
  "buckler-error": "problem",
  "ready-active": "ok",
  "ready-idle": "ok",
};

/** The test result that answered (or null). */
function winner(s: PublicStatus): TransportTestResult | null {
  const test = s.lastTest;
  if (!test || test.verdict !== "PASS") return null;
  return test.results.find((r) => r.transport === test.preferred) ?? null;
}

function trackerLabel(s: PublicStatus): Msg {
  if (!s.paired) return m(s.trackerStatus === "revoked" ? "statusRevoked" : "statusNotPaired");
  switch (s.trackerStatus) {
    case "connected":
      return m("statusConnected");
    case "revoked":
      return m("statusRevoked");
    default:
      return m("statusUnreachable");
  }
}

function bucklerLabel(s: PublicStatus): Msg {
  switch (s.bucklerStatus) {
    case "ok":
      return m("statusConnected");
    case "unknown":
      // A remembered transport is configuration, not a current observation of Buckler.
      return m(s.transport ? "statusConfigured" : "statusNotTested");
    case "login_required":
      return m("statusLoginRequired");
    case "no_tab":
      return m("statusNoTab");
    case "rate_limited":
    case "blocked":
      return m("statusPaused");
    default:
      return m("statusUnavailable");
  }
}

/** Safe, allow-listed support fields only (never the token, cookies, payloads or bodies). */
function diagnostics(s: PublicStatus, ctx: PopupContext): DiagnosticGroup[] {
  const w = winner(s);
  const raw = (v: string | number | null | undefined) => ({
    raw: v === null || v === undefined || v === "" ? "—" : String(v),
  });
  const groups: DiagnosticGroup[] = [
    {
      title: m("diagConnection"),
      rows: [
        { label: m("diagSst"), value: trackerLabel(s) },
        { label: m("diagBuckler"), value: bucklerLabel(s) },
        { label: m("diagCfn"), value: raw(cfnOf(s)) },
      ],
    },
    {
      title: m("diagActivity"),
      rows: [
        {
          label: m("diagSession"),
          value: m(s.lastState?.activeSession ? "sessionActiveShort" : "sessionInactiveShort"),
        },
        { label: m("lastSync"), value: ago(s.lastSyncAt, ctx.now) },
        { label: m("lastMatch"), value: ago(s.lastMatchAt, ctx.now) },
      ],
    },
    {
      title: m("diagBucklerTest"),
      rows: [
        { label: m("diagTestResult"), value: raw(s.lastTest?.verdict ?? null) },
        { label: m("diagTransport"), value: raw(s.transport) },
        { label: m("diagCharacters"), value: raw(w?.characters) },
        { label: m("diagReplays"), value: raw(w?.replays) },
        { label: m("diagLocale"), value: raw(w ? (w.requestLocale ?? w.pageLocale) : null) },
      ],
    },
    {
      title: m("diagCompanion"),
      rows: [{ label: m("diagVersion"), value: raw(ctx.version) }],
    },
  ];
  // Raw internal codes stay debug-only (unchanged policy).
  if (ctx.debug && s.lastError) {
    groups[3]!.rows.push({ label: m("diagLastError"), value: raw(s.lastError) });
  }
  return groups;
}

export function derivePopupView(s: PublicStatus, ctx: PopupContext): PopupView {
  const state = deriveState(s);
  const view: PopupView = {
    state,
    tone: TONE[state],
    eyebrow: null,
    title: m(`${stateKey(state)}_title`),
    body: [m(`${stateKey(state)}_body`)],
    steps: [],
    lastSync: null,
    session: null,
    closing: null,
    primary: null,
    secondary: null,
    showSync: s.paired,
    showDiagTest: s.paired,
    form: null,
    showTrackerSelect: false,
    diagnostics: s.paired ? diagnostics(s, ctx) : null,
    busy: ctx.busy,
  };

  switch (state) {
    case "unpaired":
    case "tracker-revoked":
      view.form = "pair";
      view.showSync = false;
      view.showTrackerSelect = ctx.origins.length > 1;
      view.diagnostics = null;
      break;
    case "tracker-error":
      view.primary = { action: "sync", label: m("actionRetry") };
      view.secondary = { action: "openSst", label: m("actionOpenSst") };
      view.showSync = false;
      break;
    case "needs-cfn":
      view.eyebrow = m("eyebrowSstConnected");
      view.form = "cfn";
      view.showSync = false;
      break;
    case "needs-buckler":
      view.eyebrow = m("eyebrowSstConnected");
      view.primary = { action: "test", label: m("actionTestConnection") };
      view.showSync = false;
      break;
    case "needs-buckler-login":
      view.eyebrow = m("eyebrowSstConnected");
      view.steps = [m("loginStep1"), m("loginStep2"), m("loginStep3")];
      view.primary = { action: "test", label: m("actionRetryConnection") };
      view.secondary = { action: "openBuckler", label: m("actionOpenBuckler") };
      view.showSync = false;
      break;
    case "needs-buckler-tab":
      view.eyebrow = m("eyebrowSstConnected");
      view.primary = { action: "openBuckler", label: m("actionOpenBuckler") };
      view.secondary = { action: "test", label: m("actionTryAgain") };
      view.showSync = false;
      break;
    case "buckler-paused":
      // The worker deliberately backs off after 403 / 429: no retry button in the main view.
      view.body.push(m("state_buckler_paused_note"));
      view.showSync = false;
      view.showDiagTest = false;
      break;
    case "buckler-error":
      view.lastSync = s.lastSyncAt ? ago(s.lastSyncAt, ctx.now) : null;
      break;
    case "ready-active":
    case "ready-idle": {
      const active = state === "ready-active";
      view.lastSync = ago(s.lastSyncAt, ctx.now);
      view.session = {
        active,
        lastMatch: ago(s.lastMatchAt, ctx.now),
        guidance: m(active ? "sessionActiveGuidance" : "sessionIdleGuidance"),
      };
      if (active) view.closing = m("readyClosing");
      else view.primary = { action: "openSst", label: m("actionOpenSst") };
      break;
    }
  }
  return view;
}

/**
 * Plain-text support summary (Copy diagnostics). Built ONLY from the allow-listed diagnostic
 * rows above, so it can never contain the device token, cookies, payloads or error bodies.
 */
export function diagnosticsText(
  view: PopupView,
  version: string,
  t: (key: string, subs?: string[]) => string,
): string {
  const lines = [`SST Companion ${version}`];
  for (const group of view.diagnostics ?? []) {
    for (const row of group.rows) {
      const value = "raw" in row.value ? row.value.raw : t(row.value.key, row.value.subs);
      lines.push(`${t(row.label.key, row.label.subs)}: ${value}`);
    }
  }
  return lines.join("\n");
}

/** "Open SST": only the paired tracker origin, and only if this build allows it. */
export function sstUrl(trackerUrl: string, origins: readonly string[]): string | null {
  const origin = allowedTrackerOrigin(trackerUrl, origins);
  return origin ? `${origin}/dashboard` : null;
}
