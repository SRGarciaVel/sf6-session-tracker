import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Logo } from "@/components/ui/Logo";
import { BrandMark } from "./BrandMark";
import {
  ACCENTS,
  COMPACT,
  COMPACT_VIEWBOX,
  LETTERS,
  MONOGRAM_PATHS,
  VIEWBOX,
  pathPoints,
  slantPoint,
} from "./geometry";
import { BRAND_TITLE, TITLE_TEMPLATE } from "./names";

vi.mock("@/components/overlay/fonts", () => ({ overlayFontVariables: "" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "es",
}));

const inside = (
  box: { x: number; y: number; width: number; height: number },
  paths: readonly string[],
) =>
  paths.every((d) =>
    pathPoints(d).every(([x, y]) => {
      const [sx, sy] = slantPoint(x, y);
      return sx >= box.x && sx <= box.x + box.width && sy >= box.y && sy <= box.y + box.height;
    }),
  );

describe("brand geometry", () => {
  it("every point of the monogram and compact mark is inside its viewBox (no clipping)", () => {
    expect(inside(VIEWBOX, MONOGRAM_PATHS)).toBe(true);
    expect(inside(COMPACT_VIEWBOX, [COMPACT.letter, COMPACT.cyan, COMPACT.magenta])).toBe(true);
    expect(pathPoints(LETTERS.s1).length).toBeGreaterThan(8);
  });

  it("compact mark reuses the monogram's first letter (same identity, not a new icon)", () => {
    expect(COMPACT.letter).toBe(LETTERS.s1);
    expect(COMPACT.cyan).toBe(ACCENTS.cyan);
  });
});

describe("titles", () => {
  it("default and template", async () => {
    expect(BRAND_TITLE).toBe("SST | Session Stats Tracker");
    expect(TITLE_TEMPLATE).toBe("%s | SST");
    const { generateMetadata } = await import("@/app/(app)/layout");
    const meta = await generateMetadata();
    expect(meta.title).toEqual({ default: "SST | Session Stats Tracker", template: "%s | SST" });
    expect(meta.openGraph?.siteName).toBe("SST | Session Stats Tracker");
    // Internal pages set only their own name, so the template never produces "SST | SST".
    expect(TITLE_TEMPLATE.replace("%s", "Panel")).toBe("Panel | SST");
  });

  it("no em-dash brand title remains in source, catalogs or metadata", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : [p];
      });
    const offenders = files("src")
      .filter((f) => /\.(tsx?|json|txt)$/.test(f) && !f.endsWith("brand.test.tsx"))
      .filter((f) => /SST [—–] Session Stats Tracker|· SST/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("BrandMark / Logo", () => {
  it("monogram: decorative inline SVG with separate letter and accent layers", () => {
    const html = renderToStaticMarkup(<BrandMark variant="monogram" />);
    expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('class="sst-letters"');
    expect(html).toContain("sst-accent-cyan");
    expect(html).toContain("sst-accent-magenta");
    expect(html.match(/<path/g)?.length).toBe(5);
    expect(html).not.toMatch(/<image|<filter|<script/);
  });

  it("mono tone: letters only, in currentColor (works on any background)", () => {
    const html = renderToStaticMarkup(<BrandMark variant="monogram" tone="mono" />);
    expect(html).not.toContain("sst-accent");
    expect(html).toContain('fill="currentColor"');
  });

  it("lockup: monogram + the full name", () => {
    const html = renderToStaticMarkup(<BrandMark variant="lockup" size="lg" />);
    expect(html).toContain("sst-lockup");
    for (const w of ["Session", "Stats", "Tracker"]) expect(html).toContain(`>${w}<`);
  });

  it("header link is named by the brand; responsive = monogram (mobile) + lockup (sm+)", () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('aria-label="SST | Session Stats Tracker"');
    expect(html).toContain("sm:hidden");
    expect(html).toContain("hidden sm:flex");
    const compact = renderToStaticMarkup(<Logo variant="compact" />);
    expect(compact).not.toContain("sst-lockup");
    expect(compact.match(/<svg/g)?.length).toBe(1);
  });
});

describe("assets", () => {
  const svgs = [
    "public/brand/sst-monogram.svg",
    "public/brand/sst-monogram-white.svg",
    "public/brand/sst-monogram-black.svg",
    "public/brand/sst-mark-compact.svg",
    "public/brand/sst-lockup.svg",
    "src/app/icon.svg",
  ];

  it("exist and are clean, small, viewBox-based vectors", () => {
    for (const f of svgs) {
      const svg = readFileSync(f, "utf8");
      expect(svg, f).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="/);
      expect(svg, f).not.toMatch(/<image|<filter|<metadata|inkscape|sodipodi|data:|<script/);
      expect(svg.length, f).toBeLessThan(2048);
    }
    for (const f of [
      "src/app/favicon.ico",
      "src/app/apple-icon.png",
      "src/app/(app)/opengraph-image.png",
    ]) {
      expect(existsSync(f), f).toBe(true);
    }
  });

  it("legacy raster logos are gone and nothing references them", () => {
    for (const f of [
      "public/brand/sst-logo.webp",
      "public/brand/sst-symbol.webp",
      "src/app/icon.png",
    ]) {
      expect(existsSync(f), f).toBe(false);
    }
    const logo = readFileSync("src/components/ui/Logo.tsx", "utf8");
    expect(logo).not.toMatch(/\.webp|\.png|getImageProps/);
  });
});
