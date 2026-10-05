/**
 * "Is the installed companion up to date?" — numeric Chromium version comparison only.
 * Never claims an update from unknown or invalid data.
 */
import { compareExtensionVersions, isValidExtensionVersion } from "@sf6/capcom-core";

export type CompanionUpdateStatus =
  /** No usable installed version yet (never synced, or an invalid value). */
  | { state: "unknown" }
  /** Installed version known, but no (valid) latest version configured. */
  | { state: "installedOnly"; installed: string }
  | { state: "upToDate"; installed: string }
  | { state: "updateAvailable"; installed: string; latest: string }
  /** Installed is newer than the advertised latest (dev build, or env not bumped yet). */
  | { state: "ahead"; installed: string };

export function companionUpdateStatus(
  installed: string | null,
  latest: string | null,
): CompanionUpdateStatus {
  if (!installed || !isValidExtensionVersion(installed)) return { state: "unknown" };
  const order = latest ? compareExtensionVersions(installed, latest) : null;
  if (order === null || !latest) return { state: "installedOnly", installed };
  if (order < 0) return { state: "updateAvailable", installed, latest };
  return order === 0 ? { state: "upToDate", installed } : { state: "ahead", installed };
}
