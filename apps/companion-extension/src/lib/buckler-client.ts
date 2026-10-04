/**
 * Buckler data access over any transport.
 *
 * Page metadata (buildId + LOCALE) comes from the open Buckler page (tab transports) or from the
 * profile HTML (service worker); it is cached, and on a _next/data 404 invalidated, rediscovered
 * and retried exactly ONCE. `_next/data` URLs use the page's locale (e.g. es-es) — the HAR's
 * "/en/" was only the locale of that capture. If the page locale is refused as a locale
 * mismatch, `en` (Buckler's default locale) is tried once; nothing else. 403 / 429 /
 * login-required stop immediately.
 *
 * Requests carry `x-nextjs-data: 1`, exactly like Buckler's own Next.js router (HAR).
 */
import {
  BUCKLER_DEFAULT_LOCALE,
  NEXT_DATA_REQUEST_HEADERS,
  TtlCache,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  replaySchema,
  bucklerPaths,
  classifyBucklerFailure,
  describeBucklerResponse,
  extractPageMeta,
  pageMetaFromNextData,
  type BucklerFailure,
  type BucklerPageMeta,
  type BucklerResponseSignature,
} from "@sf6/capcom-core";
import { NoBucklerTabError, type BucklerTransport } from "./buckler-transport";

/** Safe description of the REQUEST the companion sent (no cookie/token values). */
export interface CompanionRequestMeta {
  method: "GET";
  /** pathname + query exactly as requested. */
  path: string;
  transport: string;
  locale: string;
  xNextjsData: boolean;
  credentials: string | null;
  cache: string | null;
  /** Page path the browser sends as Referer (tab transports); null if not observable. */
  refererPath: string | null;
  /** Browser running the extension (navigator.userAgentData brands). */
  brands: string[];
}

export class BucklerError extends Error {
  override readonly name = "BucklerError";
  constructor(
    readonly kind: BucklerFailure | "no_tab",
    readonly status: number | null,
    message: string,
    /** Safe description of the failing answer (no body, no values). */
    readonly signature: BucklerResponseSignature | null = null,
    readonly locale: string | null = null,
    readonly request: CompanionRequestMeta | null = null,
  ) {
    super(message);
  }
}

const META_TTL_MS = 30 * 60_000;

export class CompanionBucklerClient {
  readonly meta: TtlCache<BucklerPageMeta>;
  /** Locale that last answered successfully (diagnostics). */
  effectiveLocale: string | null = null;
  /** Metadata of the last _next/data request sent (diagnostics). */
  lastRequest: CompanionRequestMeta | null = null;

  constructor(
    readonly transport: BucklerTransport,
    options: {
      now?: () => number;
      meta?: TtlCache<BucklerPageMeta>;
      /** Safe structured warnings (never bodies). */
      onWarning?: (event: string, fields: Record<string, unknown>) => void;
    } = {},
  ) {
    this.meta = options.meta ?? new TtlCache<BucklerPageMeta>(META_TTL_MS, options.now);
    this.onWarning = options.onWarning ?? (() => undefined);
  }

  private readonly onWarning: (event: string, fields: Record<string, unknown>) => void;

  private async fetchText(path: string, headers?: Record<string, string>) {
    try {
      return await this.transport.fetchText(path, headers);
    } catch (err) {
      if (err instanceof NoBucklerTabError) throw new BucklerError("no_tab", null, err.message);
      throw new BucklerError("unavailable", null, err instanceof Error ? err.message : String(err));
    }
  }

  getPageMeta(cfnId: string): Promise<BucklerPageMeta> {
    return this.meta.get(async () => {
      const raw = await this.transport.readPageMeta?.().catch((err: unknown) => {
        if (err instanceof NoBucklerTabError) throw new BucklerError("no_tab", null, err.message);
        return null;
      });
      const fromPage = raw?.nextData ? pageMetaFromNextData(raw.nextData, raw.pathname) : null;
      if (fromPage) return fromPage;
      // Service worker: the profile page without locale prefix; the server answers in the
      // user's locale (its __NEXT_DATA__.locale tells which).
      const res = await this.fetchText(bucklerPaths.profile(cfnId));
      const meta = extractPageMeta(res.text);
      if (meta) return meta;
      const sig = describeBucklerResponse(res.status, res.contentType, res.text);
      throw new BucklerError(
        classifyBucklerFailure(sig),
        res.status,
        `page metadata not found (HTTP ${res.status})`,
        sig,
      );
    });
  }

  /** Kept for callers/tests that only need the buildId. */
  async getBuildId(cfnId: string): Promise<string> {
    return (await this.getPageMeta(cfnId)).buildId;
  }

  /**
   * Fetch + structurally validate a `_next/data` endpoint.
   *
   * Acceptance rule: 200 → must pass the endpoint schema. 400 → accepted ONLY if the body passes
   * the same schema (logged as buckler_non_200_valid_payload); otherwise classified. 401 / 403 /
   * 429 / 5xx and every other status are never accepted, whatever the body.
   */
  private async nextData(
    cfnId: string,
    endpoint: "play" | "battlelog",
    pathFor: (buildId: string, locale: string) => string,
    isValid: (data: unknown) => boolean,
  ): Promise<unknown> {
    let staleRetried = false;
    let localeOverride: string | null = null;
    for (;;) {
      const meta = await this.getPageMeta(cfnId);
      const locale: string = localeOverride ?? meta.locale;
      const path = pathFor(meta.buildId, locale);
      const headers = { ...NEXT_DATA_REQUEST_HEADERS };
      const res = await this.fetchText(path, headers);
      this.lastRequest = {
        method: "GET",
        path,
        transport: this.transport.kind,
        locale,
        xNextjsData: (res.sent?.headerNames ?? Object.keys(headers)).includes("x-nextjs-data"),
        credentials: res.sent?.credentials ?? null,
        cache: res.sent?.cache ?? null,
        refererPath: res.sent?.refererPath ?? null,
        brands: res.sent?.brands ?? [],
      };
      const sig = describeBucklerResponse(res.status, res.contentType, res.text);

      if ((res.status === 200 || res.status === 400) && sig.json && sig.redirectPath === null) {
        const data = JSON.parse(res.text) as unknown;
        if (isValid(data)) {
          if (res.status !== 200) {
            this.onWarning("buckler_non_200_valid_payload", {
              status: res.status,
              endpoint,
              transport: this.transport.kind,
              locale,
            });
          }
          this.effectiveLocale = locale;
          return data;
        }
        if (res.status === 200) {
          throw new BucklerError(
            "invalid_response",
            200,
            `${endpoint}: 200 but the payload does not match the schema`,
            sig,
            locale,
            this.lastRequest,
          );
        }
      }

      const failure = classifyBucklerFailure(sig, {
        requestedLocale: locale,
        pageLocale: meta.locale,
      });
      if (failure === "not_found" && !staleRetried) {
        staleRetried = true;
        this.meta.invalidate(); // stale buildId after a Capcom deploy
        continue;
      }
      if (
        failure === "locale_mismatch" &&
        localeOverride === null &&
        locale !== BUCKLER_DEFAULT_LOCALE
      ) {
        localeOverride = BUCKLER_DEFAULT_LOCALE; // single documented fallback: Buckler's default
        continue;
      }
      throw new BucklerError(
        failure,
        res.status,
        `Buckler answered HTTP ${res.status} (${failure})`,
        sig,
        locale,
        this.lastRequest,
      );
    }
  }

  getPlay(cfnId: string): Promise<unknown> {
    return this.nextData(
      cfnId,
      "play",
      (b, l) => bucklerPaths.play(b, cfnId, l),
      (data) => {
        try {
          return String(parseCapcomPlayPayload(data).sid) === cfnId;
        } catch {
          return false;
        }
      },
    );
  }

  getBattlelogPage(cfnId: string, page: number): Promise<unknown> {
    return this.nextData(
      cfnId,
      "battlelog",
      (b, l) => bucklerPaths.battlelog(b, cfnId, page, l),
      (data) => {
        try {
          const parsed = parseCapcomBattlelogPayload(data);
          // Envelope + every replay must match the schema (no silently empty "success").
          return (
            parsed.cfnUserId === cfnId &&
            parsed.replays.every((r) => replaySchema.safeParse(r).success)
          );
        } catch {
          return false;
        }
      },
    );
  }
}
