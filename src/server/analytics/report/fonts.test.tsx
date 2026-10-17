/**
 * Font compatibility (Phase 6.4B): the committed official TTFs must register with react-pdf and
 * render every composed Spanish glyph. `next/font` WOFF2 subsets crashed fontkit here
 * ("RangeError: Offset is outside the bounds of the DataView") on Ó / Ñ / é / ú.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { ReportBrandMark } from "./report-brand";
import { REPORT_FONTS, REPORT_FONT_DIR, REPORT_FONT_FILES, registerReportFonts } from "./fonts";

const ACCENTED = "Á É Í Ó Ú Ñ Ü á é í ó ú ñ ü · REVISIÓN DE RENDIMIENTO · Sesión · Pequeña";

describe("official local TTF fonts", () => {
  it("are committed TrueType files (never next/font output, never .next/)", () => {
    expect(REPORT_FONT_DIR).not.toContain(".next");
    for (const f of REPORT_FONT_FILES) {
      expect(f.file).toMatch(/\.ttf$/);
      const file = path.join(REPORT_FONT_DIR, f.file);
      expect(existsSync(file), f.file).toBe(true);
      // TrueType sfnt version 0x00010000.
      expect(readFileSync(file).subarray(0, 4).toString("hex"), f.file).toBe("00010000");
    }
    for (const license of ["Barlow-OFL.txt", "JetBrainsMono-OFL.txt"]) {
      const text = readFileSync(path.join(REPORT_FONT_DIR, "licenses", license), "utf8");
      expect(text).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("register and render every composed Spanish glyph in every family (no DataView error)", async () => {
    registerReportFonts();
    const buffer = await renderToBuffer(
      <Document>
        <Page size="A4" style={{ backgroundColor: "#05070f", padding: 40 }}>
          <ReportBrandMark width={160} />
          {REPORT_FONT_FILES.map((f) => (
            <View key={f.file}>
              <Text style={{ fontFamily: f.family, fontWeight: f.fontWeight, fontSize: 14 }}>
                {ACCENTED}
              </Text>
            </View>
          ))}
        </Page>
      </Document>,
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(2_000);
    // Each family is embedded (subset) under its PostScript name.
    const raw = buffer.toString("latin1");
    for (const name of [
      "BarlowCondensed-SemiBold",
      "BarlowCondensed-Bold",
      "BarlowCondensed-ExtraBold",
      "Barlow-Regular",
      "Barlow-SemiBold",
      "JetBrainsMono-Medium",
    ]) {
      expect(raw, name).toMatch(new RegExp(`/BaseFont /[A-Z]{6}\\+${name}\\b`));
    }
    expect(Object.values(REPORT_FONTS)).toHaveLength(3);
  });
});
