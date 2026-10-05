import { describe, expect, it } from "vitest";
import {
  BETA_TRACKER_ORIGIN,
  checksumLine,
  createZip,
  isValidChromeVersion,
  readZip,
  releaseName,
  sha256,
  validateBuild,
  type BuildFile,
} from "../release/release";

const file = (path: string, content: string): BuildFile => ({
  path,
  content: Buffer.from(content, "utf8"),
});

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    manifest_version: 3,
    name: "__MSG_extName__",
    version: "0.1.0",
    permissions: ["storage", "alarms", "scripting"],
    host_permissions: ["https://www.streetfighter.com/6/buckler/*", `${BETA_TRACKER_ORIGIN}/*`],
    ...overrides,
  });
}

function build(overrides: Record<string, unknown> = {}, extra: BuildFile[] = []): BuildFile[] {
  return [
    file("manifest.json", manifest(overrides)),
    file("background.js", "const x=1;"),
    file("popup.html", "<!doctype html>"),
    file("popup.js", "const y=2;"),
    file("popup.css", "body{}"),
    file("_locales/en/messages.json", "{}"),
    file("_locales/es/messages.json", "{}"),
    ...extra,
  ];
}

describe("companion beta release", () => {
  it("names the package from the manifest version (suffix only in the file name)", () => {
    expect(releaseName("0.1.0")).toBe("sf6-session-companion-v0.1.0-beta");
    expect(isValidChromeVersion("0.1.0")).toBe(true);
    expect(isValidChromeVersion("1.2.3.4")).toBe(true);
    for (const bad of ["0.1.0-beta", "01.0", "1.2.3.4.5", "70000", ""]) {
      expect(isValidChromeVersion(bad)).toBe(false);
    }
    expect(() => releaseName("0.1.0-beta")).toThrow();
  });

  it("accepts a production beta build", () => {
    expect(validateBuild(build())).toEqual({ ok: true, errors: [], version: "0.1.0" });
  });

  it("rejects a dev build (localhost / 127.0.0.1 host permissions)", () => {
    const dev = build({
      host_permissions: [
        "https://www.streetfighter.com/6/buckler/*",
        "http://localhost:3000/*",
        "http://127.0.0.1:3000/*",
      ],
    });
    const r = validateBuild(dev);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        `missing host permission: ${BETA_TRACKER_ORIGIN}/*`,
        "unexpected host permission: http://localhost:3000/*",
        "unexpected host permission: http://127.0.0.1:3000/*",
        "loopback origin found in manifest.json",
      ]),
    );
  });

  it("requires Buckler and the beta tracker, MV3 and the core files", () => {
    const r = validateBuild(
      build({ manifest_version: 2, host_permissions: [] }).filter((f) => f.path !== "popup.js"),
    );
    expect(r.errors).toEqual(
      expect.arrayContaining([
        "missing popup.js",
        "manifest_version must be 3",
        "missing host permission: https://www.streetfighter.com/6/buckler/*",
        `missing host permission: ${BETA_TRACKER_ORIGIN}/*`,
      ]),
    );
    expect(validateBuild([file("manifest.json", manifest())]).errors).toContain(
      "missing _locales/*/messages.json",
    );
  });

  it("rejects forbidden permissions", () => {
    for (const [field, value] of [
      ["permissions", ["storage", "cookies"]],
      ["permissions", ["webRequest"]],
      ["optional_permissions", ["cookies"]],
      [
        "host_permissions",
        ["<all_urls>", "https://www.streetfighter.com/6/buckler/*", `${BETA_TRACKER_ORIGIN}/*`],
      ],
    ] as const) {
      const r = validateBuild(build({ [field]: value }));
      expect(r.ok, `${field}: ${value.join(",")}`).toBe(false);
      expect(r.errors.some((e) => e.startsWith("forbidden permission"))).toBe(true);
    }
  });

  it("rejects unexpected files (.env, source maps, TypeScript, HAR, nested folders)", () => {
    for (const path of [
      ".env",
      "background.js.map",
      "src/background.ts",
      "capture.har",
      "dist/manifest.json",
      "node_modules/x/index.js",
    ]) {
      const r = validateBuild(build({}, [file(path, "x")]));
      expect(r.errors, path).toContain(`unexpected file: ${path}`);
    }
  });

  it("rejects secret-looking content but not the words the code legitimately uses", () => {
    const legit = 'const r=/cookie|authorization|password/i;fetch(u,{credentials:"omit"})';
    const ok = validateBuild(build().map((f) => (f.path === "popup.js" ? file(f.path, legit) : f)));
    expect(ok).toMatchObject({ ok: true, errors: [] });

    const leaks: Array<[string, string]> = [
      ["email address", 'const a="someone@example.com"'],
      ["private key", "-----BEGIN PRIVATE KEY-----"],
      ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"],
      ["companion device token", `t="sf6c_${"a".repeat(43)}"`],
      ["bearer token", `h="Bearer ${"b".repeat(30)}"`],
      ["cookie header value", 'h="Cookie: buckler_id=abc123"'],
      ["source map", "//# sourceMappingURL=background.js.map"],
      ["env assignment", "BETTER_AUTH_SECRET=xyz"],
      ["loopback origin", 'u="http://127.0.0.1:3000"'],
    ];
    for (const [label, content] of leaks) {
      const files = build().map((f) => (f.path === "background.js" ? file(f.path, content) : f));
      expect(validateBuild(files).errors, label).toContain(`${label} found in background.js`);
    }
  });

  it("ZIP: manifest.json at the root, deterministic bytes, lossless round trip", () => {
    const files = build();
    const zip = createZip(files);
    expect(createZip([...files].reverse()).equals(zip)).toBe(true);
    const back = readZip(zip);
    expect(back.map((f) => f.path)).toContain("manifest.json");
    expect(back.every((f) => !f.path.includes("dist/"))).toBe(true);
    for (const f of files) {
      expect(back.find((b) => b.path === f.path)?.content.equals(f.content)).toBe(true);
    }
    expect(checksumLine(sha256(zip), "x.zip")).toMatch(/^[0-9a-f]{64} {2}x\.zip\n$/);
  });

  it("ZIP reader detects corruption", () => {
    const zip = createZip(build());
    const bad = Buffer.from(zip);
    const at = bad.indexOf(Buffer.from("manifest.json")) + 20;
    bad[at] = (bad[at] ?? 0) ^ 0xff;
    expect(() => readZip(bad)).toThrow();
    expect(() => readZip(Buffer.from("not a zip"))).toThrow();
  });
});
