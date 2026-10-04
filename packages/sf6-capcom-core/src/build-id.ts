/**
 * Next.js buildId discovery for Buckler's Boot Camp (Pages Router: `__NEXT_DATA__` + `_next/data`).
 * The buildId changes on every Capcom deploy, so it is discovered at runtime and cached — never
 * hardcoded. Observed in the HAR: "fd-cwVZtHmfmH_deY-WuZ".
 */

const BUILD_ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Extract the buildId from a Buckler HTML page. Pure. */
export function extractBuildId(html: string): string | null {
  // 1. __NEXT_DATA__.buildId (authoritative)
  const nextData = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (nextData?.[1]) {
    try {
      const parsed: unknown = JSON.parse(nextData[1]);
      if (parsed && typeof parsed === "object" && "buildId" in parsed) {
        const id = parsed.buildId;
        if (typeof id === "string" && BUILD_ID.test(id)) return id;
      }
    } catch {
      // fall through to the asset references
    }
  }
  // 2. /_next/static/{buildId}/_buildManifest.js or /_next/data/{buildId}/ references
  const ref =
    /\/_next\/static\/([A-Za-z0-9_-]{6,64})\/_(?:buildManifest|ssgManifest)\.js/.exec(html) ??
    /\/_next\/data\/([A-Za-z0-9_-]{6,64})\//.exec(html);
  return ref?.[1] ?? null;
}

/** TTL cache with single-flight discovery. */
export class BuildIdCache {
  private value: { id: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(discover: () => Promise<string>): Promise<string> {
    if (this.value && this.value.expiresAt > this.now()) return this.value.id;
    if (!this.inflight) {
      this.inflight = discover()
        .then((id) => {
          this.value = { id, expiresAt: this.now() + this.ttlMs };
          return id;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  /** Drop the cached id (e.g. after a `_next/data` 404 caused by a new Capcom deploy). */
  invalidate(): void {
    this.value = null;
  }

  peek(): string | null {
    return this.value?.id ?? null;
  }
}
