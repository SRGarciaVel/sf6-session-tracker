/**
 * Closed-beta packaging of the SF6 Session Companion (pure helpers; the CLIs are
 * package-beta.mts and inspect.mts). One place for the beta tracker origin, the release file
 * names (derived from manifest.version), the pre-package validation and a deterministic ZIP
 * writer/reader (fixed timestamps + sorted entries ⇒ same input, same SHA-256).
 *
 * The ZIP holds the build output at its ROOT (manifest.json, background.js, …): unzipped it is
 * the folder testers pick in "Load unpacked", and it is the layout the Chrome Web Store expects.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { BUCKLER_HOST_PERMISSION } from "../src/lib/tracker-origins";

/** The only tracker the closed-beta build may talk to. */
export const BETA_TRACKER_ORIGIN = "https://sf6-session-tracker-web.onrender.com";
export const RELEASE_BASENAME = "sf6-session-companion";
export const RELEASE_CHANNEL = "beta";

/** Files every distributable build must contain. */
export const REQUIRED_FILES = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "popup.css",
] as const;
/** Every file in the package must match one of these (anything else fails validation). */
const ALLOWED_FILE =
  /^(manifest\.json|background\.js|popup\.(html|js|css)|_locales\/[a-zA-Z_]+\/messages\.json|icons\/[\w-]+\.png)$/;
const FORBIDDEN_PERMISSIONS = ["cookies", "webRequest", "webRequestBlocking", "<all_urls>"];

/* ───────── naming ───────── */

/** Chromium accepts 1–4 dot-separated integers (0–65535), no suffixes. */
export function isValidChromeVersion(version: string): boolean {
  const parts = version.split(".");
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((p) => /^(0|[1-9]\d{0,4})$/.test(p) && Number(p) <= 65535)
  );
}

/** manifest "0.1.0" → "sf6-session-companion-v0.1.0-beta" (suffix only in the file name). */
export function releaseName(version: string): string {
  if (!isValidChromeVersion(version)) throw new Error(`invalid manifest version: ${version}`);
  return `${RELEASE_BASENAME}-v${version}-${RELEASE_CHANNEL}`;
}

/* ───────── validation ───────── */

export interface BuildFile {
  /** Path inside the package, "/" separated (e.g. "_locales/es/messages.json"). */
  path: string;
  content: Buffer;
}

interface Manifest {
  manifest_version?: unknown;
  version?: unknown;
  permissions?: unknown;
  optional_permissions?: unknown;
  host_permissions?: unknown;
  optional_host_permissions?: unknown;
  content_scripts?: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Content that must never ship to testers (values, not words: the code may say "cookie"). */
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["loopback origin", /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["JWT", /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ["companion device token", /sf6c_[A-Za-z0-9_-]{20,}/],
  ["bearer token", /Bearer\s+[A-Za-z0-9._~+/-]{20,}=*/],
  ["cookie header value", /(?:^|[\s"'`])(?:set-)?cookie:\s*[^\s=;"'`]+=[^\s;"'`]+/im],
  ["source map", /sourceMappingURL=/],
  ["env assignment", /\b(?:DATABASE_URL|BETTER_AUTH_SECRET|TEST_DATABASE_URL)\s*=/],
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  version: string | null;
}

/**
 * Everything checked before a beta package may be created. `trackerOrigins` is the exact set
 * of tracker origins the package must allow (the beta: only BETA_TRACKER_ORIGIN).
 */
export function validateBuild(
  files: readonly BuildFile[],
  trackerOrigins: readonly string[] = [BETA_TRACKER_ORIGIN],
): ValidationResult {
  const errors: string[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));

  for (const required of REQUIRED_FILES) {
    if (!byPath.has(required)) errors.push(`missing ${required}`);
  }
  if (!files.some((f) => f.path.startsWith("_locales/") && f.path.endsWith("/messages.json"))) {
    errors.push("missing _locales/*/messages.json");
  }
  for (const f of files) {
    if (!ALLOWED_FILE.test(f.path)) errors.push(`unexpected file: ${f.path}`);
  }

  let version: string | null = null;
  const raw = byPath.get("manifest.json");
  if (raw) {
    let manifest: Manifest | null = null;
    try {
      manifest = JSON.parse(raw.content.toString("utf8")) as Manifest;
    } catch {
      errors.push("manifest.json is not valid JSON");
    }
    if (manifest) {
      if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
      if (typeof manifest.version === "string" && isValidChromeVersion(manifest.version)) {
        version = manifest.version;
      } else {
        errors.push(`invalid manifest version: ${String(manifest.version)}`);
      }
      const permissions = [
        ...strings(manifest.permissions),
        ...strings(manifest.optional_permissions),
      ];
      const hosts = [
        ...strings(manifest.host_permissions),
        ...strings(manifest.optional_host_permissions),
      ];
      for (const p of [...permissions, ...hosts]) {
        if (FORBIDDEN_PERMISSIONS.includes(p)) errors.push(`forbidden permission: ${p}`);
      }
      if (manifest.content_scripts !== undefined) errors.push("unexpected content_scripts");
      const expectedHosts = [BUCKLER_HOST_PERMISSION, ...trackerOrigins.map((o) => `${o}/*`)];
      for (const h of expectedHosts) {
        if (!hosts.includes(h)) errors.push(`missing host permission: ${h}`);
      }
      for (const h of hosts) {
        if (!expectedHosts.includes(h)) errors.push(`unexpected host permission: ${h}`);
      }
    }
  }

  for (const f of files) {
    const text = f.content.toString("utf8");
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) errors.push(`${label} found in ${f.path}`);
    }
  }
  return { ok: errors.length === 0, errors, version };
}

/** Recursively read a build directory as package entries (sorted, "/" separated). */
export function readBuildDir(dir: string): BuildFile[] {
  const out: BuildFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push({ path: relative(dir, full).split(sep).join("/"), content: readFileSync(full) });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/* ───────── deterministic ZIP (PKZIP 2.0, deflate) ───────── */

/** 1980-01-01 00:00 in MS-DOS format: fixed so the archive bytes depend only on content. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function createZip(files: readonly BuildFile[]): Buffer {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of sorted) {
    const name = Buffer.from(f.path, "utf8");
    const data = deflateRawSync(f.content, { level: 9 });
    const crc = crc32(f.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(f.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(f.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Reads a ZIP (stored or deflate entries) back into files, verifying every CRC. */
export function readZip(zip: Buffer): BuildFile[] {
  const endAt = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error("not a ZIP file (no end of central directory)");
  const count = zip.readUInt16LE(endAt + 10);
  let p = zip.readUInt32LE(endAt + 16);
  const files: BuildFile[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const path = zip.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const data = zip.subarray(dataAt, dataAt + compressedSize);
    if (path.endsWith("/")) continue; // directory entry
    const content = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : null;
    if (!content) throw new Error(`unsupported compression in ${path}`);
    if (crc32(content) !== crc) throw new Error(`CRC mismatch in ${path}`);
    files.push({ path, content });
  }
  return files;
}

export const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** `sha256sum` format, so `sha256sum -c <file>` verifies the download. */
export const checksumLine = (hash: string, fileName: string): string => `${hash}  ${fileName}\n`;
