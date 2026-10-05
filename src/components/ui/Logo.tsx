import { getImageProps } from "next/image";
import Link from "next/link";
import { cx } from "./primitives";

/**
 * SST brand mark (official logo, docs/brand/). Art direction with one <picture>: the compact
 * symbol on mobile, symbol + "SST" from the `sm` breakpoint (640 px) up. The browser downloads
 * only the variant it shows. Assets are pre-sized transparent WebP (scripts/brand/), served
 * as-is (no runtime optimizer), with intrinsic sizes on both sources so nothing shifts.
 * Transparent assets are made for the app's dark background.
 */
const FULL = { src: "/brand/sst-logo.webp", width: 431, height: 160 } as const;
const SYMBOL = { src: "/brand/sst-symbol.webp", width: 174, height: 160 } as const;

const HEIGHT = { md: "h-9", lg: "h-11" } as const;

export function Logo({ size = "md" }: { size?: keyof typeof HEIGHT }) {
  // The link carries the accessible name; the image is decorative inside it.
  // Above the fold: fetchPriority, not preload/eager (Next docs: art direction).
  const { props: img } = getImageProps({
    ...SYMBOL,
    alt: "",
    unoptimized: true,
    fetchPriority: "high",
  });
  return (
    <Link
      href="/"
      aria-label="SST — Session Stats Tracker"
      className="flex shrink-0 items-center transition-opacity hover:opacity-90"
    >
      <picture>
        <source
          media="(min-width: 640px)"
          srcSet={FULL.src}
          width={FULL.width}
          height={FULL.height}
        />
        <img {...img} alt="" className={cx(HEIGHT[size], "w-auto select-none")} draggable={false} />
      </picture>
    </Link>
  );
}
