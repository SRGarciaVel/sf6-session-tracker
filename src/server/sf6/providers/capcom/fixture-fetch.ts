/**
 * Offline `fetch` that serves the sanitized HAR fixtures (tests/fixtures/capcom/) at the same
 * URLs Buckler uses. Lets tests and `pnpm provider:check --fixture` exercise the real client
 * (buildId discovery, _next/data URLs, pagination) with zero network. Never used in production.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBuildId } from "./build-id";

export const FIXTURE_CFN_ID = "1733837998";
export const DEFAULT_FIXTURE_DIR = join(process.cwd(), "tests", "fixtures", "capcom");

export interface FixtureFetchLog {
  urls: string[];
}

export function createCapcomFixtureFetch(
  options: { dir?: string; log?: FixtureFetchLog } = {},
): typeof fetch {
  const dir = options.dir ?? DEFAULT_FIXTURE_DIR;
  const file = (name: string) => join(dir, name);
  const html = readFileSync(file(`profile-${FIXTURE_CFN_ID}.html`), "utf8");
  const buildId = extractBuildId(html);

  const json = (name: string) =>
    existsSync(file(name))
      ? new Response(readFileSync(file(name), "utf8"), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        })
      : new Response("Not Found", { status: 404 });

  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    options.log?.urls.push(url.pathname + url.search);
    const path = url.pathname.replace(/^\/6\/buckler/, "");

    let m = /^\/profile\/(\d+)$/.exec(path);
    if (m) {
      return m[1] === FIXTURE_CFN_ID
        ? new Response(html, { status: 200, headers: { "content-type": "text/html" } })
        : new Response("Not Found", { status: 404 });
    }
    m = /^\/api\/en\/card\/(\d+)$/.exec(path);
    if (m) return json(`card-${m[1]}.json`);

    m = /^\/_next\/data\/([^/]+)\/en\/profile\/(\d+)\/(play|battlelog)\.json$/.exec(path);
    if (m) {
      const [, id, cfn, kind] = m;
      if (id !== buildId) return new Response("Not Found", { status: 404 }); // stale buildId
      if (kind === "play") return json(`play-${cfn}.json`);
      const page = url.searchParams.get("page") ?? "1";
      return json(`battlelog-${cfn}-page-${page}.json`);
    }
    return new Response("Not Found", { status: 404 });
  };
}
