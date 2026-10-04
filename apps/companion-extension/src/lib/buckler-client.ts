/**
 * Buckler data access over any transport, with the same buildId strategy as the server client:
 * read it from the page (tab) or the profile HTML, cache it, and on a _next/data 404 invalidate,
 * rediscover and retry exactly ONCE. No other retries: 403 / 429 / login-required stop here.
 */
import {
  BuildIdCache,
  bucklerPaths,
  classifyBucklerFailure,
  extractBuildId,
  type BucklerFailure,
} from "@sf6/capcom-core";
import { NoBucklerTabError, type BucklerTransport } from "./buckler-transport";

export class BucklerError extends Error {
  override readonly name = "BucklerError";
  constructor(
    readonly kind: BucklerFailure | "no_tab",
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

const BUILD_ID_TTL_MS = 30 * 60_000;

export class CompanionBucklerClient {
  readonly buildIds: BuildIdCache;

  constructor(
    readonly transport: BucklerTransport,
    options: { now?: () => number; buildIds?: BuildIdCache } = {},
  ) {
    this.buildIds = options.buildIds ?? new BuildIdCache(BUILD_ID_TTL_MS, options.now);
  }

  private async fetchText(path: string) {
    try {
      return await this.transport.fetchText(path);
    } catch (err) {
      if (err instanceof NoBucklerTabError) throw new BucklerError("no_tab", null, err.message);
      throw new BucklerError("unavailable", null, err instanceof Error ? err.message : String(err));
    }
  }

  getBuildId(cfnId: string): Promise<string> {
    return this.buildIds.get(async () => {
      const fromPage = await this.transport.readBuildIdFromPage?.().catch((err: unknown) => {
        if (err instanceof NoBucklerTabError) throw new BucklerError("no_tab", null, err.message);
        return null;
      });
      if (fromPage) return fromPage;
      const res = await this.fetchText(bucklerPaths.profile(cfnId));
      // A logged-out profile page is a 403 that still carries Buckler's __NEXT_DATA__.buildId;
      // a WAF block has none.
      const id = extractBuildId(res.text);
      if (id) return id;
      throw new BucklerError(
        classifyBucklerFailure(res.status, res.text),
        res.status,
        `buildId not found (HTTP ${res.status})`,
      );
    });
  }

  private async nextData(cfnId: string, pathFor: (buildId: string) => string): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const buildId = await this.getBuildId(cfnId);
      const res = await this.fetchText(pathFor(buildId));
      if (res.status === 200) {
        let data: unknown;
        try {
          data = JSON.parse(res.text);
        } catch {
          throw new BucklerError(classifyBucklerFailure(200, res.text), 200, "non-JSON answer");
        }
        if (res.text.includes("__N_REDIRECT")) {
          throw new BucklerError("login_required", 200, "Buckler redirected (login required)");
        }
        return data;
      }
      const failure = classifyBucklerFailure(res.status, res.text);
      if (failure === "not_found" && attempt === 0) {
        this.buildIds.invalidate(); // stale buildId after a Capcom deploy
        continue;
      }
      throw new BucklerError(failure, res.status, `Buckler answered HTTP ${res.status}`);
    }
    throw new BucklerError("not_found", 404, "Buckler data not found");
  }

  getPlay(cfnId: string): Promise<unknown> {
    return this.nextData(cfnId, (b) => bucklerPaths.play(b, cfnId));
  }

  getBattlelogPage(cfnId: string, page: number): Promise<unknown> {
    return this.nextData(cfnId, (b) => bucklerPaths.battlelog(b, cfnId, page));
  }
}
