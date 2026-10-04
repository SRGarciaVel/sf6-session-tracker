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

export interface RawResponse {
  status: number;
  contentType: string | null;
  text: string;
}

export interface BucklerTransport {
  readonly kind: CompanionTransportKind;
  /** GET a same-origin Buckler path ("/6/buckler/..."). */
  fetchText(path: string): Promise<RawResponse>;
  /** buildId without a request when a Buckler page is already open (tab transports). */
  readBuildIdFromPage?(): Promise<string | null>;
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
    async fetchText(path) {
      const res = await fetchImpl(`${BUCKLER_ORIGIN}${path}`, {
        credentials: "include",
        cache: "no-store",
      });
      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        text: await res.text(),
      };
    },
  };
}

/* Injected functions: serialized by chrome.scripting, so they must be self-contained. They
   only fetch the requested same-origin path / read the buildId; no document.cookie, no storage. */

async function pageFetchText(path: string): Promise<RawResponse> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    text: await res.text(),
  };
}

function pageReadBuildId(): string | null {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el?.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as { buildId?: unknown };
    return typeof data.buildId === "string" ? data.buildId : null;
  } catch {
    return null;
  }
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
    async fetchText(path) {
      const result = await api.execute(await tabId(), world, pageFetchText, [path]);
      if (!result) throw new Error("injected fetch returned nothing");
      return result;
    },
    async readBuildIdFromPage() {
      return (await api.execute(await tabId(), world, pageReadBuildId, [])) ?? null;
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
