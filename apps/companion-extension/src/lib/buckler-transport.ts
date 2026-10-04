/**
 * Three ways to reach Buckler from the user's NORMAL browser — none reads or forwards cookies;
 * the browser attaches its own session to the request like any page navigation would.
 *
 *   service_worker  fetch() from the extension service worker (host permission, credentials:include)
 *   isolated_tab    chrome.scripting in an open Buckler tab, ISOLATED world (content-script fetch)
 *   main_tab        chrome.scripting in an open Buckler tab, MAIN world (the page's own fetch)
 *
 * Which one works is decided by the in-browser connection test, never assumed. If one is refused,
 * it is NOT disguised — the next legitimate context is tried instead.
 */
import { BUCKLER_ORIGIN, type CompanionTransportKind } from "@sf6/capcom-core";

export const BUCKLER_TAB_PATTERN = `${BUCKLER_ORIGIN}/6/buckler/*`;

/** What was actually sent — safe metadata only (no cookie/token values, ever). */
export interface SentRequestMeta {
  credentials: RequestCredentials;
  cache: RequestCache;
  headerNames: string[];
  /** Page path the browser uses as Referer (tab transports); null in the service worker. */
  refererPath: string | null;
  /** navigator.userAgentData brands (e.g. "Brave", "Google Chrome") — which browser/session. */
  brands: string[];
}

export interface RawResponse {
  status: number;
  contentType: string | null;
  text: string;
  sent?: SentRequestMeta;
}

export interface PageMetaRaw {
  /** JSON of {buildId, locale, defaultLocale, locales} only. */
  nextData: string | null;
  pathname: string;
}

export interface BucklerTransport {
  readonly kind: CompanionTransportKind;
  /** GET a same-origin Buckler path ("/6/buckler/..."), optionally with request headers. */
  fetchText(path: string, headers?: Record<string, string>): Promise<RawResponse>;
  /**
   * Next.js metadata of the OPEN Buckler page, without a request (tab transports): only
   * {buildId, locale, defaultLocale, locales} + location.pathname — never the full __NEXT_DATA__.
   */
  readPageMeta?(): Promise<PageMetaRaw | null>;
}

export class NoBucklerTabError extends Error {
  override readonly name = "NoBucklerTabError";
  constructor() {
    super("No open Buckler's Boot Camp tab");
  }
}

export function serviceWorkerTransport(fetchImpl: typeof fetch = fetch): BucklerTransport {
  return {
    kind: "service_worker",
    async fetchText(path, headers = {}) {
      const res = await fetchImpl(`${BUCKLER_ORIGIN}${path}`, {
        headers,
        credentials: "include",
        cache: "no-store",
      });
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        text: await res.text(),
        sent: {
          credentials: "include",
          cache: "no-store",
          headerNames: Object.keys(headers),
          refererPath: null,
          brands: workerBrands(),
        },
      };
    },
  };
}

function workerBrands(): string[] {
  const uaData = (
    globalThis.navigator as
      (Navigator & { userAgentData?: { brands?: { brand: string }[] } }) | undefined
  )?.userAgentData;
  return (uaData?.brands ?? []).map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b));
}

/* Injected functions: serialized by chrome.scripting, so they must be self-contained. They
   only fetch the requested same-origin path / read the buildId; no document.cookie, no storage. */

async function pageFetchText(path: string, headers: Record<string, string>): Promise<RawResponse> {
  const res = await fetch(path, { headers, credentials: "same-origin", cache: "no-store" });
  const uaData = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
    .userAgentData;
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    text: await res.text(),
    sent: {
      credentials: "same-origin",
      cache: "no-store",
      headerNames: Object.keys(headers),
      refererPath: location.pathname,
      brands: (uaData?.brands ?? []).map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b)),
    },
  };
}

function pageReadMeta(): PageMetaRaw {
  const el = document.getElementById("__NEXT_DATA__");
  let nextData: string | null = null;
  if (el?.textContent) {
    try {
      const d = JSON.parse(el.textContent) as Record<string, unknown>;
      nextData = JSON.stringify({
        buildId: d.buildId,
        locale: d.locale,
        defaultLocale: d.defaultLocale,
        locales: d.locales,
      });
    } catch {
      nextData = null;
    }
  }
  return { nextData, pathname: location.pathname };
}

/** The subset of chrome.* the tab transports use (injectable for tests). */
export interface TabApi {
  queryBucklerTabs(): Promise<{ id?: number }[]>;
  execute<A extends unknown[], R>(
    tabId: number,
    world: "ISOLATED" | "MAIN",
    func: (...args: A) => R | Promise<R>,
    args: A,
  ): Promise<R | undefined>;
}

export const chromeTabApi: TabApi = {
  queryBucklerTabs: () => chrome.tabs.query({ url: BUCKLER_TAB_PATTERN }),
  async execute(tabId, world, func, args) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world,
      func,
      args,
    });
    return result?.result as Awaited<ReturnType<typeof func>> | undefined;
  },
};

export function tabTransport(
  world: "ISOLATED" | "MAIN",
  api: TabApi = chromeTabApi,
): BucklerTransport {
  const tabId = async () => {
    const tab = (await api.queryBucklerTabs()).find((t) => typeof t.id === "number");
    if (tab?.id === undefined) throw new NoBucklerTabError();
    return tab.id;
  };
  return {
    kind: world === "MAIN" ? "main_tab" : "isolated_tab",
    async fetchText(path, headers = {}) {
      const result = await api.execute(await tabId(), world, pageFetchText, [path, headers]);
      if (!result) throw new Error("injected fetch returned nothing");
      return result;
    },
    async readPageMeta() {
      return (await api.execute(await tabId(), world, pageReadMeta, [])) ?? null;
    },
  };
}

export function transportFor(kind: CompanionTransportKind): BucklerTransport {
  switch (kind) {
    case "service_worker":
      return serviceWorkerTransport();
    case "isolated_tab":
      return tabTransport("ISOLATED");
    case "main_tab":
      return tabTransport("MAIN");
  }
}
