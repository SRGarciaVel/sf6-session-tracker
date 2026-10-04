/**
 * Buckler data access over any transport.
 *
 * Page metadata (buildId + LOCALE) comes from the open Buckler page (tab transports) or from the
 * profile HTML (service worker); it is cached, and on a _next/data 404 invalidated, rediscovered
 * and retried exactly ONCE. `_next/data` URLs use the page's locale (e.g. es-es) — the HAR's
 * "/en/" was only the locale of that capture. If the page locale is refused as a locale
 * mismatch, `en` (Buckler's default locale) is tried once; nothing else. 403 / 429 /
 * login-required stop immediately.
 */
import {
  BUCKLER_DEFAULT_LOCALE,
  TtlCache,
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

export class BucklerError extends Error {
  override readonly name = "BucklerError";
  constructor(
    readonly kind: BucklerFailure | "no_tab",
    readonly status: number | null,
    message: string,
    /** Safe description of the failing answer (no body, no values). */
    readonly signature: BucklerResponseSignature | null = null,
    readonly locale: string | null = null,
  ) {
    super(message);
  }
}

const META_TTL_MS = 30 * 60_000;

export class CompanionBucklerClient {
  readonly meta: TtlCache<BucklerPageMeta>;
  /** Locale that last answered successfully (diagnostics). */
  effectiveLocale: string | null = null;

  constructor(
    readonly transport: BucklerTransport,
    options: { now?: () => number; meta?: TtlCache<BucklerPageMeta> } = {},
  ) {
    this.meta = options.meta ?? new TtlCache<BucklerPageMeta>(META_TTL_MS, options.now);
  }

  private async fetchText(path: string) {
    try {
      return await this.transport.fetchText(path);
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

  private async nextData(
    cfnId: string,
    pathFor: (buildId: string, locale: string) => string,
  ): Promise<unknown> {
    let staleRetried = false;
    let localeOverride: string | null = null;
    for (;;) {
      const meta = await this.getPageMeta(cfnId);
      const locale: string = localeOverride ?? meta.locale;
      const res = await this.fetchText(pathFor(meta.buildId, locale));
      const sig = describeBucklerResponse(res.status, res.contentType, res.text);
      if (res.status === 200 && sig.json && sig.redirectPath === null) {
        this.effectiveLocale = locale;
        return JSON.parse(res.text) as unknown;
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
      );
    }
  }

  getPlay(cfnId: string): Promise<unknown> {
    return this.nextData(cfnId, (b, l) => bucklerPaths.play(b, cfnId, l));
  }

  getBattlelogPage(cfnId: string, page: number): Promise<unknown> {
    return this.nextData(cfnId, (b, l) => bucklerPaths.battlelog(b, cfnId, page, l));
  }
}
