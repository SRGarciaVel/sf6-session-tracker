/**
 * Popup: renders derivePopupView(PublicStatus) and forwards the user's actions to the worker.
 * All syncing still happens in the service worker; the popup only keeps an EPHEMERAL "busy"
 * flag for the action it started itself (never persisted).
 */
import { BUCKLER_BASE_PATH, BUCKLER_ORIGIN } from "@sf6/capcom-core/buckler";
import type { CompanionRequest, CompanionResponse, PublicStatus } from "../lib/messages";
import { COMPANION_DEBUG } from "../lib/debug";
import { summarizeConnectionTest } from "../lib/test-summary";
import { TRACKER_ORIGINS } from "../lib/tracker-origins";
import {
  derivePopupView,
  diagnosticsText,
  sstUrl,
  type BusyAction,
  type Msg,
  type PopupAction,
  type PopupView,
} from "./popup-view";

const t = (key: string, subs?: string[]) => chrome.i18n.getMessage(key, subs) || key;
const tm = (msg: Msg) => t(msg.key, msg.subs);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** The manifest is the version source of truth (the build injects the same value in sync). */
const VERSION = chrome.runtime.getManifest().version;
/** Canonical Buckler entry page (the host the extension already holds a permission for). */
const BUCKLER_URL = `${BUCKLER_ORIGIN}${BUCKLER_BASE_PATH}/`;

for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n ?? "");
}
$("version").textContent = `v${VERSION}`;

const send = (msg: CompanionRequest) =>
  chrome.runtime.sendMessage<CompanionRequest, CompanionResponse>(msg);

let status: PublicStatus | null = null;
let busy: BusyAction | null = null;
let view: PopupView | null = null;

const BUSY_LABEL: Record<BusyAction, string> = {
  pair: "busyPairing",
  test: "busyTesting",
  sync: "busySyncing",
  disconnect: "busyDisconnecting",
  cfn: "busySaving",
};

function setText(id: string, msg: Msg | null) {
  const el = $(id);
  el.hidden = msg === null;
  el.textContent = msg ? tm(msg) : "";
}

function setButton(
  el: HTMLButtonElement,
  label: string,
  action: BusyAction | null,
  show = true,
): void {
  el.hidden = !show;
  const mine = action !== null && busy === action;
  el.textContent = mine ? t(BUSY_LABEL[action]) : label;
  el.disabled = busy !== null;
  if (mine) el.setAttribute("aria-busy", "true");
  else el.removeAttribute("aria-busy");
}

const busyOf = (action: PopupAction): BusyAction | null =>
  action === "test" ? "test" : action === "sync" ? "sync" : null;

function renderDiagnostics(v: PopupView) {
  const host = $("diagGroups");
  host.replaceChildren();
  for (const group of v.diagnostics ?? []) {
    const section = document.createElement("section");
    section.className = "diag-group";
    const h = document.createElement("h3");
    h.textContent = tm(group.title);
    const dl = document.createElement("dl");
    for (const row of group.rows) {
      const dt = document.createElement("dt");
      dt.textContent = tm(row.label);
      const dd = document.createElement("dd");
      dd.textContent = "raw" in row.value ? row.value.raw : tm(row.value);
      dl.append(dt, dd);
    }
    section.append(h, dl);
    host.append(section);
  }
}

function render() {
  if (!status) return;
  view = derivePopupView(status, {
    now: Date.now(),
    version: VERSION,
    origins: TRACKER_ORIGINS,
    debug: COMPANION_DEBUG,
    busy,
  });
  const v = view;
  document.body.dataset.state = v.state;
  $("status").dataset.tone = v.tone;
  setText("eyebrow", v.eyebrow);
  $("title").textContent = tm(v.title);
  $("body").replaceChildren(
    ...v.body.map((msg) => {
      const p = document.createElement("p");
      p.textContent = tm(msg);
      return p;
    }),
  );
  $("steps").hidden = v.steps.length === 0;
  $("steps").replaceChildren(
    ...v.steps.map((msg) => {
      const li = document.createElement("li");
      li.textContent = tm(msg);
      return li;
    }),
  );
  $("lastSyncRow").hidden = v.lastSync === null;
  $("lastSync").textContent = v.lastSync ? tm(v.lastSync) : "";

  $("pairForm").hidden = v.form !== "pair";
  $("trackerField").hidden = !v.showTrackerSelect;
  setButton(
    $("pair"),
    t(v.state === "tracker-revoked" ? "actionReconnect" : "actionConnect"),
    "pair",
  );
  $("cfnForm").hidden = v.form !== "cfn";
  setButton($("saveCfn"), t("actionSaveCfn"), "cfn");

  const primary = $<HTMLButtonElement>("primary");
  setButton(
    primary,
    v.primary ? tm(v.primary.label) : "",
    v.primary ? busyOf(v.primary.action) : null,
    v.primary !== null,
  );
  primary.dataset.action = v.primary?.action ?? "";
  const secondary = $<HTMLButtonElement>("secondary");
  setButton(
    secondary,
    v.secondary ? tm(v.secondary.label) : "",
    v.secondary ? busyOf(v.secondary.action) : null,
    v.secondary !== null,
  );
  secondary.dataset.action = v.secondary?.action ?? "";

  $("session").hidden = v.session === null;
  if (v.session) {
    $("session").dataset.active = String(v.session.active);
    $("sessionState").textContent = t(v.session.active ? "sessionActive" : "sessionInactive");
    $("sessionGuidance").textContent = tm(v.session.guidance);
    $("lastMatch").textContent = tm(v.session.lastMatch);
  }
  setText("closing", v.closing);
  setButton($("sync"), `↻ ${t("actionSyncNow")}`, "sync", v.showSync);

  $("diagnostics").hidden = v.diagnostics === null;
  renderDiagnostics(v);
  setButton($("test"), t("actionTestConnection"), "test", v.showDiagTest);
  setButton($("copy"), t("actionCopyDiagnostics"), null);
  setButton($("disconnect"), t("actionDisconnect"), "disconnect");
  // Exhaustive per-transport lines stay a debug-build feature (unchanged policy).
  const debugPre = $("debugTest");
  debugPre.hidden = !(COMPANION_DEBUG && status.lastTest);
  debugPre.textContent =
    COMPANION_DEBUG && status.lastTest
      ? summarizeConnectionTest(status.lastTest, t, true).join("\n")
      : "";
}

/** Worker error codes → human text. Unknown codes are generic unless this is a debug build. */
function describeError(code: string): string {
  if (code.startsWith("tracker_unreachable:")) return t("errTrackerUnreachable");
  const known: Record<string, string> = {
    tracker_origin_not_allowed: "errOriginNotAllowed",
    invalid_or_expired_code: "errInvalidCode",
    invalid_request: "errInvalidCode",
    rate_limited: "errRateLimited",
    cfn_required: "errCfnRequired",
    invalid_cfn: "errInvalidCfn",
  };
  const key = known[code];
  if (key) return t(key);
  return COMPANION_DEBUG ? t("error", [code]) : t("errGeneric");
}

function say(text: string) {
  $("message").textContent = text;
}

async function run(action: BusyAction, msg: CompanionRequest) {
  if (busy) return;
  busy = action;
  say("");
  render();
  try {
    const res = await send(msg);
    if (res.status) status = res.status;
    if (!res.ok) say(describeError(res.error));
  } catch {
    say(t("errGeneric"));
  } finally {
    busy = null;
    render();
  }
}

function openTab(url: string | null) {
  // chrome.tabs.create needs no "tabs" permission; URLs are the allow-listed tracker or Buckler.
  if (url) void chrome.tabs.create({ url });
}

function perform(action: string | undefined) {
  if (!status) return;
  switch (action) {
    case "openSst":
      openTab(sstUrl(status.trackerUrl, TRACKER_ORIGINS));
      break;
    case "openBuckler":
      openTab(BUCKLER_URL);
      break;
    case "test":
      void run("test", { type: "testBuckler" });
      break;
    case "sync":
      void run("sync", { type: "syncNow" });
      break;
  }
}

/* ── wiring ── */
const select = $<HTMLSelectElement>("trackerUrl");
for (const origin of TRACKER_ORIGINS) {
  const option = document.createElement("option");
  option.value = origin;
  option.textContent = origin;
  select.append(option);
}
$<HTMLInputElement>("deviceName").value = t("defaultDeviceName");

$("pairForm").addEventListener("submit", (e) => {
  e.preventDefault();
  // A single allowed origin is used directly (no visible URL picker).
  const trackerUrl = TRACKER_ORIGINS.length > 1 ? select.value : (TRACKER_ORIGINS[0] ?? "");
  void run("pair", {
    type: "pair",
    trackerUrl,
    code: $<HTMLInputElement>("code").value,
    deviceName: $<HTMLInputElement>("deviceName").value,
  });
});
$("cfnForm").addEventListener("submit", (e) => {
  e.preventDefault();
  void run("cfn", { type: "setCfn", cfnUserId: $<HTMLInputElement>("cfnInput").value });
});
$("primary").addEventListener("click", () => perform($("primary").dataset.action));
$("secondary").addEventListener("click", () => perform($("secondary").dataset.action));
$("sync").addEventListener("click", () => perform("sync"));
$("test").addEventListener("click", () => perform("test"));
$("disconnect").addEventListener("click", () => void run("disconnect", { type: "disconnect" }));
$("copy").addEventListener("click", () => {
  if (!view) return;
  navigator.clipboard
    .writeText(diagnosticsText(view, VERSION, t))
    .then(() => say(t("diagCopied")))
    .catch(() => say(t("diagCopyFailed")));
});

void send({ type: "status" }).then((res) => {
  if (!res.status) return;
  status = res.status;
  if (TRACKER_ORIGINS.includes(status.trackerUrl)) select.value = status.trackerUrl;
  render();
});
// Keep relative times fresh while the popup is open (presentation only; no requests).
setInterval(render, 15_000);
