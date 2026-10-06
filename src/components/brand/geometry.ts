/**
 * SST monogram geometry — the single source of truth for every brand asset (React mark,
 * public/brand/*.svg, favicons, app icons, Open Graph). Reconstructed as clean vectors from the
 * approved "HUD Slash" concept; the concept image is reference only, never shipped.
 *
 * Paths are drawn UPRIGHT on a 100-unit cap height and slanted by one group transform
 * (SLANT_DEG), so letters and accents stay separate, editable layers for future animation.
 *   body   — S, S, T (one path per letter)
 *   cyan   — leading slash on the left
 *   magenta— trailing slashes on the right / below
 * The body alone is the mark: accents are optional (monochrome = body only).
 */
export const SLANT_DEG = -24;
const SLANT = Math.tan((-SLANT_DEG * Math.PI) / 180); // horizontal shift per unit of height

export const CAP = 100;

/** Letters (upright coordinates). Blocky HUD S: top bar, spine, middle bar, spine, bottom bar. */
export const LETTERS = {
  s1: "M10 0H122V25H34V37H122V100H0V75H88V63H0V10Z",
  s2: "M144 0H256V25H168V37H256V100H134V75H222V63H134V10Z",
  t: "M268 0H384L374 25H340V100H312V25H268Z",
} as const;

/** Accent slashes (upright coordinates, slanted with the letters). */
export const ACCENTS = {
  cyan: "M-34 70L-12 -10H60L52 -4H-6Z",
  magenta: "M150 114H300L290 108H160ZM318 42H400L392 47H322Z",
} as const;

/** Slant pivot is the baseline (y = CAP): letters lean right, the baseline stays put. */
export const SLANT_TRANSFORM = `translate(0 ${CAP}) skewX(${SLANT_DEG}) translate(0 ${-CAP})`;

/** Where an upright point lands after the slant (used for bounds and tests). */
export function slantPoint(x: number, y: number): [number, number] {
  return [x + SLANT * (CAP - y), y];
}

/** All coordinates of a path made of absolute M/L/H/V commands (our paths only use these). */
export function pathPoints(d: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)) {
    const n = (args ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        x = n[i] ?? 0;
        y = n[i + 1] ?? 0;
        points.push([x, y]);
      }
    } else if (cmd === "H") {
      for (const v of n) {
        x = v;
        points.push([x, y]);
      }
    } else if (cmd === "V") {
      for (const v of n) {
        y = v;
        points.push([x, y]);
      }
    }
  }
  return points;
}

function boundsOf(paths: readonly string[], pad: number) {
  const pts = paths.flatMap((d) => pathPoints(d).map(([px, py]) => slantPoint(px, py)));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.floor(Math.min(...xs) - pad);
  const minY = Math.floor(Math.min(...ys) - pad);
  return {
    x: minX,
    y: minY,
    width: Math.ceil(Math.max(...xs) + pad) - minX,
    height: Math.ceil(Math.max(...ys) + pad) - minY,
  };
}

/** Full monogram: S S T + accents. */
export const MONOGRAM_PATHS = [LETTERS.s1, LETTERS.s2, LETTERS.t, ACCENTS.cyan, ACCENTS.magenta];
export const VIEWBOX = boundsOf(MONOGRAM_PATHS, 4);
export const VIEWBOX_ATTR = `${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.width} ${VIEWBOX.height}`;

/**
 * Compact mark for tiny sizes (≤ 32 px favicons): the same first S and the same slash language,
 * because three letters at 16 px are illegible. Not a different icon: a crop of the monogram.
 */
export const COMPACT = {
  letter: LETTERS.s1,
  cyan: "M-34 70L-12 -10H60L52 -4H-6Z",
  magenta: "M14 114H118L108 108H24Z",
} as const;
export const COMPACT_VIEWBOX = boundsOf([COMPACT.letter, COMPACT.cyan, COMPACT.magenta], 4);

export const BRAND_COLORS = {
  body: "#eef1fb",
  cyan: "#2fe0ff",
  magenta: "#ff2e93",
  ink: "#05070f",
} as const;

export type MarkTone = "color" | "mono";

function svg(
  viewBox: { x: number; y: number; width: number; height: number },
  inner: string,
  title?: string,
): string {
  const vb = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  const label = title
    ? ` role="img" aria-label="${title}"><title>${title}</title>`
    : ` aria-hidden="true">`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${label}<g transform="${SLANT_TRANSFORM}">${inner}</g></svg>`;
}

/** Standalone SVG markup of the monogram (static files, icons). `mono` = letters only. */
export function markSvg(opts: { tone?: MarkTone; fill?: string; title?: string } = {}): string {
  const fill = opts.fill ?? BRAND_COLORS.body;
  const accents =
    (opts.tone ?? "color") === "color"
      ? `<path class="sst-accent-cyan" fill="${BRAND_COLORS.cyan}" d="${ACCENTS.cyan}"/>` +
        `<path class="sst-accent-magenta" fill="${BRAND_COLORS.magenta}" d="${ACCENTS.magenta}"/>`
      : "";
  const letters =
    `<g class="sst-letters" fill="${fill}">` +
    `<path d="${LETTERS.s1}"/><path d="${LETTERS.s2}"/><path d="${LETTERS.t}"/></g>`;
  return svg(VIEWBOX, accents + letters, opts.title);
}

/** Standalone SVG markup of the compact mark (favicons). */
export function compactSvg(opts: { tone?: MarkTone; fill?: string } = {}): string {
  const fill = opts.fill ?? BRAND_COLORS.body;
  const accents =
    (opts.tone ?? "color") === "color"
      ? `<path fill="${BRAND_COLORS.cyan}" d="${COMPACT.cyan}"/><path fill="${BRAND_COLORS.magenta}" d="${COMPACT.magenta}"/>`
      : "";
  return svg(COMPACT_VIEWBOX, `${accents}<path fill="${fill}" d="${COMPACT.letter}"/>`);
}
