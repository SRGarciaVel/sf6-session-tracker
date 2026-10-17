/**
 * PDF fonts (Phase 6.4B): the official static TTFs committed next to this file, registered with
 * react-pdf once per process. Never `next/font` output (its WOFF2 subsets crash fontkit on composed
 * Spanish glyphs such as Ó / Ñ / é: "RangeError: Offset is outside the bounds of the DataView"),
 * never a system font, never a runtime download. Licenses: ./fonts/licenses (SIL OFL 1.1).
 *
 *   Barlow Condensed 600 / 700 / 800  display: titles, numbers, labels
 *   Barlow           400 / 600        body: explanations, questions, methodology
 *   JetBrains Mono   500              technical metadata
 */
import path from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * Resolved from the app root (`next start` / tests run there); traced by next.config. The path is
 * a literal subfolder so the bundler traces only this folder (a variable path makes it trace the
 * whole project).
 */
export const REPORT_FONT_DIR = path.join(process.cwd(), "src/server/analytics/report/fonts");
const fontPath = (file: string) =>
  path.join(process.cwd(), "src/server/analytics/report/fonts", file);

export const REPORT_FONTS = {
  display: "SST Barlow Condensed",
  body: "SST Barlow",
  mono: "SST JetBrains Mono",
} as const;

export const REPORT_FONT_FILES = [
  { family: REPORT_FONTS.display, fontWeight: 600, file: "BarlowCondensed-SemiBold.ttf" },
  { family: REPORT_FONTS.display, fontWeight: 700, file: "BarlowCondensed-Bold.ttf" },
  { family: REPORT_FONTS.display, fontWeight: 800, file: "BarlowCondensed-ExtraBold.ttf" },
  { family: REPORT_FONTS.body, fontWeight: 400, file: "Barlow-Regular.ttf" },
  { family: REPORT_FONTS.body, fontWeight: 600, file: "Barlow-SemiBold.ttf" },
  { family: REPORT_FONTS.mono, fontWeight: 500, file: "JetBrainsMono-Medium.ttf" },
] as const;

let registered = false;

/** Idempotent. */
export function registerReportFonts(): void {
  if (registered) return;
  const byFamily = new Map<string, Array<{ src: string; fontWeight: number }>>();
  for (const f of REPORT_FONT_FILES) {
    const list = byFamily.get(f.family) ?? [];
    list.push({ src: fontPath(f.file), fontWeight: f.fontWeight });
    byFamily.set(f.family, list);
  }
  for (const [family, fonts] of byFamily) Font.register({ family, fonts });
  // Labels and titles must never be hyphenated mid-word ("Ses-sion"): break only at spaces.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/**
 * Drops the LOADED data of the report families only (registrations stay; the built-in PDF fonts are
 * untouched), so the next document re-reads fresh fontkit objects from the local TTFs. Reusing a
 * font object across documents dropped glyphs from later documents — see render-review-pdf.
 */
export function resetReportFontData(): void {
  const families = Font.getRegisteredFonts();
  for (const family of Object.values(REPORT_FONTS)) {
    for (const source of families[family]?.sources ?? []) {
      // Both fields: react-pdf 4.9's own Font.reset() clears `data` only, so `load()` would return
      // the old settled promise and never reload.
      source.data = null;
      source.loadResultPromise = null;
    }
  }
}
