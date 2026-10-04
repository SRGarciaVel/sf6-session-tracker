/** Minimal popup: status + pairing + test/sync/disconnect. All work happens in the worker. */
import type { CompanionRequest, CompanionResponse, PublicStatus } from "../lib/messages";
import { COMPANION_DEBUG } from "../lib/debug";
import { summarizeConnectionTest } from "../lib/test-summary";
import { TRACKER_ORIGINS } from "../lib/tracker-origins";

const t = (key: string, subs?: string[]) => chrome.i18n.getMessage(key, subs) || key;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
  el.textContent = t(el.dataset.i18n ?? "");
}

const send = (msg: CompanionRequest) =>
  chrome.runtime.sendMessage<CompanionRequest, CompanionResponse>(msg);

function ago(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return t("secondsAgo", [String(s)]);
  if (s < 3600) return t("minutesAgo", [String(Math.round(s / 60))]);
  return t("hoursAgo", [String(Math.round(s / 3600))]);
}

function dot(el: HTMLElement, level: "ok" | "warn" | "bad", text: string) {
  el.className = `dot ${level}`;
  el.textContent = text;
}

function render(s: PublicStatus) {
  const tracker =
    s.trackerStatus === "connected"
      ? (["ok", t("connected")] as const)
      : s.trackerStatus === "unpaired"
        ? (["warn", t("notPaired")] as const)
        : s.trackerStatus === "revoked"
          ? (["bad", t("revoked")] as const)
          : (["bad", t("trackerDisconnected")] as const);
  dot($("tracker"), tracker[0], tracker[1]);

  const b = s.bucklerStatus;
  const buckler =
    b === "ok"
      ? (["ok", t("loggedIn")] as const)
      : b === "login_required"
        ? (["bad", t("loginRequired")] as const)
        : b === "no_tab"
          ? (["warn", t("openBucklerTab")] as const)
          : b === "unknown"
            ? (["warn", s.transport ? t("unknown") : t("runTest")] as const)
            : (["bad", t(`buckler_${b}`)] as const);
  dot($("buckler"), buckler[0], buckler[1]);

  $("cfn").textContent = s.lastState?.cfnUserId ?? s.manualCfnUserId ?? "—";
  const active = s.lastState?.activeSession;
  dot($("session"), active ? "ok" : "warn", active ? t("active") : t("noActiveSession"));
  $("lastMatch").textContent = ago(s.lastMatchAt);
  $("lastSync").textContent = ago(s.lastSyncAt);

  $("pairSection").hidden = s.paired;
  $("actions").hidden = !s.paired;
  $("cfnSection").hidden = !s.paired || Boolean(s.lastState?.cfnUserId);
  const select = $<HTMLSelectElement>("trackerUrl");
  if (TRACKER_ORIGINS.includes(s.trackerUrl)) select.value = s.trackerUrl;
  // Raw error codes are technical: status dots already say it; codes only in debug builds.
  $("message").textContent = COMPANION_DEBUG && s.lastError ? t("lastError", [s.lastError]) : "";
  if (s.lastTest) {
    $("testResult").hidden = false;
    $("testResult").textContent = summarizeConnectionTest(s.lastTest, t, COMPANION_DEBUG).join(
      "\n",
    );
  }
}

/** Error codes from the worker → readable text (unknown codes shown raw). */
function describeError(code: string): string {
  if (code.startsWith("tracker_unreachable:")) {
    return t("errTrackerUnreachable", [code.slice("tracker_unreachable:".length)]);
  }
  const known: Record<string, string> = {
    tracker_origin_not_allowed: "errOriginNotAllowed",
    invalid_or_expired_code: "errInvalidCode",
    invalid_request: "errInvalidCode",
    rate_limited: "errRateLimited",
    cfn_required: "errCfnRequired",
    invalid_cfn: "errInvalidCfn",
  };
  const key = known[code];
  return key ? t(key) : t("error", [code]);
}

async function run(button: HTMLButtonElement, msg: CompanionRequest) {
  button.disabled = true;
  try {
    const res = await send(msg);
    if (res.status) render(res.status);
    if (!res.ok) $("message").textContent = describeError(res.error);
  } finally {
    button.disabled = false;
  }
}

for (const origin of TRACKER_ORIGINS) {
  const option = document.createElement("option");
  option.value = origin;
  option.textContent = origin;
  $<HTMLSelectElement>("trackerUrl").append(option);
}
$<HTMLInputElement>("deviceName").value = t("defaultDeviceName");
$("pair").addEventListener("click", () =>
  run($("pair"), {
    type: "pair",
    trackerUrl: $<HTMLSelectElement>("trackerUrl").value,
    code: $<HTMLInputElement>("code").value,
    deviceName: $<HTMLInputElement>("deviceName").value,
  }),
);
$("saveCfn").addEventListener("click", () =>
  run($("saveCfn"), { type: "setCfn", cfnUserId: $<HTMLInputElement>("cfnInput").value }),
);
$("test").addEventListener("click", () => run($("test"), { type: "testBuckler" }));
$("sync").addEventListener("click", () => run($("sync"), { type: "syncNow" }));
$("disconnect").addEventListener("click", () => run($("disconnect"), { type: "disconnect" }));

void send({ type: "status" }).then((res) => {
  if (res.status) render(res.status);
});
