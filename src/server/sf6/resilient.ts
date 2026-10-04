/**
 * Decorator applied to every provider: timeout, single-flight, short TTL cache and output
 * validation. Keeps the real extractor simple and protects Capcom from duplicate requests
 * (e.g. dashboard lookup + worker poll for the same player at the same moment).
 */
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import { logger } from "@/server/logger";
import {
  SF6ProviderError,
  normalizedMatchSchema,
  normalizedProfileSchema,
  type ProviderCallOptions,
  type SF6DataProvider,
} from "./provider";

/** Scope part of cache / single-flight keys: data of one account is never served to another. */
const scopeKey = (options: Pick<ProviderCallOptions, "scope">) => options.scope?.userId ?? "-";

export interface ResilientOptions {
  timeoutMs: number;
  cacheTtlMs: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResilientProvider implements SF6DataProvider {
  readonly name: string;
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly log = logger.child({ component: "sf6-provider" });

  constructor(
    private readonly inner: SF6DataProvider,
    private readonly options: ResilientOptions,
  ) {
    this.name = inner.name;
  }

  getPlayerProfile(
    cfnUserId: string,
    options: Pick<ProviderCallOptions, "scope"> = {},
  ): Promise<NormalizedPlayerProfile> {
    return this.run(`profile:${scopeKey(options)}:${cfnUserId}`, true, async (signal) => {
      const raw = await this.inner.getPlayerProfile(cfnUserId, { signal, scope: options.scope });
      const parsed = normalizedProfileSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SF6ProviderError("invalid_response", "Provider returned an invalid profile", {
          cause: parsed.error,
        });
      }
      return parsed.data;
    });
  }

  /** Single-flight but never cached: match lists are the freshness-critical data. */
  getRecentMatches(
    cfnUserId: string,
    options: Pick<ProviderCallOptions, "scope"> = {},
  ): Promise<NormalizedSF6Match[]> {
    return this.run(`matches:${scopeKey(options)}:${cfnUserId}`, false, async (signal) => {
      const raw = await this.inner.getRecentMatches(cfnUserId, { signal, scope: options.scope });
      if (!Array.isArray(raw)) {
        throw new SF6ProviderError("invalid_response", "Provider returned a non-array match list");
      }
      const valid: NormalizedSF6Match[] = [];
      for (const item of raw) {
        const parsed = normalizedMatchSchema.safeParse(item);
        if (parsed.success) valid.push(parsed.data);
        else this.log.warn("provider.match_invalid", { issues: parsed.error.issues.length });
      }
      return valid;
    });
  }

  /** Drop the cached profiles of a CFN (every scope). */
  invalidate(cfnUserId: string): void {
    for (const key of this.cache.keys()) if (key.endsWith(`:${cfnUserId}`)) this.cache.delete(key);
  }

  private async run<T>(
    key: string,
    cacheable: boolean,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const cached = cacheable ? this.cache.get(key) : undefined;
    if (cached && cached.expiresAt > Date.now()) return cached.value as T;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = this.withTimeout(fn)
      .then((value) => {
        if (cacheable && this.options.cacheTtlMs > 0) {
          this.cache.set(key, { value, expiresAt: Date.now() + this.options.cacheTtlMs });
          this.pruneCache();
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new SF6ProviderError("timeout", `Provider timed out after ${this.options.timeoutMs}ms`),
        );
      }, this.options.timeoutMs);
    });
    try {
      return await Promise.race([fn(controller.signal), timeout]);
    } catch (err) {
      if (err instanceof SF6ProviderError) throw err;
      throw new SF6ProviderError("unavailable", "Provider request failed", { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  private pruneCache(): void {
    if (this.cache.size < 1_000) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) if (entry.expiresAt <= now) this.cache.delete(key);
  }
}
