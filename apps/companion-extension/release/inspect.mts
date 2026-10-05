/**
 * pnpm companion:inspect:prod — summary of the packaged beta ZIP (no secrets are printed: the
 * package cannot contain any, and only manifest fields, file names and sizes are shown).
 * Exit code ≠ 0 if the package is missing, its checksum file disagrees or validation fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BUCKLER_HOST_PERMISSION } from "../src/lib/tracker-origins";
import { BETA_TRACKER_ORIGIN, readZip, releaseName, sha256, validateBuild } from "./release";

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extensionDir, "../..");
const sourceManifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8")) as {
  version: string;
};
const name = releaseName(sourceManifest.version);
const zipPath = join(repoRoot, "artifacts", `${name}.zip`);
const sumPath = join(repoRoot, "artifacts", `${name}.sha256`);

if (!existsSync(zipPath)) {
  console.error(`✗ ${relative(repoRoot, zipPath)} not found — run: pnpm companion:package:beta`);
  process.exit(1);
}
const zip = readFileSync(zipPath);
const files = readZip(zip);
const manifestFile = files.find((f) => f.path === "manifest.json");
const manifest = manifestFile
  ? (JSON.parse(manifestFile.content.toString("utf8")) as {
      version?: string;
      permissions?: string[];
      host_permissions?: string[];
    })
  : {};
const hosts = manifest.host_permissions ?? [];
const hash = sha256(zip);
const recorded = existsSync(sumPath) ? readFileSync(sumPath, "utf8").split(/\s+/)[0] : null;
const validation = validateBuild(files, [BETA_TRACKER_ORIGIN]);

const row = (label: string, value: string) => console.log(`${label.padEnd(18)}${value}`);
row("Package:", relative(repoRoot, zipPath));
row("Version:", manifest.version ?? "?");
row(
  "Tracker origins:",
  hosts
    .filter((h) => h !== BUCKLER_HOST_PERMISSION)
    .map((h) => h.replace(/\/\*$/, ""))
    .join(", "),
);
row("Host permissions:", hosts.join(", "));
row("Permissions:", (manifest.permissions ?? []).join(", "));
row("Files:", "");
for (const f of files)
  console.log(`  ${f.path.padEnd(28)}${String(f.content.length).padStart(9)} B`);
row("ZIP size:", `${zip.length} B`);
row("SHA256:", hash);
row("Checksum file:", recorded === null ? "missing" : recorded === hash ? "matches" : "MISMATCH");
row("Validation:", validation.ok ? "PASS" : "FAIL");
for (const e of validation.errors) console.log(`  - ${e}`);

if (!validation.ok || recorded !== hash) process.exit(1);
