/**
 * Release guard (used by .github/workflows/companion-release.yml):
 *
 *   tsx apps/companion-extension/release/check-release.mts <existing tags, newline separated>
 *
 * Prints the tag to create (companion-v<manifest.version>) or exits 1 if the version was
 * already released or is not newer than every published companion release.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkNewRelease, releaseTag } from "./release";

const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "../manifest.json");
const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
const tags = (process.argv[2] ?? "")
  .split(/\s+/)
  .map((t) => t.trim())
  .filter(Boolean);

const result = checkNewRelease(version, tags);
if (!result.ok) {
  console.error(`✗ ${result.error}`);
  process.exit(1);
}
console.log(releaseTag(version));
