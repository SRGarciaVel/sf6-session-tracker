/** Minimal popup: status + pairing + test/sync/disconnect. All work happens in the worker. */
import type { CompanionRequest, CompanionResponse, PublicStatus } from "../lib/messages";
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
  $("message").textContent = s.lastError ? t("lastError", [s.lastError]) : "";
  if (s.lastTest) {
    $("testResult").hidden = false;
    $("testResult").textContent = [
      `${t("testVerdict")}: ${s.lastTest.verdict}${s.lastTest.preferred ? ` (${s.lastTest.preferred})` : ""}`,
      ...s.lastTest.results.map(
        (r) =>
          `${r.transport}: buildId ${r.buildId} · play ${r.play} · battlelog ${r.battlelog}` +
          (r.failure ? ` — ${r.failure}${r.status ? ` ${r.status}` : ""}` : "") +
          (r.characters !== null ? ` · ${r.characters} chars` : "") +
          (r.replays !== null ? ` · ${r.replays} replays` : "") +
          (r.notes?.length ? ` · ${r.notes.join(" ")}` : "") +
          (r.pageLocale
            ? ` · locale ${r.pageLocale}${r.requestLocale && r.requestLocale !== r.pageLocale ? `→${r.requestLocale}` : ""}`
            : "") +
          (r.request
            ? `\n    ↳ req ${r.request.method} ${r.request.path} [${r.request.transport}] x-nextjs-data=${String(r.request.xNextjsData)} credentials=${r.request.credentials ?? "?"} cache=${r.request.cache ?? "?"} referer=${r.request.refererPath ?? "n/a"} browser=${r.request.brands.join("/") || "?"}`
            : "") +
          (r.signature
            ? `\n    ↳ ${r.signature.contentType ?? "?"} ${r.signature.bytes}B` +
              (r.signature.json
                ? ` keys[${r.signature.keys.join(",")}] pageProps[${r.signature.pagePropsKeys.join(",")}]`
                : "") +
              (Object.keys(r.signature.pagePropsSizes ?? {}).length
                ? `\n    ↳ sizes ${Object.entries(r.signature.pagePropsSizes)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" ")}`
                : "") +
              (r.signature.nestedKeys?.play
                ? `\n    ↳ play[${r.signature.nestedKeys.play.join(",")}]`
                : "") +
              (Object.keys(r.signature.codes ?? {}).length
                ? `\n    ↳ codes ${Object.entries(r.signature.codes)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(" ")}`
                : "") +
              (r.signature.common
                ? `\n    ↳ common statusCode=${String(r.signature.common.statusCode)} isError=${String(r.signature.common.isError)} loginUser.flg=${String(r.signature.common.loginUserFlg)}`
                : "") +
              (r.signature.redirectPath ? ` redirect ${r.signature.redirectPath}` : "") +
              (r.signature.hasNextData ? ` app-page ${r.signature.nextPage ?? ""}` : "") +
              (r.signature.title ? ` "${r.signature.title}"` : "")
            : ""),
      ),
    ].join("\n");
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
