import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allowedTrackerOrigin,
  BUCKLER_HOST_PERMISSION,
  DEV_TRACKER_ORIGINS,
  hostPermissionsFor,
  parseTrackerOrigins,
  TRACKER_ORIGINS,
  validateTrackerOrigin,
} from "../src/lib/tracker-origins";

describe("tracker origin allowlist (MV3 host permissions)", () => {
  it("unbundled (tests) defaults to the dev origins", () => {
    expect(TRACKER_ORIGINS).toEqual(["http://localhost:3000", "http://127.0.0.1:3000"]);
  });

  it("accepts https origins and http only for loopback", () => {
    expect(validateTrackerOrigin("https://tracker.example.com/")).toEqual({
      ok: true,
      origin: "https://tracker.example.com",
    });
    expect(validateTrackerOrigin("http://localhost:3000")).toMatchObject({ ok: true });
    expect(validateTrackerOrigin("http://127.0.0.1:3000")).toMatchObject({ ok: true });
    for (const bad of [
      "http://tracker.example.com",
      "https://*.example.com",
      "https://tracker.example.com/api",
      "https://user:pw@tracker.example.com",
      "ftp://tracker.example.com",
      "not a url",
    ]) {
      expect(validateTrackerOrigin(bad).ok, bad).toBe(false);
    }
  });

  it("parses the build-time list and rejects any invalid entry", () => {
    expect(parseTrackerOrigins(undefined)).toEqual([]);
    expect(
      parseTrackerOrigins(" https://a.example , https://a.example/ ,https://b.example"),
    ).toEqual(["https://a.example", "https://b.example"]);
    expect(() => parseTrackerOrigins("https://ok.example,http://plain.example")).toThrow(
      /must be https/,
    );
  });

  it("host_permissions: Buckler + one exact entry per tracker origin, never wildcards", () => {
    const perms = hostPermissionsFor(DEV_TRACKER_ORIGINS);
    expect(perms).toEqual([
      BUCKLER_HOST_PERMISSION,
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
    ]);
    expect(perms.join(" ")).not.toMatch(/<all_urls>|\*:\/\/|https?:\/\/\*/);
  });

  it("only allowlisted origins can be paired with", () => {
    expect(allowedTrackerOrigin("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(allowedTrackerOrigin("http://localhost:3001")).toBeNull();
    expect(allowedTrackerOrigin("https://evil.example")).toBeNull();
    expect(
      allowedTrackerOrigin("https://tracker.example.com", ["https://tracker.example.com"]),
    ).toBe("https://tracker.example.com");
  });

  it("the source manifest matches the dev allowlist and has no excessive permissions", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as { host_permissions: string[]; permissions: string[]; optional_host_permissions?: unknown };
    expect(manifest.host_permissions).toEqual(hostPermissionsFor(DEV_TRACKER_ORIGINS));
    expect(manifest.permissions.sort()).toEqual(["alarms", "scripting", "storage"]);
    expect(manifest.optional_host_permissions).toBeUndefined();
  });
});

describe("fetch is invoked like a browser requires (regression: 'Illegal invocation')", () => {
  /** Emulates WorkerGlobalScope.fetch: throws unless called with no `this` / the global. */
  function strictFetch(calls: string[]): typeof fetch {
    return function (this: unknown, input: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
      }
      calls.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ error: "invalid_or_expired_code" }), { status: 400 }),
      );
    } as typeof fetch;
  }

  it("TrackerClient", async () => {
    const { TrackerClient, TrackerError } = await import("../src/lib/tracker-client");
    const calls: string[] = [];
    const client = new TrackerClient("http://localhost:3000", null, strictFetch(calls));
    const err = await client.pair("ZZZZZZZZ", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as InstanceType<typeof TrackerError>).code).toBe("invalid_or_expired_code"); // not "network"
    expect(calls).toEqual(["http://localhost:3000/api/companion/pair"]);
  });

  it("service worker Buckler transport", async () => {
    const { serviceWorkerTransport } = await import("../src/lib/buckler-transport");
    const calls: string[] = [];
    await serviceWorkerTransport(strictFetch(calls)).fetchText("/6/buckler/profile/1");
    expect(calls).toEqual(["https://www.streetfighter.com/6/buckler/profile/1"]);
  });
});
