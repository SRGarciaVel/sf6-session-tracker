import { describe, expect, it } from "vitest";
import {
  bucklerPaths,
  classifyBucklerFailure,
  describeBucklerResponse,
  extractPageMeta,
  localeFromPathname,
} from "@sf6/capcom-core";
import { BucklerError, CompanionBucklerClient } from "../src/lib/buckler-client";
import { runConnectionTest } from "../src/lib/connection-test";
import { BUILD_ID, CFN, fixtureTransport, LOCALE_REFUSED_400, pageMeta } from "./helpers";
import { readFileSync } from "node:fs";

const fixtureHtml = (name: string) =>
  readFileSync(new URL(`../../../tests/fixtures/capcom/${name}`, import.meta.url), "utf8");

describe("Buckler locale handling", () => {
  it("page metadata: locale from __NEXT_DATA__ (en capture, derived es-es) and from the pathname", () => {
    expect(extractPageMeta(fixtureHtml(`profile-${CFN}.html`))).toMatchObject({
      buildId: BUILD_ID,
      locale: "en",
      defaultLocale: "en",
    });
    expect(extractPageMeta(fixtureHtml(`profile-${CFN}-es-es.html`))?.locale).toBe("es-es");
    expect(localeFromPathname(`/6/buckler/es-es/profile/${CFN}`)).toBe("es-es");
    expect(localeFromPathname(`/6/buckler/profile/${CFN}`)).toBeNull();
    expect(localeFromPathname("/6/buckler/xx-yy/profile/1")).toBeNull(); // not a Buckler locale
  });

  it("paths carry the locale; the HAR's /en/ is only the default", () => {
    expect(bucklerPaths.play(BUILD_ID, CFN)).toContain(`/${BUILD_ID}/en/profile/`);
    expect(bucklerPaths.play(BUILD_ID, CFN, "es-es")).toBe(
      `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/play.json?sid=${CFN}`,
    );
    expect(bucklerPaths.battlelog(BUILD_ID, CFN, 2, "es-es")).toBe(
      `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/battlelog.json?page=2&sid=${CFN}`,
    );
    expect(() => bucklerPaths.play(BUILD_ID, CFN, "../x")).toThrow(RangeError);
  });

  it("service worker on an es-es session: requests /es-es/ (the reported bug) and succeeds", async () => {
    const t = fixtureTransport("service_worker", {}, { pageLocale: "es-es" });
    const client = new CompanionBucklerClient(t);
    await client.getPlay(CFN);
    await client.getBattlelogPage(CFN, 1);
    expect(t.paths).toEqual([
      `/6/buckler/profile/${CFN}`,
      `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/play.json?sid=${CFN}`,
      `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/battlelog.json?sid=${CFN}`,
    ]);
    expect(client.effectiveLocale).toBe("es-es");
  });

  it("tab transports take the locale from the open page (/6/buckler/es-es/…)", async () => {
    const t = {
      ...fixtureTransport("main_tab", {}, { pageLocale: "es-es" }),
      readPageMeta: async () => pageMeta("es-es"),
    };
    await new CompanionBucklerClient(t).getPlay(CFN);
    expect(t.paths).toEqual([
      `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/play.json?sid=${CFN}`,
    ]);
  });

  it("regression: the old hardcoded /en/ on an es-es session → 400, now locale_mismatch (not login_required)", () => {
    const sig = describeBucklerResponse(
      LOCALE_REFUSED_400.status,
      LOCALE_REFUSED_400.contentType,
      LOCALE_REFUSED_400.text,
    );
    expect(LOCALE_REFUSED_400.text).toMatch(/must log in/); // the misleading translation string
    expect(classifyBucklerFailure(sig, { requestedLocale: "en", pageLocale: "es-es" })).toBe(
      "locale_mismatch",
    );
    expect(classifyBucklerFailure(sig, { requestedLocale: "es-es", pageLocale: "es-es" })).toBe(
      "invalid_response",
    );
    expect(sig).toMatchObject({
      status: 400,
      json: true,
      keys: ["pageProps"],
      pagePropsKeys: ["__namespaces"],
    });
    expect(JSON.stringify(sig)).not.toContain("must log in"); // signature never carries values
  });

  it("fallback is at most: page locale, then en — never a sweep of languages", async () => {
    // A gSSP redirect to another locale is an explicit mismatch → one retry with en.
    const redirectToFr = {
      status: 200,
      contentType: "application/json",
      text: JSON.stringify({
        pageProps: { __N_REDIRECT: `/6/buckler/fr/profile/${CFN}`, __N_REDIRECT_STATUS: 307 },
      }),
    };
    const t = fixtureTransport(
      "service_worker",
      { "/es-es/profile": redirectToFr },
      { pageLocale: "es-es", servedLocales: ["en"] },
    );
    const client = new CompanionBucklerClient(t);
    await client.getPlay(CFN);
    expect(t.paths.filter((p) => p.includes("play.json")).map((p) => p.split("/")[6])).toEqual([
      "es-es",
      "en",
    ]);
    expect(client.effectiveLocale).toBe("en");

    // A plain 400 on the page's own locale is NOT retried in other languages.
    const t2 = fixtureTransport("service_worker", {}, { pageLocale: "es-es", servedLocales: [] });
    const err = await new CompanionBucklerClient(t2).getPlay(CFN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BucklerError);
    expect(err).toMatchObject({ kind: "invalid_response", status: 400, locale: "es-es" });
    expect(t2.paths.filter((p) => p.includes("play.json"))).toHaveLength(1);
  });

  it("structural classification: login, WAF block, rate limit, not found", () => {
    const sig = (status: number, body: string, ct = "text/html") =>
      describeBucklerResponse(status, ct, body);
    const appPage = `<title>Profile | Buckler's Boot Camp</title><script id="__NEXT_DATA__" type="application/json">{"page":"/profile/[sid]","buildId":"${BUILD_ID}"}</script>`;
    expect(classifyBucklerFailure(sig(403, appPage))).toBe("login_required");
    expect(
      classifyBucklerFailure(
        sig(403, "<h1>403 ERROR</h1>The request could not be satisfied. Request blocked."),
      ),
    ).toBe("blocked");
    expect(classifyBucklerFailure(sig(429, "slow down"))).toBe("rate_limited");
    expect(classifyBucklerFailure(sig(404, "Not Found"))).toBe("not_found");
    expect(classifyBucklerFailure(sig(503, "x"))).toBe("unavailable");
    const toLogin = sig(
      200,
      JSON.stringify({ pageProps: { __N_REDIRECT: "/6/buckler/auth/loginep?redirect_url=x" } }),
      "application/json",
    );
    expect(toLogin.redirectPath).toBe("/6/buckler/auth/loginep");
    expect(classifyBucklerFailure(toLogin)).toBe("login_required");
    // the translated sentence alone never means "logged out"
    expect(
      classifyBucklerFailure(sig(500, "To use this service, you must log in or sign up.")),
    ).toBe("unavailable");
  });

  it("connection test reports page locale, request locale and a safe signature", async () => {
    const report = await runConnectionTest(CFN, (kind) =>
      fixtureTransport(
        kind,
        {},
        { pageLocale: "es-es", servedLocales: kind === "service_worker" ? [] : ["es-es"] },
      ),
    );
    expect(report.results[0]).toMatchObject({
      transport: "service_worker",
      failure: "invalid_response",
      status: 400,
      pageLocale: "es-es",
      requestLocale: "es-es",
      signature: { status: 400, json: true, pagePropsKeys: ["__namespaces"] },
    });
    expect(report.results[1]).toMatchObject({
      failure: null,
      pageLocale: "es-es",
      requestLocale: "es-es",
    });
    expect(report.preferred).toBe("isolated_tab");
  });
});
