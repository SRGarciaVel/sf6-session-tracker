/**
 * Published companion release, from configuration only (no GitHub API at runtime):
 *   COMPANION_DOWNLOAD_URL   stable link, e.g. …/releases/latest/download/sf6-session-companion-beta.zip
 *   COMPANION_LATEST_VERSION newest released manifest version (set after each release)
 */
import { isValidExtensionVersion } from "@sf6/capcom-core";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

export interface CompanionRelease {
  latestVersion: string | null;
  downloadUrl: string | null;
  /** The release's .sha256 next to the .zip (same naming), when derivable. */
  checksumUrl: string | null;
}

let warned = false;

export function getCompanionRelease(): CompanionRelease {
  const env = getEnv();
  const raw = env.COMPANION_LATEST_VERSION ?? null;
  let latestVersion: string | null = null;
  if (raw !== null) {
    if (isValidExtensionVersion(raw)) latestVersion = raw;
    else if (!warned) {
      warned = true;
      logger.warn("companion.latest_version_invalid", { value: raw.slice(0, 32) });
    }
  }
  const downloadUrl = env.COMPANION_DOWNLOAD_URL ?? null;
  const checksumUrl =
    downloadUrl && downloadUrl.endsWith(".zip") ? `${downloadUrl.slice(0, -4)}.sha256` : null;
  return { latestVersion, downloadUrl, checksumUrl };
}
