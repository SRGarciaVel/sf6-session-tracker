import { useTranslations } from "next-intl";
import { useId, type ComponentType, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/primitives";
import type { OverlayKindLabel } from "./types";

type LinkLike = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
}>;

const PlainLink: LinkLike = ({ href, className, children, ...rest }) => (
  <a href={href} className={className} {...rest}>
    {children}
  </a>
);

/**
 * One overlay: its real preview (passed in, e.g. `OverlayView`), kind and canvas, OBS state when
 * known and the three actions (configure, copy OBS URL, open preview). URLs are passed through
 * untouched. `LinkComponent` lets the app use `next/link` for the in-app configure route.
 */
export function OverlayAccessCard({
  name,
  kind,
  canvas,
  url,
  configureHref,
  previewHref,
  inObs = null,
  preview,
  LinkComponent = PlainLink,
  className,
}: {
  name: string;
  kind: OverlayKindLabel;
  canvas: { width: number; height: number };
  /** Public OBS URL (copied as-is). */
  url: string;
  configureHref: string;
  previewHref: string;
  /** Connected as an OBS source; null = unknown (nothing shown). */
  inObs?: boolean | null;
  preview?: ReactNode;
  LinkComponent?: LinkLike;
  className?: string;
}) {
  const t = useTranslations("FightSession.overlays");
  return (
    <article
      className={cx("grid content-start gap-3 border border-line bg-surface p-4", className)}
    >
      {preview && (
        <div className="fs-overlay-preview overflow-hidden" aria-hidden>
          {preview}
        </div>
      )}
      <div className="min-w-0">
        <h3 className="m-0 truncate font-display text-xl font-bold uppercase">{name}</h3>
        <p className="m-0 text-sm text-muted">
          {t(`kind.${kind}`)} · <span className="tabular">{t("canvas", canvas)}</span>
        </p>
        {inObs !== null && (
          <p className={cx("m-0 text-sm", inObs ? "text-win" : "text-muted")}>
            <span aria-hidden>{inObs ? "● " : "○ "}</span>
            {inObs ? t("inObs") : t("notInObs")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton
          value={url}
          label={t("copy")}
          copiedLabel={t("copied")}
          ariaLabel={t("copyNamed", { name })}
          size="sm"
        />
        <LinkComponent
          href={configureHref}
          className="fs-btn fs-btn-sm fs-cut"
          aria-label={t("configureNamed", { name })}
        >
          {t("configure")}
        </LinkComponent>
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          className="fs-btn fs-btn-sm fs-cut"
          aria-label={t("previewNamed", { name })}
        >
          {t("preview")} <Icon name="external" />
        </a>
      </div>
    </article>
  );
}

/** Overlay dock: the overlay cards plus the way to manage them (and an honest empty state). */
export function OverlayDock({
  children,
  count,
  manageHref,
  LinkComponent = PlainLink,
  className,
}: {
  children?: ReactNode;
  count: number;
  manageHref: string;
  LinkComponent?: LinkLike;
  className?: string;
}) {
  const t = useTranslations("FightSession.overlays");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={cx("grid gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="fs-eyebrow m-0">
          {t("title")}
        </h2>
        <LinkComponent href={manageHref} className="fs-btn fs-btn-sm fs-cut">
          {t("manage")} <Icon name="arrow-right" />
        </LinkComponent>
      </div>
      {count === 0 ? (
        <p className="m-0 text-sm text-muted">{t("empty")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
      )}
      <p className="m-0 text-sm text-muted">{t("hint")}</p>
    </section>
  );
}
