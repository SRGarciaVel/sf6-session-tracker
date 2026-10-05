/**
 * Companion (Chromium extension) versions: 1–4 dot-separated integers 0–65535, no suffixes
 * (manifest.json `version`). Compared numerically per part, never lexicographically
 * (0.1.10 > 0.1.9), with missing parts as 0 (1.0 == 1.0.0).
 */
export function isValidExtensionVersion(version: string): boolean {
  const parts = version.split(".");
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((p) => /^(0|[1-9]\d{0,4})$/.test(p) && Number(p) <= 65535)
  );
}

/** -1 / 0 / 1, or null when either version is invalid (callers then show nothing). */
export function compareExtensionVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (!isValidExtensionVersion(a) || !isValidExtensionVersion(b)) return null;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
