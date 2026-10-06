/**
 * SST brand marks (Phase 4.8, docs/brand/README.md). Inline SVG from the shared geometry: no
 * requests, no JS, crisp at any size. Server component.
 *
 *   <BrandMark variant="monogram" />  the compact identity (nav, mobile, small spaces)
 *   <BrandMark variant="lockup" />    monogram + "Session Stats Tracker" (wider headers, auth)
 *
 * tone="color": white letters + cyan/magenta slashes. tone="mono": letters only, in
 * `currentColor` (white on dark, black on light — whatever the text colour is).
 * Decorative by default (aria-hidden): the surrounding link/heading carries the name.
 * Letters and accents are separate layers (.sst-letters, .sst-accent-*) for future animation.
 */
import { cx } from "@/components/ui/primitives";
import {
  ACCENTS,
  BRAND_COLORS,
  LETTERS,
  SLANT_TRANSFORM,
  VIEWBOX_ATTR,
  type MarkTone,
} from "./geometry";

export { BRAND_FULL_NAME, BRAND_NAME } from "./names";

export function Monogram({ tone = "color", className }: { tone?: MarkTone; className?: string }) {
  return (
    <svg
      viewBox={VIEWBOX_ATTR}
      aria-hidden="true"
      focusable="false"
      className={cx("sst-monogram block w-auto shrink-0", className)}
    >
      <g transform={SLANT_TRANSFORM}>
        {tone === "color" && (
          <>
            <path className="sst-accent-cyan" fill={BRAND_COLORS.cyan} d={ACCENTS.cyan} />
            <path className="sst-accent-magenta" fill={BRAND_COLORS.magenta} d={ACCENTS.magenta} />
          </>
        )}
        <g className="sst-letters" fill={tone === "color" ? BRAND_COLORS.body : "currentColor"}>
          <path d={LETTERS.s1} />
          <path d={LETTERS.s2} />
          <path d={LETTERS.t} />
        </g>
      </g>
    </svg>
  );
}

/** Mark height and the matching size of the stacked name (three lines ≈ the mark's height). */
export const BRAND_SIZES = {
  sm: { height: "h-6", text: "text-[0.5rem]" },
  md: { height: "h-8", text: "text-[0.6rem]" },
  lg: { height: "h-10", text: "text-[0.72rem]" },
} as const;
export type BrandSize = keyof typeof BRAND_SIZES;

export function BrandMark({
  variant,
  tone = "color",
  size = "md",
  className,
}: {
  variant: "monogram" | "lockup";
  tone?: MarkTone;
  size?: BrandSize;
  className?: string;
}) {
  const { height, text } = BRAND_SIZES[size];
  if (variant === "monogram") return <Monogram tone={tone} className={cx(height, className)} />;
  return (
    <span
      aria-hidden="true"
      className={cx("sst-lockup flex items-center gap-3", height, text, className)}
    >
      <Monogram tone={tone} className="h-full" />
      <span className="h-[78%] w-px shrink-0 bg-line-strong" />
      <span className="flex flex-col justify-center font-display leading-[1.15] font-semibold tracking-[0.32em] whitespace-nowrap text-text uppercase">
        <span>Session</span>
        <span>Stats</span>
        <span>Tracker</span>
      </span>
    </span>
  );
}
