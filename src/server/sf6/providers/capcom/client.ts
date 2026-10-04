/**
 * CapcomBucklerClient — transport only (URLs, headers, cookies, buildId, timeouts, HTTP errors).
 * Returns parsed JSON; it never normalizes domain data (see ./parse.ts).
 *
 * Endpoints are exactly the ones observed in the manually captured HAR:
 *   GET {base}/profile/{cfnId}                                         (HTML, buildId discovery)
 *   GET {base}/api/en/card/{cfnId}
 *   GET {base}/_next/data/{buildId}/en/profile/{cfnId}/play.json?sid={cfnId}
 *   GET {base}/_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?sid={cfnId}
 *   GET {base}/_next/data/{buildId}/en/profile/{cfnId}/battlelog.json?page={n}&sid={cfnId}
 *
 * Plain requests: no browser impersonation, no fake User-Agent, no anti-bot evasion. Access from a
 * server has NOT been proven (automated probes got CloudFront 403) — see docs/capcom-provider.md.
 */
import type { Logger } from "@/server/logger";
import { SF6ProviderError } from "../../provider";
import { BuildIdCache, extractBuildId } from "./build-id";

export const DEFAULT_CAPCOM_BASE_URL = "https://www.streetfighter.com/6/buckler";
const USER_AGENT = "sf6-session-tracker (personal stats tool)";

export interface CapcomClientOptions {
  baseUrl?: string;
  /** Injected for tests / fixture mode. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** `cookie` header from a human-exported session. Secret — never logged. */
  cookieHeader?: string | null;
  timeoutMs?: number;
  buildIdTtlMs?: number;
  now?: () => number;
  logger?: Logger;
}

type RequestKind = "html" | "api" | "next-data";

/** Retry-After as seconds or HTTP date → ms. */
export function parseRetryAfter(
  value: string | null,
  nowMs: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

/** Path without query, for logs (the query only ever holds the public CFN id, but keep it short). */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "?";
  }
}

export class CapcomBucklerClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cookieHeader: string | null;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly logger: Logger | undefined;
  private readonly buildIds: BuildIdCache;

  constructor(options: CapcomClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_CAPCOM_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.cookieHeader = options.cookieHeader ?? null;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.buildIds = new BuildIdCache(options.buildIdTtlMs ?? 30 * 60_000, this.now);
  }

  get hasSession(): boolean {
    return this.cookieHeader !== null;
  }

  /* ───────── endpoints ───────── */

  getCard(cfnId: string, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(
      `${this.baseUrl}/api/en/card/${encodeURIComponent(cfnId)}`,
      "api",
      signal,
    );
  }

  getPlayData(cfnId: string, signal?: AbortSignal): Promise<unknown> {
    return this.nextData(
      cfnId,
      `en/profile/${encodeURIComponent(cfnId)}/play.json`,
      { sid: cfnId },
      signal,
    );
  }

  /** Page 1 is requested without `page` (as the site does); page N with `page=N`. */
  getBattlelogPage(cfnId: string, page: number, signal?: AbortSignal): Promise<unknown> {
    if (!Number.isInteger(page) || page < 1) throw new RangeError(`invalid battlelog page ${page}`);
    const query: Record<string, string> =
      page === 1 ? { sid: cfnId } : { page: String(page), sid: cfnId };
    return this.nextData(
      cfnId,
      `en/profile/${encodeURIComponent(cfnId)}/battlelog.json`,
      query,
      signal,
    );
  }

  /* ───────── buildId ───────── */

  getBuildId(cfnId: string, signal?: AbortSignal): Promise<string> {
    return this.buildIds.get(async () => {
      const html = await this.requestText(
        `${this.baseUrl}/profile/${encodeURIComponent(cfnId)}`,
        "html",
        signal,
      );
      const id = extractBuildId(html);
      if (!id) {
        throw new SF6ProviderError("invalid_response", "Could not discover the Buckler buildId");
      }
      this.logger?.info("capcom_build_id_discovered", { buildId: id });
      return id;
    });
  }

  invalidateBuildId(): void {
    this.buildIds.invalidate();
  }

  /**
   * `_next/data` request. A 404 usually means a stale buildId (Capcom deployed): invalidate,
   * rediscover and retry exactly ONCE. A second 404 is reported as not_found.
   */
  private async nextData(
    cfnId: string,
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    for (let attempt = 0; attempt < 2; attempt++) {
      const buildId = await this.getBuildId(cfnId, signal);
      const url = `${this.baseUrl}/_next/data/${encodeURIComponent(buildId)}/${path}?${qs}`;
      try {
        return await this.requestJson(url, "next-data", signal);
      } catch (err) {
        if (attempt === 0 && err instanceof SF6ProviderError && err.code === "not_found") {
          this.logger?.warn("capcom_build_id_stale", { buildId, path: pathOf(url) });
          this.invalidateBuildId();
          continue;
        }
        throw err;
      }
    }
    // Unreachable: the second iteration either returns or throws.
    throw new SF6ProviderError("not_found", "Buckler data not found");
  }

  /* ───────── HTTP ───────── */

  private headers(kind: RequestKind): Headers {
    const h = new Headers({
      accept: kind === "html" ? "text/html" : "application/json",
      "user-agent": USER_AGENT,
    });
    if (kind === "next-data") h.set("x-nextjs-data", "1"); // sent by the site itself (HAR)
    if (this.cookieHeader) h.set("cookie", this.cookieHeader);
    return h;
  }

  private async send(url: string, kind: RequestKind, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "GET",
        headers: this.headers(kind),
        redirect: "manual",
        signal: combined,
      });
    } catch (err) {
      if (combined.aborted) {
        throw new SF6ProviderError("timeout", `Buckler request timed out (${pathOf(url)})`, {
          cause: err,
        });
      }
      throw new SF6ProviderError("unavailable", `Buckler unreachable (${pathOf(url)})`, {
        cause: err,
      });
    }
    if (res.ok) return res;
    throw this.httpError(res, url);
  }

  private httpError(res: Response, url: string): SF6ProviderError {
    const path = pathOf(url);
    const status = res.status;
    if (status === 404) return new SF6ProviderError("not_found", `Buckler 404 (${path})`);
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), this.now());
      this.logger?.warn("provider_rate_limited", { path, status, retryAfterMs });
      return new SF6ProviderError("rate_limited", "Buckler rate limited the request (429)", {
        retryAfterMs,
      });
    }
    if (status === 403 || status === 401) {
      // NOT not_found: the player may exist; access was refused (WAF, expired session…).
      this.logger?.warn("provider_access_denied", {
        path,
        status,
        server: res.headers.get("server"),
        cache: res.headers.get("x-cache"),
        withSession: this.hasSession,
      });
      return new SF6ProviderError("unavailable", `Buckler denied access (${status})`);
    }
    if (status >= 300 && status < 400) {
      this.logger?.warn("provider_redirected", { path, status, withSession: this.hasSession });
      return new SF6ProviderError(
        "unavailable",
        `Buckler redirected (${status}) — session expired?`,
      );
    }
    return new SF6ProviderError("unavailable", `Buckler responded ${status} (${path})`);
  }

  private async requestText(url: string, kind: RequestKind, signal?: AbortSignal): Promise<string> {
    const res = await this.send(url, kind, signal);
    return res.text();
  }

  private async requestJson(
    url: string,
    kind: RequestKind,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const text = await this.requestText(url, kind, signal);
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      throw new SF6ProviderError("invalid_response", `Buckler returned non-JSON (${pathOf(url)})`, {
        cause: err,
      });
    }
  }
}
