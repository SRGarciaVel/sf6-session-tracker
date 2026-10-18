/**
 * Popup presentation model: state precedence, tones, what the MAIN view may show, the safe
 * diagnostics allow-list, "Open SST" origin validation and ES/EN copy coverage.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PublicStatus } from "../src/lib/messages";
import {
  DEFAULT_STORE,
  type ConnectionTestReport,
  type TransportTestResult,
} from "../src/lib/storage";
import {
  ago,
  derivePopupView,
  diagnosticsText,
  sstUrl,
  stateKey,
  type Msg,
  type PopupContext,
  type PopupStateId,
  type PopupView,
} from "../src/popup/popup-view";

const NOW = Date.parse("2026-10-18T20:00:00Z");
const ORIGIN = "https://sst.example.com";
const TOKEN = "sf6c_SECRET_DEVICE_TOKEN_must_never_appear_0123456789";
const ctx = (over: Partial<PopupContext> = {}): PopupContext => ({
  now: NOW,
  version: "0.2.0",
  origins: [ORIGIN],
  debug: false,
  busy: null,
  ...over,
});
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const state = (active = false) =>
  ({
    cfnUserId: "1733837998",
    activeSession: active ? { id: "s1" } : null,
  }) as unknown as NonNullable<PublicStatus["lastState"]>;

const result = (over: Partial<TransportTestResult> = {}): TransportTestResult => ({
  transport: "service_worker",
  buildId: "PASS",
  play: "PASS",
  battlelog: "PASS",
  failure: null,
  status: 200,
  characters: 33,
  replays: 10,
  viewerOwnsProfile: true,
  pageLocale: "en",
  requestLocale: "en",
  signature: null,
  request: null,
  notes: [],
  ...over,
});
const passTest: ConnectionTestReport = {
  at: iso(60_000),
  cfnUserId: "1733837998",
  results: [result()],
  preferred: "service_worker",
  verdict: "PASS",
};

/** A paired, fully working Companion with no active SST session. */
const ready = (over: Partial<PublicStatus> = {}): PublicStatus => ({
  ...DEFAULT_STORE,
  trackerUrl: ORIGIN,
  deviceId: "dev-1",
  paired: true,
  trackerStatus: "connected",
  bucklerStatus: "ok",
  transport: "service_worker",
  lastState: state(false),
  lastSyncAt: iso(1_000),
  lastMatchAt: iso(16 * 3_600_000),
  lastTest: passTest,
  ...over,
});
const unpaired = (): PublicStatus => ({ ...DEFAULT_STORE, trackerUrl: ORIGIN, paired: false });

const view = (s: PublicStatus, c: Partial<PopupContext> = {}) => derivePopupView(s, ctx(c));

/** Every i18n key a view references (main view + diagnostics). */
function keysOf(v: PopupView): string[] {
  const msgs: Msg[] = [
    v.title,
    ...v.body,
    ...v.steps,
    ...(v.eyebrow ? [v.eyebrow] : []),
    ...(v.lastSync ? [v.lastSync] : []),
    ...(v.closing ? [v.closing] : []),
    ...(v.session ? [v.session.lastMatch, v.session.guidance] : []),
    ...(v.primary ? [v.primary.label] : []),
    ...(v.secondary ? [v.secondary.label] : []),
    ...(v.diagnostics ?? []).flatMap((g) => [
      g.title,
      ...g.rows.flatMap((r) => [r.label, ...("raw" in r.value ? [] : [r.value])]),
    ]),
  ];
  return msgs.map((msg) => msg.key);
}
/** Everything the MAIN (non-diagnostics) view would print, as raw values. */
const mainStrings = (v: PopupView) =>
  JSON.stringify({ ...v, diagnostics: null }) +
  JSON.stringify([v.title, v.body, v.steps, v.lastSync, v.session]);

describe("derived popup states", () => {
  const cases: Array<[string, PublicStatus, PopupStateId, PopupView["tone"]]> = [
    ["1. unpaired", unpaired(), "unpaired", "setup"],
    [
      "2. missing CFN (tracker answered without one)",
      ready({ lastState: { ...state(), cfnUserId: null } as PublicStatus["lastState"] }),
      "needs-cfn",
      "attention",
    ],
    [
      "3. Buckler setup: no validated transport",
      ready({ transport: null, bucklerStatus: "unknown", lastTest: null }),
      "needs-buckler",
      "attention",
    ],
    ["4. no Buckler tab", ready({ bucklerStatus: "no_tab" }), "needs-buckler-tab", "attention"],
    [
      "5. login required",
      ready({ bucklerStatus: "login_required" }),
      "needs-buckler-login",
      "attention",
    ],
    ["6. ready, no SST session", ready(), "ready-idle", "ok"],
    ["7. ready, active SST session", ready({ lastState: state(true) }), "ready-active", "ok"],
    [
      "8. tracker revoked (pairing reset by the worker)",
      { ...unpaired(), trackerStatus: "revoked", lastError: "device_revoked" },
      "tracker-revoked",
      "attention",
    ],
    [
      "9. tracker unreachable",
      ready({ trackerStatus: "disconnected", lastError: "tracker:network" }),
      "tracker-error",
      "problem",
    ],
    [
      "10. Buckler rate-limited → paused",
      ready({ bucklerStatus: "rate_limited", bucklerBackoffUntil: iso(-600_000) }),
      "buckler-paused",
      "attention",
    ],
    [
      "10b. Buckler 403 → paused",
      ready({ bucklerStatus: "blocked" }),
      "buckler-paused",
      "attention",
    ],
    [
      "11. Buckler unavailable",
      ready({ bucklerStatus: "unavailable" }),
      "buckler-error",
      "problem",
    ],
  ];
  for (const [name, status, id, tone] of cases) {
    it(`${name} → ${id} (${tone})`, () => {
      const v = view(status);
      expect(v.state).toBe(id);
      expect(v.tone).toBe(tone);
    });
  }

  it("a failed connection test explains the setup state (login / tab)", () => {
    const failed = (failure: string): ConnectionTestReport => ({
      ...passTest,
      verdict: "FAIL",
      preferred: null,
      results: [result({ failure, play: "FAIL" })],
    });
    const base = { transport: null, bucklerStatus: "unknown" as const };
    expect(view(ready({ ...base, lastTest: failed("login_required") })).state).toBe(
      "needs-buckler-login",
    );
    expect(view(ready({ ...base, lastTest: failed("no_tab") })).state).toBe("needs-buckler-tab");
    expect(view(ready({ ...base, lastTest: failed("unavailable") })).state).toBe("needs-buckler");
  });

  it("precedence: tracker problems win over Buckler / CFN; CFN unknown before the tracker answers", () => {
    expect(
      view(ready({ trackerStatus: "disconnected", bucklerStatus: "login_required" })).state,
    ).toBe("tracker-error");
    expect(view(ready({ lastState: null, transport: null, bucklerStatus: "unknown" })).state).toBe(
      "needs-buckler",
    );
    expect(
      view(
        ready({
          manualCfnUserId: "123456",
          lastState: { ...state(), cfnUserId: null } as PublicStatus["lastState"],
        }),
      ).state,
    ).toBe("ready-idle");
  });
});

describe("main view semantics", () => {
  it("no active SST session is NOT a warning: still ready / green, session neutral", () => {
    const v = view(ready());
    expect(v.state).toBe("ready-idle");
    expect(v.tone).toBe("ok");
    expect(v.session).toMatchObject({ active: false, guidance: { key: "sessionIdleGuidance" } });
    expect(v.primary).toEqual({ action: "openSst", label: { key: "actionOpenSst" } });
    expect(v.showSync).toBe(true);
  });

  it("active session: reassurance, no big CTA, sync still available", () => {
    const v = view(ready({ lastState: state(true) }));
    expect(v.session?.active).toBe(true);
    expect(v.primary).toBeNull();
    expect(v.closing).toEqual({ key: "readyClosing" });
    expect(v.showSync).toBe(true);
  });

  it("relative times: Now · s · min · h · —", () => {
    expect(ago(iso(1_000), NOW)).toEqual({ key: "justNow" });
    expect(ago(iso(8_000), NOW)).toEqual({ key: "secondsAgo", subs: ["8"] });
    expect(ago(iso(120_000), NOW)).toEqual({ key: "minutesAgo", subs: ["2"] });
    expect(ago(iso(16 * 3_600_000), NOW)).toEqual({ key: "hoursAgo", subs: ["16"] });
    expect(ago(null, NOW)).toEqual({ key: "dash" });
    expect(view(ready()).lastSync).toEqual({ key: "justNow" });
    expect(view(ready()).session?.lastMatch).toEqual({ key: "hoursAgo", subs: ["16"] });
  });

  it("CFN, transport and raw error codes never appear in the main view (only diagnostics)", () => {
    for (const status of [
      ready(),
      ready({ lastState: state(true) }),
      ready({ trackerStatus: "disconnected", lastError: "tracker:network" }),
      ready({ bucklerStatus: "unavailable", lastError: "buckler:unavailable" }),
    ]) {
      const main = mainStrings(view(status));
      expect(main).not.toContain("1733837998");
      expect(main).not.toContain("service_worker");
      expect(main).not.toContain("tracker:network");
      expect(main).not.toContain("buckler:unavailable");
    }
    const diag = JSON.stringify(view(ready()).diagnostics);
    expect(diag).toContain("1733837998");
    expect(diag).toContain("service_worker");
  });

  it("before pairing: no CFN, sync, session, last match or diagnostics", () => {
    const v = view(unpaired());
    expect(v.form).toBe("pair");
    expect(v.showSync).toBe(false);
    expect(v.session).toBeNull();
    expect(v.lastSync).toBeNull();
    expect(v.diagnostics).toBeNull();
  });

  it("single production origin → no visible tracker selector; dev (several) → selector", () => {
    expect(view(unpaired()).showTrackerSelect).toBe(false);
    expect(view(unpaired(), { origins: [ORIGIN, "https://b.example"] }).showTrackerSelect).toBe(
      true,
    );
  });

  it("Buckler paused: no retry in the main view (the worker's backoff is respected)", () => {
    const v = view(ready({ bucklerStatus: "rate_limited" }));
    expect(v.primary).toBeNull();
    expect(v.secondary).toBeNull();
    expect(v.showSync).toBe(false);
    expect(v.body.map((b) => b.key)).toContain("state_buckler_paused_note");
  });

  it("Buckler paused: Diagnostics' Test connection is hidden too (no manual queries in backoff)", () => {
    for (const bucklerStatus of ["rate_limited", "blocked"] as const) {
      const v = view(ready({ bucklerStatus }));
      expect(v.diagnostics).not.toBeNull(); // still readable
      expect(v.showDiagTest).toBe(false);
    }
    expect(view(ready()).showDiagTest).toBe(true);
    expect(view(ready({ bucklerStatus: "login_required" })).showDiagTest).toBe(true);
    expect(view(ready({ trackerStatus: "disconnected" })).showDiagTest).toBe(true);
    expect(view(unpaired()).showDiagTest).toBe(false);
  });

  it("a remembered transport without a current observation is 'Configured', not 'Connected'", () => {
    const bucklerRow = (v: PopupView) =>
      v.diagnostics?.[0]?.rows.find((r) => "key" in r.label && r.label.key === "diagBuckler")
        ?.value;
    expect(bucklerRow(view(ready({ bucklerStatus: "unknown" })))).toEqual({
      key: "statusConfigured",
    });
    expect(
      bucklerRow(view(ready({ bucklerStatus: "unknown", transport: null, lastTest: null }))),
    ).toEqual({ key: "statusNotTested" });
    expect(bucklerRow(view(ready()))).toEqual({ key: "statusConnected" });
  });

  it("login required: steps, retry the test, open Buckler", () => {
    const v = view(ready({ bucklerStatus: "login_required" }));
    expect(v.steps).toHaveLength(3);
    expect(v.primary?.action).toBe("test");
    expect(v.secondary?.action).toBe("openBuckler");
    expect(v.eyebrow).toEqual({ key: "eyebrowSstConnected" });
  });

  it("missing CFN shows the CFN form only then", () => {
    expect(
      view(ready({ lastState: { ...state(), cfnUserId: null } as PublicStatus["lastState"] })).form,
    ).toBe("cfn");
    expect(view(ready()).form).toBeNull();
  });

  it("tracker error: retry + open SST; revoked: pair again", () => {
    const err = view(ready({ trackerStatus: "disconnected" }));
    expect(err.primary?.action).toBe("sync");
    expect(err.secondary?.action).toBe("openSst");
    expect(view({ ...unpaired(), trackerStatus: "revoked" }).form).toBe("pair");
  });

  it("12/13. a local action decorates the view (busy), never changes the state", () => {
    const syncing = view(ready(), { busy: "sync" });
    expect(syncing.busy).toBe("sync");
    expect(syncing.state).toBe("ready-idle");
    const testing = view(ready({ transport: null, bucklerStatus: "unknown", lastTest: null }), {
      busy: "test",
    });
    expect(testing.busy).toBe("test");
    expect(testing.state).toBe("needs-buckler");
  });
});

describe("diagnostics", () => {
  const t = (key: string, subs?: string[]) => `${key}${subs ? `(${subs.join(",")})` : ""}`;

  it("copied text contains only allow-listed fields — never the token or raw internals", () => {
    const status = ready({
      lastState: state(true),
      lastError: "tracker:something_internal",
    });
    // The device token is not part of PublicStatus; even if it were smuggled in, it is not read.
    const smuggled = { ...status, deviceToken: TOKEN } as PublicStatus;
    const text = diagnosticsText(view(smuggled), "0.2.0", t);
    expect(text.split("\n")[0]).toBe("SST Companion 0.2.0");
    expect(text).toContain("diagCfn: 1733837998");
    expect(text).toContain("diagTransport: service_worker");
    expect(text).toContain("diagCharacters: 33");
    expect(text).toContain("diagReplays: 10");
    expect(text).toContain("diagLocale: en");
    expect(text).toContain("diagTestResult: PASS");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("sf6c_");
    expect(text).not.toContain("something_internal"); // raw codes: debug builds only
    expect(text).not.toContain(ORIGIN);
    const labels = text
      .split("\n")
      .slice(1)
      .map((l) => l.split(":")[0]);
    expect(labels).toEqual([
      "diagSst",
      "diagBuckler",
      "diagCfn",
      "diagSession",
      "lastSync",
      "lastMatch",
      "diagTestResult",
      "diagTransport",
      "diagCharacters",
      "diagReplays",
      "diagLocale",
      "diagVersion",
    ]);
  });

  it("debug builds add the raw last error (unchanged debug policy)", () => {
    const status = ready({ lastError: "buckler:unavailable" });
    expect(diagnosticsText(view(status, { debug: true }), "0.2.0", t)).toContain(
      "diagLastError: buckler:unavailable",
    );
  });
});

describe("Open SST", () => {
  it("only the allow-listed origin of this build, never an arbitrary URL", () => {
    expect(sstUrl(ORIGIN, [ORIGIN])).toBe(`${ORIGIN}/dashboard`);
    expect(sstUrl("https://evil.example", [ORIGIN])).toBeNull();
    expect(sstUrl(`${ORIGIN}/path?x=1`, [ORIGIN])).toBeNull();
    expect(sstUrl("javascript:alert(1)", [ORIGIN])).toBeNull();
    expect(sstUrl("", [ORIGIN])).toBeNull();
  });
});

describe("ES / EN copy", () => {
  const load = (lang: string) =>
    JSON.parse(
      readFileSync(new URL(`../_locales/${lang}/messages.json`, import.meta.url), "utf8"),
    ) as Record<string, { message: string }>;
  const es = load("es");
  const en = load("en");

  it("both catalogs have the same keys, all non-empty, valid chrome.i18n names", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries({ ...es, ...en })) {
      expect(k).toMatch(/^[A-Za-z0-9_@]+$/);
      expect(v.message.trim().length, k).toBeGreaterThan(0);
    }
  });

  it("every key a view can reference exists in both languages", () => {
    const statuses: PublicStatus[] = [
      unpaired(),
      { ...unpaired(), trackerStatus: "revoked" },
      ready(),
      ready({ lastState: state(true) }),
      ready({ trackerStatus: "disconnected" }),
      ready({ lastState: { ...state(), cfnUserId: null } as PublicStatus["lastState"] }),
      ready({ transport: null, bucklerStatus: "unknown", lastTest: null }),
      ready({ bucklerStatus: "no_tab" }),
      ready({ bucklerStatus: "login_required" }),
      ready({ bucklerStatus: "rate_limited" }),
      ready({ bucklerStatus: "unavailable", lastError: "x" }),
      ready({ bucklerStatus: "unknown" }),
    ];
    const keys = new Set(statuses.flatMap((s) => keysOf(view(s, { debug: true }))));
    for (const id of ["unpaired", "ready-idle"] as const) keys.add(`${stateKey(id)}_title`);
    // Keys used directly by popup.ts / popup.html.
    const popupSource =
      readFileSync(new URL("../src/popup/popup.ts", import.meta.url), "utf8") +
      readFileSync(new URL("../src/popup/popup.html", import.meta.url), "utf8");
    for (const [, key] of popupSource.matchAll(/(?:\bt\(|data-i18n=)"([A-Za-z0-9_]+)"/g)) {
      keys.add(key!);
    }
    for (const key of [
      "busyPairing",
      "busyTesting",
      "busySyncing",
      "busyDisconnecting",
      "busySaving",
    ]) {
      keys.add(key);
    }
    expect(keys.size).toBeGreaterThan(50);
    for (const key of keys) {
      expect(es[key], `es: ${key}`).toBeDefined();
      expect(en[key], `en: ${key}`).toBeDefined();
    }
  });

  it("required product copy (ES)", () => {
    expect(es.state_ready_idle_title!.message).toBe("Todo listo");
    expect(es.sessionInactive!.message).toBe("Sin sesión activa");
    expect(es.state_needs_buckler_login_title!.message).toBe("Inicia sesión en Buckler");
    expect(es.state_unpaired_title!.message).toBe("Conecta el Companion");
    expect(es.privacyTitle!.message).toBe("Tu sesión de Capcom permanece en este navegador");
    expect(es.privacyBody!.message).toBe(
      "SST nunca recibe tu contraseña, cookies ni credenciales de Capcom.",
    );
    expect(en.privacyBody!.message).toBe(
      "SST never receives your Capcom password, cookies or credentials.",
    );
  });
});
