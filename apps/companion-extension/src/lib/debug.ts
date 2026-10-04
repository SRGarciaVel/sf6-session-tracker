/**
 * Debug builds (`pnpm companion:dev`, or COMPANION_DEBUG=1 pnpm companion:build) show technical
 * diagnostics in the popup and test every transport. Normal builds keep the popup clean; the
 * same safe diagnostics are still stored in chrome.storage.local for support.
 */
declare const __SF6_COMPANION_DEBUG__: boolean | undefined;

export const COMPANION_DEBUG: boolean =
  typeof __SF6_COMPANION_DEBUG__ !== "undefined" ? __SF6_COMPANION_DEBUG__ : false;
