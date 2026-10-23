/**
 * M2A — SST control icons: one inline-SVG set (no icon library), drawn on a 24-unit grid with a
 * 2 px stroke, square caps and mitred joins so they match SST's angular geometry. Decorative by
 * default (the control's text names the action); pass `label` only for a standalone icon.
 *
 * Only for CONTROLS. Content symbols (rating "1402 → 1414", ▲/▼ deltas, instruction paths such
 * as "OBS → Fuentes") stay as text: they are data, not affordances.
 */
import { cx } from "./primitives";

const PATHS = {
  /** Navigation forward / go to (ActionLink, CTA). */
  "arrow-right": "M4 12h15M13 6l6 6-6 6",
  /** Back to a previous / parent page. */
  "arrow-left": "M20 12H5M11 6l-6 6 6 6",
  /** Jump further down the same page. */
  "arrow-down": "M12 4v15M6 13l6 6 6-6",
  /** Opens in a new tab / outside SST. */
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  /** Disclosure (rotates 90° when open). */
  chevron: "M9 5l7 7-7 7",
  /** File download. */
  download: "M12 4v11M7 10l5 5 5-5M4 20h16",
  /** Copy to clipboard (two offset sheets). */
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  /** Done / copied. */
  check: "M4 12.5l5 5L20 6.5",
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({
  name,
  size = "1em",
  label,
  className,
}: {
  name: IconName;
  /** CSS size; defaults to the surrounding font size so icons scale with text (200 % text). */
  size?: string;
  /** Accessible name — only for an icon that is the sole content of a control. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={cx("sst-icon", className)}
      focusable="false"
      data-icon={name}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
