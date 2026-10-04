/** Offline doubles for companion tests: Buckler fixtures transport + in-memory tracker. */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COMPANION_LIMITS,
  COMPANION_POLLING,
  companionSyncRequestSchema,
  extractBuildId,
  type CompanionState,
  type CompanionSyncRequest,
} from "@sf6/capcom-core";
import type { BucklerTransport, RawResponse } from "../src/lib/buckler-transport";
import { TrackerClient } from "../src/lib/tracker-client";

export const CFN = "1733837998";
const DIR = fileURLToPath(new URL("../../../tests/fixtures/capcom/", import.meta.url));
const read = (name: string) => readFileSync(`${DIR}${name}`, "utf8");
export const fixtureJson = (name: string): unknown => JSON.parse(read(name));
export const BUILD_ID = extractBuildId(read(`profile-${CFN}.html`))!;

/** Serves the sanitized HAR fixtures at the real Buckler paths. Records every path. */
export function fixtureTransport(
  kind: BucklerTransport["kind"] = "service_worker",
  overrides: Record<string, RawResponse> = {},
): BucklerTransport & { paths: string[] } {
  const paths: string[] = [];
  return {
    kind,
    paths,
    async fetchText(path) {
      paths.push(path);
      const hit = Object.entries(overrides).find(([k]) => path.includes(k));
      if (hit) return hit[1];
      const url = new URL(path, "https://www.streetfighter.com");
      const p = url.pathname;
      const ok = (text: string, type = "application/json"): RawResponse => ({
        status: 200,
        contentType: type,
        text,
      });
      if (p === `/6/buckler/profile/${CFN}`) return ok(read(`profile-${CFN}.html`), "text/html");
      const m = /\/_next\/data\/([^/]+)\/en\/profile\/(\d+)\/(play|battlelog)\.json$/.exec(p);
      if (m && m[1] === BUILD_ID) {
        const file =
          m[3] === "play"
            ? `play-${m[2]}.json`
            : `battlelog-${m[2]}-page-${url.searchParams.get("page") ?? "1"}.json`;
        if (existsSync(`${DIR}${file}`)) return ok(read(file));
      }
      return { status: 404, contentType: "text/html", text: "Not Found" };
    },
  };
}

export function makeState(over: Partial<CompanionState> = {}): CompanionState {
  return {
    cfnUserId: CFN,
    displayName: "TDF | Comunismo",
    activeSession: true,
    knownReplayIds: [],
    ingestEnabled: true,
    polling: { ...COMPANION_POLLING },
    serverTime: new Date().toISOString(),
    ...over,
  };
}

/**
 * In-memory tracker that VALIDATES like the server (strict schema) and dedupes by id.
 * Captures every raw body that would have gone over the wire.
 */
export function fakeTracker(initial: Partial<CompanionState> = {}) {
  const state = makeState(initial);
  const stored = new Map<string, unknown>();
  const sent: CompanionSyncRequest[] = [];
  const rawBodies: string[] = [];
  let failNext: { status: number; error: string } | null = null;
  let networkDown = false;

  const fetchImpl: typeof fetch = async (input, init) => {
    if (networkDown) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (failNext) {
      const f = failNext;
      failNext = null;
      return respond(f.status, { error: f.error });
    }
    if (url.pathname === "/api/companion/state") return respond(200, state);
    if (url.pathname === "/api/companion/sync") {
      const raw = String(init?.body ?? "");
      rawBodies.push(raw);
      const parsed = companionSyncRequestSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return respond(422, { error: "invalid_payload" });
      sent.push(JSON.parse(raw) as CompanionSyncRequest);
      let inserted = 0;
      for (const m of parsed.data.matches) {
        if (!stored.has(m.externalMatchId)) {
          stored.set(m.externalMatchId, m);
          inserted++;
        }
      }
      state.knownReplayIds = [...stored.keys()].slice(-COMPANION_LIMITS.knownReplayIds);
      return respond(200, { inserted, duplicates: parsed.data.matches.length - inserted, state });
    }
    if (url.pathname === "/api/companion/disconnect") return respond(200, { ok: true });
    return respond(404, { error: "not_found" });
  };

  return {
    state,
    stored,
    sent,
    rawBodies,
    client: (token: string | null = "sf6c_test") =>
      new TrackerClient("http://tracker.test", token, fetchImpl),
    failOnce(status: number, error: string) {
      failNext = { status, error };
    },
    setNetworkDown(down: boolean) {
      networkDown = down;
    },
  };
}
