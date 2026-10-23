/**
 * M2A — navigation actions. An ActionLink is a LINK (anchor semantics, never a button): text
 * first, then a directional SVG icon that tells where it goes —
 *   forward  another page / section of SST          (arrow-right)
 *   back     the parent page                         (arrow-left, leading)
 *   down     further down this page                  (arrow-down)
 *   external a new tab / outside SST                 (external; adds an accessible hint)
 *   download a file                                  (download)
 * The icon nudges in its direction on hover/focus (motion tokens; none with reduced motion).
 * For high-emphasis actions keep the angular buttons (`fs-cta`, `fs-btn`, `btn`) and put an
 * <Icon> inside them instead.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { cx } from "./primitives";

export type ActionLinkKind = "forward" | "back" | "down" | "external" | "download";

const ICON: Record<ActionLinkKind, IconName> = {
  forward: "arrow-right",
  back: "arrow-left",
  down: "arrow-down",
  external: "external",
  download: "download",
};

export function ActionLink({
  href,
  kind = "forward",
  tone = "accent",
  children,
  className,
  ...rest
}: {
  href: string;
  kind?: ActionLinkKind;
  /** accent = cyan (primary navigation); quiet = muted until hover (secondary). */
  tone?: "accent" | "quiet";
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const t = useTranslations("Common");
  const icon = <Icon name={ICON[kind]} className="sst-link-icon" />;
  const classes = cx(
    "sst-link",
    `sst-link--${kind}`,
    tone === "quiet" && "sst-link--quiet",
    className,
  );
  const body = (
    <>
      {kind === "back" && icon}
      <span>{children}</span>
      {kind !== "back" && icon}
      {kind === "external" && <span className="sr-only"> ({t("opensInNewTab")})</span>}
    </>
  );
  // In-page jumps, external pages and file downloads are plain anchors; app pages use <Link>.
  if (kind === "external") {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes} {...rest}>
        {body}
      </a>
    );
  }
  if (kind === "down" || kind === "download" || href.startsWith("#")) {
    return (
      <a href={href} className={classes} {...rest}>
        {body}
      </a>
    );
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {body}
    </Link>
  );
}
