/**
 * pnpm companion:package:beta
 *
 * Clean production build for the closed beta (tracker origin forced to BETA_TRACKER_ORIGIN),
 * validated, then zipped with manifest.json at the ZIP root:
 *
 *   artifacts/sf6-session-companion-v<manifest.version>-beta.zip
 *   artifacts/sf6-session-companion-v<manifest.version>-beta.sha256   (sha256sum -c format)
 *   artifacts/sf6-session-companion-beta.{zip,sha256}                  (stable names for Releases)
 *
 * Any failed check ⇒ no package and a non-zero exit code.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BETA_TRACKER_ORIGIN,
  checksumLine,
  createZip,
  readBuildDir,
  readZip,
  releaseName,
  STABLE_ASSET_BASENAME,
  sha256,
  validateBuild,
} from "./release";

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extensionDir, "../..");
const distDir = join(extensionDir, "dist");
const artifactsDir = join(repoRoot, "artifacts");

function fail(message: string, details: readonly string[] = []): never {
  console.error(`✗ ${message}`);
  for (const d of details) console.error(`  - ${d}`);
  console.error("No package was created.");
  process.exit(1);
}

// 1. Clean previous output first (a failed run must not leave a stale package of this version
//    behind), then build for production with ONLY the beta origin.
const sourceVersion = (
  JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8")) as { version: string }
).version;
const name = releaseName(sourceVersion);
const zipPath = join(artifactsDir, `${name}.zip`);
const sumPath = join(artifactsDir, `${name}.sha256`);
// Stable names for GitHub Releases (…/releases/latest/download/<stable>.zip): same bytes.
const stableZipPath = join(artifactsDir, `${STABLE_ASSET_BASENAME}.zip`);
const stableSumPath = join(artifactsDir, `${STABLE_ASSET_BASENAME}.sha256`);
for (const p of [zipPath, sumPath, stableZipPath, stableSumPath]) rmSync(p, { force: true });
rmSync(distDir, { recursive: true, force: true });
const env: NodeJS.ProcessEnv = { ...process.env, COMPANION_TRACKER_ORIGINS: BETA_TRACKER_ORIGIN };
delete env.COMPANION_DEBUG;
const build = spawnSync("pnpm", ["companion:build:prod"], {
  cwd: repoRoot,
  env,
  stdio: "inherit",
});
if (build.status !== 0) fail(`production build failed (exit ${build.status ?? "signal"})`);

// 2. Validate the build before packaging.
const files = readBuildDir(distDir);
const result = validateBuild(files, [BETA_TRACKER_ORIGIN]);
if (!result.ok || !result.version) fail("build validation failed", result.errors);
if (result.version !== sourceVersion) fail(`built version ${result.version} ≠ ${sourceVersion}`);

// 3. Package (deterministic) + re-validate what is actually inside the ZIP.
mkdirSync(artifactsDir, { recursive: true });

const zip = createZip(files);
const roundTrip = validateBuild(readZip(zip), [BETA_TRACKER_ORIGIN]);
if (!roundTrip.ok) fail("packaged ZIP failed validation", roundTrip.errors);

const hash = sha256(zip);
writeFileSync(zipPath, zip);
writeFileSync(sumPath, checksumLine(hash, `${name}.zip`));
writeFileSync(stableZipPath, zip);
writeFileSync(stableSumPath, checksumLine(hash, `${STABLE_ASSET_BASENAME}.zip`));

console.log(`\n✓ SF6 Session Companion ${result.version} (beta) packaged`);
console.log(`  tracker:  ${BETA_TRACKER_ORIGIN}`);
console.log(
  `  zip:      ${relative(repoRoot, zipPath)} (${zip.length} bytes, ${files.length} files)`,
);
console.log(`  sha256:   ${hash}`);
console.log(`  checksum: ${relative(repoRoot, sumPath)}`);
console.log(
  `  release:  ${relative(repoRoot, stableZipPath)} + .sha256 (stable names, same bytes)`,
);
