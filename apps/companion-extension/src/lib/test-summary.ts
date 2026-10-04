/**
 * Human summary of a Buckler connection test. Pure (the popup passes its translator).
 * Normal: verdict, transport, counts, locale — or one short reason. Debug: + technical lines
 * (all safe: status codes, key NAMES, sizes, request modes — never bodies, cookies or tokens).
 */
import type { ConnectionTestReport, TransportTestResult } from "./storage";

type Translate = (key: string, subs?: string[]) => string;

/** Most actionable failure first. */
const REASON_PRIORITY: Array<[string, string]> = [
  ["rate_limited", "testReasonRateLimited"],
  ["login_required", "testReasonLogin"],
  ["no_tab", "testReasonTab"],
  ["blocked", "testReasonUnavailable"],
  ["unavailable", "testReasonUnavailable"],
  ["not_found", "testReasonUnavailable"],
  ["locale_mismatch", "testReasonInvalid"],
  ["invalid_response", "testReasonInvalid"],
];

export function failureReasonKey(results: readonly TransportTestResult[]): string {
  const failures = new Set(results.map((r) => r.failure).filter((f): f is string => Boolean(f)));
  for (const [failure, key] of REASON_PRIORITY) if (failures.has(failure)) return key;
  return "testReasonInvalid";
}

function technicalLines(r: TransportTestResult): string[] {
  const lines = [
    `${r.transport}: buildId ${r.buildId} · play ${r.play} · battlelog ${r.battlelog}` +
      (r.failure ? ` — ${r.failure}${r.status ? ` ${r.status}` : ""}` : "") +
      (r.pageLocale ? ` · locale ${r.pageLocale}` : "") +
      (r.requestLocale && r.requestLocale !== r.pageLocale ? `→${r.requestLocale}` : "") +
      (r.notes.length ? ` · ${r.notes.join(" ")}` : ""),
  ];
  if (r.request) {
    lines.push(
      `  ↳ req ${r.request.method} ${r.request.path} x-nextjs-data=${String(r.request.xNextjsData)}` +
        ` credentials=${r.request.credentials ?? "?"} cache=${r.request.cache ?? "?"}` +
        ` referer=${r.request.refererPath ?? "n/a"} browser=${r.request.brands.join("/") || "?"}`,
    );
  }
  const s = r.signature;
  if (s) {
    lines.push(
      `  ↳ ${s.contentType ?? "?"} ${s.bytes}B` +
        (s.json ? ` pageProps[${s.pagePropsKeys.join(",")}]` : "") +
        (s.redirectPath ? ` redirect ${s.redirectPath}` : "") +
        (s.hasNextData ? ` app-page ${s.nextPage ?? ""}` : ""),
    );
    if (Object.keys(s.pagePropsSizes).length) {
      lines.push(
        `  ↳ sizes ${Object.entries(s.pagePropsSizes)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      );
    }
    if (s.common) {
      lines.push(
        `  ↳ common statusCode=${String(s.common.statusCode)} isError=${String(s.common.isError)}` +
          ` loginUser.flg=${String(s.common.loginUserFlg)}`,
      );
    }
  }
  return lines;
}

export function summarizeConnectionTest(
  report: ConnectionTestReport,
  t: Translate,
  debug = false,
): string[] {
  const lines: string[] = [];
  const winner = report.results.find((r) => r.transport === report.preferred);
  if (report.verdict === "PASS" && winner) {
    lines.push(t("testPass"));
    lines.push(t("testMode", [winner.transport]));
    if (winner.characters !== null) lines.push(t("testCharacters", [String(winner.characters)]));
    if (winner.replays !== null) lines.push(t("testReplays", [String(winner.replays)]));
    const locale = winner.requestLocale ?? winner.pageLocale;
    if (locale) lines.push(t("testLocale", [locale]));
  } else {
    lines.push(t("testFail"));
    lines.push(t(failureReasonKey(report.results)));
  }
  if (debug) {
    lines.push("", "— debug —", ...report.results.flatMap(technicalLines));
  }
  return lines;
}
