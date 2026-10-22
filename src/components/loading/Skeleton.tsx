/**
 * M1 — SST loading primitives (server components, CSS only; see `.sk-*` in globals.css).
 *
 * A skeleton stands for content that is genuinely unresolved (a route still rendering on the
 * server). It never shows text, numbers, statuses or ratings, so it cannot be mistaken for data,
 * and it is never used for realtime updates (LIVE keeps its confirmed values and its own
 * pending/reconnecting states).
 */
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/**
 * The busy region of a route: one polite status with a plain-language label for assistive
 * technology, decorative shapes hidden from it, and a "still waking up" hint that only appears
 * after a real wait (cold start of the free tier).
 */
export function LoadingRegion({
  label,
  slowHint,
  children,
  className,
}: {
  label: string;
  slowHint: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-skeleton aria-busy="true" className={cx("sk-region", className)}>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div aria-hidden className="sk-shapes">
        {children}
      </div>
      <p className="sk-slow mt-4 text-center text-sm text-muted">{slowHint}</p>
    </div>
  );
}

/** A surface-coloured block; `cut` = the Fight Session forward cut (buttons, tags, CTA). */
export function SkeletonBlock({
  className,
  tone = "base",
  cut = false,
  style,
}: {
  className?: string;
  tone?: "base" | "soft" | "accent";
  cut?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cx(
        "sk-block",
        tone === "soft" && "sk-block-soft",
        tone === "accent" && "sk-block-accent",
        cut && "fs-cut",
        className,
      )}
      style={style}
    />
  );
}

/**
 * Lines of text at the size of the text they replace (`className` carries the font size, e.g.
 * `text-sm`), with deliberately uneven widths so a paragraph does not read as a table.
 */
export function SkeletonText({
  lines = 1,
  widths = ["92%", "78%", "64%"],
  className,
}: {
  lines?: number;
  widths?: readonly string[];
  className?: string;
}) {
  return (
    <span className={cx("block max-w-full", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="sk-line" style={{ width: widths[i % widths.length] }} />
      ))}
    </span>
  );
}

/**
 * A display numeral (scoreboard, results): one em tall at the numeral's own font size, so it
 * occupies the same box as the real value without suggesting one.
 */
export function SkeletonNumber({
  className,
  width = "2.2ch",
}: {
  className?: string;
  width?: string;
}) {
  return (
    <span className={cx("block font-display leading-none", className)}>
      <span className="sk-block block h-[0.82em]" style={{ width }} />
    </span>
  );
}

/** A preview at its real aspect ratio (overlay canvases). */
export function SkeletonThumbnail({
  ratio,
  className,
}: {
  /** width / height, e.g. 800 / 180 */
  ratio: number;
  className?: string;
}) {
  return (
    <span
      className={cx("sk-block sk-block-soft block w-full", className)}
      style={{ aspectRatio: String(ratio) }}
    />
  );
}
