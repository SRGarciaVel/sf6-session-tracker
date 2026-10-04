import { describe, expect, it } from "vitest";
import type { Logger, LogFields } from "@/server/logger";
import { normalizedMatchSchema, SF6ProviderError } from "../../provider";
import { checkProviderOutput } from "../../contract-check";
import { BuildIdCache, extractBuildId } from "./build-id";
import { CapcomBucklerClient, parseRetryAfter } from "./client";
import { createCapcomFixtureFetch, DEFAULT_FIXTURE_DIR, FIXTURE_CFN_ID } from "./fixture-fetch";
import { CapcomSF6DataProvider } from "./index";
import { cookieHeaderFromExport } from "./session";
import { readFileSync } from "node:fs";

const CFN = FIXTURE_CFN_ID;
const BUILD_ID = "fd-cwVZtHmfmH_deY-WuZ";
const html = readFileSync(`${DEFAULT_FIXTURE_DIR}/profile-${CFN}.html`, "utf8");

function recordingLogger() {
  const events: { level: string; event: string; fields?: LogFields }[] = [];
  const make = (): Logger => ({
    debug: (event, fields) => events.push({ level: "debug", event, fields }),
    info: (event, fields) => events.push({ level: "info", event, fields }),
    warn: (event, fields) => events.push({ level: "warn", event, fields }),
    error: (event, fields) => events.push({ level: "error", event, fields }),
    child: () => make(),
  });
  return { logger: make(), events };
}

/** Scripted fetch: each call takes the next handler. Records URLs and headers. */
function scripted(
  ...handlers: ((url: string, init?: RequestInit) => Response | Promise<Response>)[]
) {
  const calls: { url: string; headers: Headers }[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const h = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    if (!h) throw new Error("no handler");
    return h(url, init);
  };
  return { impl, calls };
}
const htmlOk = () => new Response(html, { status: 200 });
const jsonOk = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response("x", { status: code, headers });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    return err instanceof SF6ProviderError ? err.code : `other:${String(err)}`;
  }
}

describe("buildId discovery", () => {
  it("29. parses __NEXT_DATA__.buildId (real page) and falls back to asset references", () => {
    expect(extractBuildId(html)).toBe(BUILD_ID);
    const noNextData =
      '<script src="/6/buckler/_next/static/abcDEF123_-x/_buildManifest.js"></script>';
    expect(extractBuildId(noNextData)).toBe("abcDEF123_-x");
    expect(extractBuildId('<a href="/6/buckler/_next/data/zzzzzz1/en.json">')).toBe("zzzzzz1");
    expect(extractBuildId("<html>login</html>")).toBeNull();
  });

  it("30. caches the buildId (one HTML fetch for many data calls) until TTL", async () => {
    const f = scripted(htmlOk, jsonOk({ a: 1 }), jsonOk({ a: 2 }), htmlOk, jsonOk({ a: 3 }));
    let now = 0;
    const client = new CapcomBucklerClient({ fetch: f.impl, buildIdTtlMs: 1000, now: () => now });
    await client.getPlayData(CFN);
    await client.getBattlelogPage(CFN, 1);
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual([
      `/6/buckler/profile/${CFN}`,
      `/6/buckler/_next/data/${BUILD_ID}/en/profile/${CFN}/play.json`,
      `/6/buckler/_next/data/${BUILD_ID}/en/profile/${CFN}/battlelog.json`,
    ]);
    now = 1001;
    await client.getBattlelogPage(CFN, 2);
    expect(f.calls).toHaveLength(5); // re-discovered after expiry
    expect(new URL(f.calls[4]!.url).search).toBe(`?page=2&sid=${CFN}`);

    let discoveries = 0;
    const cache = new BuildIdCache(10_000);
    const discover = async () => {
      discoveries++;
      return "id";
    };
    await Promise.all([cache.get(discover), cache.get(discover), cache.get(discover)]);
    expect(discoveries).toBe(1); // single-flight
  });

  it("31+32. a _next/data 404 invalidates the buildId, re-discovers and retries ONCE", async () => {
    const { logger, events } = recordingLogger();
    const f = scripted(htmlOk, status(404), htmlOk, jsonOk({ ok: true }));
    const client = new CapcomBucklerClient({ fetch: f.impl, logger });
    await expect(client.getPlayData(CFN)).resolves.toEqual({ ok: true });
    expect(f.calls).toHaveLength(4);
    expect(events.some((e) => e.event === "capcom_build_id_stale")).toBe(true);
  });

  it("33. no infinite loop: a second 404 is not_found after exactly 4 requests", async () => {
    const f = scripted(htmlOk, status(404), htmlOk, status(404), htmlOk, jsonOk({}));
    const client = new CapcomBucklerClient({ fetch: f.impl });
    expect(await codeOf(client.getBattlelogPage(CFN, 1))).toBe("not_found");
    expect(f.calls).toHaveLength(4);
  });

  it("works end to end against the fixture fetch (stale buildId served as 404)", async () => {
    const log = { urls: [] as string[] };
    const client = new CapcomBucklerClient({ fetch: createCapcomFixtureFetch({ log }) });
    const page2 = (await client.getBattlelogPage(CFN, 2)) as {
      pageProps: { current_page: number };
    };
    expect(page2.pageProps.current_page).toBe(2);
    expect(await codeOf(client.getBattlelogPage(CFN, 3))).toBe("not_found"); // not captured
  });
});

describe("HTTP error mapping", () => {
  it("34. 403 → unavailable (never not_found) + provider_access_denied log without cookies", async () => {
    const { logger, events } = recordingLogger();
    const f = scripted(status(403, { server: "CloudFront", "x-cache": "Error from cloudfront" }));
    const client = new CapcomBucklerClient({
      fetch: f.impl,
      logger,
      cookieHeader: "buckler_id=SECRET-VALUE",
    });
    expect(await codeOf(client.getCard(CFN))).toBe("unavailable");
    const denied = events.find((e) => e.event === "provider_access_denied");
    expect(denied?.fields).toMatchObject({ status: 403, server: "CloudFront", withSession: true });
    expect(JSON.stringify(events)).not.toContain("SECRET-VALUE");
    expect(f.calls[0]?.headers.get("cookie")).toBe("buckler_id=SECRET-VALUE");
    expect(f.calls[0]?.headers.get("user-agent")).toBe("sf6-session-tracker (personal stats tool)");
  });

  it("35. 404 on the profile page → not_found", async () => {
    const client = new CapcomBucklerClient({ fetch: createCapcomFixtureFetch() });
    expect(await codeOf(client.getPlayData("123456789"))).toBe("not_found");
  });

  it("36. 429 → rate_limited with Retry-After", async () => {
    const client = new CapcomBucklerClient({
      fetch: scripted(status(429, { "retry-after": "120" })).impl,
    });
    try {
      await client.getCard(CFN);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SF6ProviderError);
      expect((err as SF6ProviderError).code).toBe("rate_limited");
      expect((err as SF6ProviderError).retryAfterMs).toBe(120_000);
    }
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 4_000)).toBe(6_000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("37. timeout → timeout", async () => {
    const hang: typeof fetch = (_input, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const client = new CapcomBucklerClient({ fetch: hang, timeoutMs: 20 });
    expect(await codeOf(client.getCard(CFN))).toBe("timeout");
  });

  it("38. 5xx / network errors / redirects → unavailable", async () => {
    expect(
      await codeOf(new CapcomBucklerClient({ fetch: scripted(status(503)).impl }).getCard(CFN)),
    ).toBe("unavailable");
    const down: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await codeOf(new CapcomBucklerClient({ fetch: down }).getCard(CFN))).toBe("unavailable");
    const redirect = scripted(status(302, { location: "/6/buckler/auth/loginep" }));
    expect(await codeOf(new CapcomBucklerClient({ fetch: redirect.impl }).getCard(CFN))).toBe(
      "unavailable",
    );
  });

  it("39. invalid JSON → invalid_response", async () => {
    const f = scripted(() => new Response("<html>maintenance</html>", { status: 200 }));
    expect(await codeOf(new CapcomBucklerClient({ fetch: f.impl }).getCard(CFN))).toBe(
      "invalid_response",
    );
  });
});

describe("CapcomSF6DataProvider over the real fixtures (offline)", () => {
  const provider = () =>
    CapcomSF6DataProvider.withClientOptions(
      { fetch: createCapcomFixtureFetch() },
      { now: () => new Date("2026-10-04T00:00:00Z") },
    );

  it("satisfies the tracker contract (provider:check rules) with no ERROR", async () => {
    const p = provider();
    const profile = await p.getPlayerProfile(CFN);
    const matches = await p.getRecentMatches(CFN);
    const report = checkProviderOutput({
      cfnUserId: CFN,
      profile,
      matches,
      now: new Date("2026-10-04T00:00:00Z"),
    });
    expect(report.findings.filter((f) => f.level === "ERROR")).toEqual([]);
    expect(report.order).toBe("newest-first");
    expect(matches.every((m) => normalizedMatchSchema.safeParse(m).success)).toBe(true);
  });

  it("getMatchesSince walks page 1 → 2 and stops at the known replay", async () => {
    const r = await provider().getMatchesSince(CFN, new Set(["5EL9NP63U"]));
    expect(r.pagesFetched).toBe(2);
    expect(r.gapSuspected).toBe(false);
    expect(r.matches.map((m) => m.externalMatchId).slice(-3)).toEqual([
      "QW48GVG68",
      "EQKU5LNFD",
      "SKAFCQW7R",
    ]);
  });

  it("getMatchesSince reports a gap instead of hiding it", async () => {
    const p = CapcomSF6DataProvider.withClientOptions(
      { fetch: createCapcomFixtureFetch() },
      { maxBattlelogPagesPerPoll: 2 },
    );
    const r = await p.getMatchesSince(CFN, new Set(["UNKNOWN"]));
    expect(r).toMatchObject({ pagesFetched: 2, gapSuspected: true });
    expect(r.matches).toHaveLength(20);
  });
});

describe("human-exported session", () => {
  it("builds the cookie header from non-expired streetfighter.com cookies only", () => {
    const now = 2_000_000_000_000;
    const s = cookieHeaderFromExport(
      [
        {
          name: "buckler_id",
          value: "v1",
          domain: "www.streetfighter.com",
          expirationDate: now / 1000 + 60,
        },
        {
          name: "buckler_r_id",
          value: "v2",
          domain: ".streetfighter.com",
          expirationDate: now / 1000 - 60,
        },
        { name: "other", value: "v3", domain: "example.com" },
      ],
      now,
    );
    expect(s.cookieHeader).toBe("buckler_id=v1");
    expect(s.summary).toEqual({ cookieNames: ["buckler_id"], expiredNames: ["buckler_r_id"] });
    expect(() => cookieHeaderFromExport({ not: "an array" })).toThrowError(/Cookie-Editor/);
  });
});
