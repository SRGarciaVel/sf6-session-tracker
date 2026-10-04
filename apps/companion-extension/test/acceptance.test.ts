/**
 * Acceptance rule for `_next/data` answers: 200 must pass the schema; 400 only if it passes
 * the schema (warned); 401/403/429/5xx never, whatever the body.
 */
import { describe, expect, it } from "vitest";
import type { BucklerTransport, RawResponse } from "../src/lib/buckler-transport";
import { BucklerError, CompanionBucklerClient } from "../src/lib/buckler-client";
import { BUILD_ID, CFN, fixtureJson, pageMeta } from "./helpers";

const playJson = JSON.stringify(fixtureJson(`play-${CFN}.json`));
const battlelogJson = JSON.stringify(fixtureJson(`battlelog-${CFN}-page-1.json`));

/** The shape seen live: the full page shell (banner, lists, translations) but a ~260 B `play`. */
const shellWithEmptyPlay = (() => {
  const real = fixtureJson(`play-${CFN}.json`) as { pageProps: Record<string, unknown> };
  return JSON.stringify({
    pageProps: {
      ...real.pageProps,
      play: {},
      week_list: [],
      series_list: [],
      sns_list: [],
      common: {},
      __lang: "en",
      __namespaces: {},
    },
    __N_SSP: true,
  });
})();

/** Tab-like transport answering every _next/data request with `answer`; records headers. */
function transport(answer: RawResponse) {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const t: BucklerTransport & { calls: typeof calls } = {
    kind: "main_tab",
    calls,
    async fetchText(path, headers = {}) {
      calls.push({ path, headers });
      return answer;
    },
    readPageMeta: async () => pageMeta("es-es"),
  };
  return t;
}
const json = (status: number, text: string): RawResponse => ({
  status,
  contentType: "application/json",
  text,
});

async function outcome(answer: RawResponse, endpoint: "play" | "battlelog") {
  const warnings: Array<[string, Record<string, unknown>]> = [];
  const t = transport(answer);
  const client = new CompanionBucklerClient(t, { onWarning: (e, f) => warnings.push([e, f]) });
  try {
    const data =
      endpoint === "play" ? await client.getPlay(CFN) : await client.getBattlelogPage(CFN, 1);
    return { accepted: true as const, data, warnings, calls: t.calls };
  } catch (err) {
    return { accepted: false as const, err: err as BucklerError, warnings, calls: t.calls };
  }
}

describe("_next/data acceptance rule", () => {
  it("1. 400 + valid play payload → accepted, with a safe warning", async () => {
    const r = await outcome(json(400, playJson), "play");
    expect(r.accepted).toBe(true);
    expect(r.warnings).toEqual([
      [
        "buckler_non_200_valid_payload",
        { status: 400, endpoint: "play", transport: "main_tab", locale: "es-es" },
      ],
    ]);
    expect(JSON.stringify(r.warnings)).not.toContain("fighter_banner_info"); // never the body
  });

  it("2. 400 + valid battlelog payload → accepted", async () => {
    const r = await outcome(json(400, battlelogJson), "battlelog");
    expect(r.accepted).toBe(true);
    expect(r.warnings[0]?.[1]).toMatchObject({ endpoint: "battlelog", status: 400 });
  });

  it("3. 400 + invalid JSON → rejected", async () => {
    const r = await outcome(
      { status: 400, contentType: "text/html", text: "<html>Bad Request</html>" },
      "play",
    );
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.err).toMatchObject({ kind: "invalid_response", status: 400 });
  });

  it("4. 400 + JSON with the page shell but a wrong/empty `play` (the live shape) → rejected", async () => {
    expect(shellWithEmptyPlay.length).toBeLessThan(playJson.length / 5);
    const r = await outcome(json(400, shellWithEmptyPlay), "play");
    expect(r.accepted).toBe(false);
    if (!r.accepted) {
      expect(r.err.kind).toBe("invalid_response");
      expect(r.err.signature?.pagePropsSizes.play).toBe(2); // "{}" — the tell-tale size
      expect(r.err.signature?.nestedKeys.play).toEqual([]);
    }
    // battlelog shell without replay_list → rejected too
    const b = await outcome(json(400, shellWithEmptyPlay), "battlelog");
    expect(b.accepted).toBe(false);
  });

  it("a battlelog whose replays do not match the schema is not accepted on 400", async () => {
    const bad = JSON.parse(battlelogJson) as {
      pageProps: { replay_list: Array<Record<string, unknown>> };
    };
    delete bad.pageProps.replay_list[0]!.replay_id;
    expect((await outcome(json(400, JSON.stringify(bad)), "battlelog")).accepted).toBe(false);
  });

  it("5+6. 401 / 403 / 429 / 5xx are never accepted, even with a perfect body", async () => {
    for (const status of [401, 403, 429, 500, 503, 404, 302]) {
      const r = await outcome(json(status, playJson), "play");
      expect(r.accepted, String(status)).toBe(false);
    }
    const r429 = await outcome(json(429, playJson), "play");
    if (!r429.accepted) expect(r429.err.kind).toBe("rate_limited");
    expect(r429.calls).toHaveLength(1); // no retry
  });

  it("200 with a payload that fails the schema is invalid_response (not silently returned)", async () => {
    const r = await outcome(json(200, shellWithEmptyPlay), "play");
    expect(r.accepted).toBe(false);
    if (!r.accepted) expect(r.err).toMatchObject({ kind: "invalid_response", status: 200 });
  });

  it("play for another CFN is not accepted", async () => {
    const other = JSON.parse(playJson) as { pageProps: { sid: number } };
    other.pageProps.sid = 123456789;
    expect((await outcome(json(400, JSON.stringify(other)), "play")).accepted).toBe(false);
  });

  it("_next/data requests carry x-nextjs-data: 1, like Buckler's own router (HAR)", async () => {
    const r = await outcome(json(200, playJson), "play");
    expect(r.calls[0]).toEqual({
      path: `/6/buckler/_next/data/${BUILD_ID}/es-es/profile/${CFN}/play.json?sid=${CFN}`,
      headers: { "x-nextjs-data": "1" },
    });
  });
});

describe("safe diagnostics signature", () => {
  it("reports sizes, nested key names and numeric codes — never string values", async () => {
    const { describeBucklerResponse } = await import("@sf6/capcom-core");
    const body = JSON.stringify({
      pageProps: {
        sid: 1733837998,
        play: { error_code: 40012, result: false, message: "secret-ish text" },
        fighter_banner_info: { personal_info: { fighter_id: "TDF | Comunismo" } },
        __namespaces: { common: { "[t]x": "must log in" } },
      },
    });
    const sig = describeBucklerResponse(400, "application/json", body);
    expect(sig.pagePropsSizes).toMatchObject({ sid: 10 });
    expect(sig.nestedKeys.play).toEqual(["error_code", "result", "message"]);
    expect(sig.codes).toEqual({
      "pageProps.play.error_code": 40012,
      "pageProps.play.result": false,
    });
    const text = JSON.stringify(sig);
    for (const leak of ["secret-ish", "Comunismo", "must log in"]) expect(text).not.toContain(leak);
  });
});
