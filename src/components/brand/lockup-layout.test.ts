import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCKUP_LAYOUT } from "./geometry";

describe("LOCKUP_LAYOUT is the published official lockup", () => {
  it("matches public/brand/sst-lockup.svg (canvas, mark box, divider, words)", () => {
    const svg = readFileSync(
      fileURLToPath(new URL("../../../public/brand/sst-lockup.svg", import.meta.url)),
      "utf8",
    );
    const { width, height, mark, divider, words } = LOCKUP_LAYOUT;
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain(
      `<svg x="${mark.x}" y="${mark.y}" width="${mark.width}" height="${mark.height}"`,
    );
    expect(svg).toContain(
      `<rect x="${divider.x}" y="${divider.y}" width="${divider.width}" height="${divider.height}"`,
    );
    expect(svg).toContain(
      `font-weight="${words.fontWeight}" font-size="${words.fontSize}" letter-spacing="${words.letterSpacing}"`,
    );
    for (const [i, w] of ["SESSION", "STATS", "TRACKER"].entries()) {
      expect(svg).toContain(`<text x="${words.x}" y="${words.baselines[i]}">${w}</text>`);
    }
  });
});
