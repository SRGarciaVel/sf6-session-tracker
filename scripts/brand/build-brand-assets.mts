/**
 * Builds every static SST brand asset from the vector geometry in
 * src/components/brand/geometry.ts (single source of truth). Phase 4.8, docs/brand/README.md.
 *
 *   public/brand/sst-monogram.svg          full colour (dark backgrounds)
 *   public/brand/sst-monogram-white.svg    single colour, white
 *   public/brand/sst-monogram-black.svg    single colour, black (light backgrounds)
 *   public/brand/sst-mark-compact.svg      compact S (tiny sizes)
 *   public/brand/sst-lockup.svg            monogram + "Session Stats Tracker"
 *   src/app/icon.svg                       compact mark on the dark tile (all modern browsers)
 *   src/app/favicon.ico                    16 / 32 / 48 (compact mark, raster fallback)
 *   src/app/apple-icon.png                 180×180, full monogram, opaque
 *   src/app/(app)/opengraph-image.png      1200×630 social preview
 *
 * Rasters are rendered by Chromium (Playwright, already a dev dependency) and packed by Pillow
 * for the .ico. Barlow comes from the app's own build (`pnpm build` first): nothing is fetched.
 * Run: pnpm build && pnpm exec tsx scripts/brand/build-brand-assets.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  BRAND_COLORS,
  COMPACT,
  COMPACT_VIEWBOX,
  SLANT_TRANSFORM,
  compactSvg,
  markSvg,
} from "../../src/components/brand/geometry";

const ROOT = resolve(import.meta.dirname, "../..");
const PUBLIC = join(ROOT, "public/brand");
const APP = join(ROOT, "src/app");
const TMP = join(ROOT, "debug_output/brand-build");
mkdirSync(PUBLIC, { recursive: true });
mkdirSync(TMP, { recursive: true });

const TITLE = "SST | Session Stats Tracker";

/* ───────── SVG files ───────── */

writeFileSync(join(PUBLIC, "sst-monogram.svg"), markSvg({ title: TITLE }) + "\n");
writeFileSync(
  join(PUBLIC, "sst-monogram-white.svg"),
  markSvg({ tone: "mono", fill: "#ffffff", title: TITLE }) + "\n",
);
writeFileSync(
  join(PUBLIC, "sst-monogram-black.svg"),
  markSvg({ tone: "mono", fill: "#000000", title: TITLE }) + "\n",
);
writeFileSync(join(PUBLIC, "sst-mark-compact.svg"), compactSvg() + "\n");

// Lockup: monogram + divider + three-line name. Text stays text (font fallbacks declared).
const mono = markSvg().replace("<svg ", '<svg x="0" y="0" width="420" height="124" ');
writeFileSync(
  join(PUBLIC, "sst-lockup.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 124" role="img" aria-label="${TITLE}"><title>${TITLE}</title>` +
    mono +
    `<rect x="446" y="18" width="2" height="88" fill="#2d3863"/>` +
    `<g fill="${BRAND_COLORS.body}" font-family="'Barlow Condensed','Barlow','Arial Narrow',sans-serif" font-weight="600" font-size="27" letter-spacing="7.5">` +
    `<text x="476" y="45">SESSION</text><text x="476" y="77">STATS</text><text x="476" y="109">TRACKER</text></g></svg>\n`,
);

// App icon tile: compact mark centred on the app background with safe padding.
const vb = COMPACT_VIEWBOX;
const side = Math.max(vb.width, vb.height) * 1.5;
const cx = vb.x + vb.width / 2;
const cy = vb.y + vb.height / 2;
writeFileSync(
  join(APP, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cx - side / 2} ${cy - side / 2} ${side} ${side}">` +
    `<rect x="${cx - side / 2}" y="${cy - side / 2}" width="${side}" height="${side}" rx="${side * 0.2}" fill="${BRAND_COLORS.ink}"/>` +
    `<g transform="${SLANT_TRANSFORM}"><path fill="${BRAND_COLORS.cyan}" d="${COMPACT.cyan}"/>` +
    `<path fill="${BRAND_COLORS.magenta}" d="${COMPACT.magenta}"/><path fill="${BRAND_COLORS.body}" d="${COMPACT.letter}"/></g></svg>\n`,
);

/* ───────── rasters ───────── */

/** @font-face rules for Barlow from the app's build output (file URLs, no network). */
function barlowFaces(): string {
  const cssDir = join(ROOT, ".next/static/chunks");
  const css = readdirSync(cssDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(join(cssDir, f), "utf8"))
    .find((c) => c.includes("Barlow Condensed"));
  if (!css) throw new Error("Run `pnpm build` first (Barlow is taken from the build output).");
  const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
  return faces
    .filter((f) => /Barlow/.test(f))
    .map((f) => f.replace(/url\(\.\.\/media\//g, `url(file://${join(ROOT, ".next/static/media")}/`))
    .join("\n");
}

const browser = await chromium.launch();
async function render(html: string, width: number, height: number, out: string) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  // A file:// page (not about:blank) so the local font files may load.
  const file = join(TMP, `render-${width}x${height}.html`);
  writeFileSync(file, html);
  await page.goto(`file://${file}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, omitBackground: false });
  await page.close();
}
const tile = (size: number, svg: string, pad: number) =>
  `<body style="margin:0;background:${BRAND_COLORS.ink};width:${size}px;height:${size}px;display:grid;place-items:center">` +
  `<div style="width:${size - pad * 2}px">${svg.replace("<svg ", '<svg style="display:block;width:100%;height:auto" ')}</div></body>`;

// favicon.ico: compact mark, 16 / 32 / 48 on the dark tile.
const sizes = [16, 32, 48];
for (const s of sizes) {
  await render(tile(s, compactSvg(), Math.round(s * 0.12)), s, s, join(TMP, `favicon-${s}.png`));
}
execFileSync("python3", [
  "-c",
  "import sys; from PIL import Image; imgs=[Image.open(p).convert('RGBA') for p in sys.argv[2:]]; imgs[-1].save(sys.argv[1], sizes=[i.size for i in imgs], append_images=imgs[:-1])",
  join(APP, "favicon.ico"),
  ...sizes.map((s) => join(TMP, `favicon-${s}.png`)),
]);

// Apple touch icon: full monogram, opaque, safe padding (iOS rounds the corners itself).
await render(tile(180, markSvg(), 26), 180, 180, join(APP, "apple-icon.png"));

// Open Graph: same layout as before, new identity.
await render(
  `<html><head><style>${barlowFaces()}
  body{margin:0;width:1200px;height:630px;background:radial-gradient(900px 420px at 50% 20%,#141a3a 0%,${BRAND_COLORS.ink} 70%);
  color:${BRAND_COLORS.body};font-family:'Barlow',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .mark{width:470px;filter:drop-shadow(0 0 18px rgba(47,224,255,.18)) drop-shadow(0 0 18px rgba(255,46,147,.14))}
  h1{margin:44px 0 0;font:700 76px/1 'Barlow Condensed',sans-serif;letter-spacing:.01em}
  p{margin:18px 0 0;font:500 30px/1.2 'Barlow',sans-serif;color:#97a1c6}
  .rule{width:480px;height:3px;margin-top:40px;background:linear-gradient(90deg,${BRAND_COLORS.cyan},${BRAND_COLORS.magenta})}
  small{margin-top:30px;font:500 22px 'Barlow',sans-serif;color:#7d87ad}</style></head>
  <body><div class="mark">${markSvg().replace("<svg ", '<svg style="display:block;width:100%;height:auto" ')}</div>
  <h1>Session Stats Tracker</h1><p>Session tracking &amp; overlays for fighting games.</p>
  <div class="rule"></div><small>Currently supporting Street Fighter 6</small></body></html>`,
  1200,
  630,
  join(APP, "(app)/opengraph-image.png"),
);

await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.log("brand assets written");
