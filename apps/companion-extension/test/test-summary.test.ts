import { describe, expect, it } from "vitest";
import { runConnectionTest } from "../src/lib/connection-test";
import { summarizeConnectionTest } from "../src/lib/test-summary";
import { CFN, fixtureTransport } from "./helpers";

/** Identity translator: "key|sub1|sub2" so assertions are language-independent. */
const t = (key: string, subs?: string[]) => [key, ...(subs ?? [])].join("|");

describe("connection test — end-user behaviour", () => {
  it("default: stops at the first transport that passes (service_worker validated in real use)", async () => {
    const used: string[] = [];
    const report = await runConnectionTest(CFN, (kind) => {
      used.push(kind);
      return fixtureTransport(kind, {}, { pageLocale: "es-es" });
    });
    expect(used).toEqual(["service_worker"]);
    expect(report).toMatchObject({ verdict: "PASS", preferred: "service_worker" });
    expect(report.results).toHaveLength(1);
  });

  it("falls back service_worker → isolated_tab → main_tab and keeps the first that works", async () => {
    const report = await runConnectionTest(CFN, (kind) =>
      kind === "main_tab"
        ? fixtureTransport(kind)
        : fixtureTransport(kind, {
            "/profile/": { status: 403, contentType: "text/html", text: "Request blocked" },
          }),
    );
    expect(report.results.map((r) => r.transport)).toEqual([
      "service_worker",
      "isolated_tab",
      "main_tab",
    ]);
    expect(report.preferred).toBe("main_tab");
  });

  it("PASS summary is short: verdict, mode, characters, matches, language — no technical noise", async () => {
    const report = await runConnectionTest(CFN, (kind) =>
      fixtureTransport(kind, {}, { pageLocale: "es-es" }),
    );
    const lines = summarizeConnectionTest(report, t);
    expect(lines).toEqual([
      "testPass",
      "testMode|service_worker",
      "testCharacters|32",
      "testReplays|10",
      "testLocale|es-es",
    ]);
    expect(lines.join("\n")).not.toMatch(/↳|x-nextjs|statusCode|pageProps/);
  });

  it("FAIL summary gives one actionable reason; details only in debug", async () => {
    const report = await runConnectionTest(CFN, (kind) =>
      kind === "service_worker"
        ? fixtureTransport(kind, {
            "/profile/": { status: 403, contentType: "text/html", text: "Request blocked" },
          })
        : {
            ...fixtureTransport(kind),
            readPageMeta: async () => {
              const { NoBucklerTabError } = await import("../src/lib/buckler-transport");
              throw new NoBucklerTabError();
            },
          },
    );
    expect(report.verdict).toBe("FAIL");
    expect(summarizeConnectionTest(report, t)).toEqual(["testFail", "testReasonTab"]);
    const debug = summarizeConnectionTest(report, t, true).join("\n");
    expect(debug).toContain("— debug —");
    expect(debug).toContain("service_worker: buildId FAIL");
  });

  it("reason priority: rate limit > login > tab > unavailable > invalid", async () => {
    const { failureReasonKey } = await import("../src/lib/test-summary");
    const r = (failure: string) => ({ failure }) as never;
    expect(failureReasonKey([r("invalid_response"), r("login_required")])).toBe("testReasonLogin");
    expect(failureReasonKey([r("blocked"), r("no_tab")])).toBe("testReasonTab");
    expect(failureReasonKey([r("login_required"), r("rate_limited")])).toBe(
      "testReasonRateLimited",
    );
    expect(failureReasonKey([r("blocked")])).toBe("testReasonUnavailable");
  });
});
