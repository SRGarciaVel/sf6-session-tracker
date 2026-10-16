/**
 * Shared presentation pieces of the Analytics page (server-renderable; no state). Every number
 * comes from domain/analytics: these components only format.
 */
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge, cx } from "@/components/ui/primitives";
import type { AnalyticsMode, AnalyticsRange, MatchRecord } from "@/domain/analytics/aggregate";
import type { SampleBand } from "@/domain/analytics/samples";
import { formatInteger, formatWinRate } from "@/domain/format";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import type { PlayerAnalytics } from "@/server/analytics/service";

/**
 * Stable section anchors: `/dashboard/analytics?range=…&mode=…[&character=…]#<id>`. Part of the
 * URL contract — never rename without a redirect story.
 */
export const ANALYTICS_SECTIONS = [
  "overview",
  "recent",
  "characters",
  "matchups",
  "sessions",
] as const;
export type AnalyticsSectionId = (typeof ANALYTICS_SECTIONS)[number];

/** Clears the sticky chrome when jumping to an anchor (global header + mobile section strip). */
export const SECTION_SCROLL_MARGIN = "scroll-mt-52 sm:scroll-mt-40 lg:scroll-mt-24";

export function analyticsHref(
  range: AnalyticsRange,
  mode: AnalyticsMode,
  character: CharacterKey | null = null,
): string {
  const base = `/dashboard/analytics?range=${range}&mode=${mode}`;
  return character ? `${base}&character=${encodeURIComponent(character)}` : base;
}

export function characterNameOf(data: PlayerAnalytics): string | null {
  if (!data.character) return null;
  return (
    data.characters.find((c) => c.characterKey === data.character)?.characterName ?? data.character
  );
}

/** A major page section: anchored, labelled by its own heading. */
export function AnalyticsSection({
  id,
  eyebrow,
  title,
  description,
  children,
  testId,
}: {
  id: AnalyticsSectionId;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx("space-y-4", SECTION_SCROLL_MARGIN)}
      data-testid={testId}
    >
      <AnalyticsSectionHeader id={`${id}-title`} eyebrow={eyebrow} title={title}>
        {description}
      </AnalyticsSectionHeader>
      {children}
    </section>
  );
}

/** Eyebrow (group) · title · optional one-line description — the page's single heading rhythm. */
export function AnalyticsSectionHeader({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header>
      {eyebrow && <p className="hud-label text-xs text-cyan">{eyebrow}</p>}
      <h2
        id={id}
        className="font-display text-2xl leading-tight font-extrabold tracking-wide uppercase"
      >
        {title}
      </h2>
      {children && <div className="mt-1 max-w-3xl text-sm text-muted">{children}</div>}
    </header>
  );
}

/** A sub-group inside a section (h3). */
export function SubGroupTitle({ children }: { children: ReactNode }) {
  return <h3 className="hud-heading">{children}</h3>;
}

/** One metric of a stats surface (inside a <dl>). */
export function Stat({
  label,
  value,
  children,
  className,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("min-w-0 p-5", className)}>
      <dt className="hud-label">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-bold tabular">{value}</dd>
      {children && <dd className="mt-1 flex flex-col gap-0.5 text-xs text-muted">{children}</dd>}
    </div>
  );
}

/**
 * One cohesive surface of metrics with internal separators (instead of one box per metric):
 * 2 columns on small screens, `columns` from `lg`.
 */
export function StatSurface({
  children,
  columns = 4,
  testId,
}: {
  children: ReactNode;
  columns?: 3 | 4;
  testId?: string;
}) {
  return (
    <dl
      data-testid={testId}
      className={cx(
        "hud-panel grid grid-cols-2 [&>*]:border-line [&>*:nth-child(n+3)]:border-t [&>*:nth-child(even)]:border-l",
        columns === 4
          ? "lg:grid-cols-4 lg:[&>*:nth-child(n+3)]:border-t-0 lg:[&>*:not(:first-child)]:border-l"
          : "sm:grid-cols-3 sm:[&>*:nth-child(n+3)]:border-t-0 sm:[&>*:not(:first-child)]:border-l",
      )}
    >
      {children}
    </dl>
  );
}

/** "W–L" (draws are shown separately, never folded into losses). */
export function RecordValue({ record }: { record: MatchRecord }) {
  const locale = useLocale();
  return (
    <span className="whitespace-nowrap">
      <span className="text-win">{formatInteger(record.wins, locale)}</span>
      <span className="mx-0.5 text-faint">–</span>
      <span className="text-loss">{formatInteger(record.losses, locale)}</span>
    </span>
  );
}

/** Win rate, or "—" with an explanation when there is no decided match (never 0 % / NaN). */
export function WinRate({ record }: { record: MatchRecord }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  if (record.winRate === null) return <Unavailable label={t("winRateUnavailable")} />;
  return <span>{formatWinRate(Math.round(record.winRate * 10) / 10, locale)}</span>;
}

export function Unavailable({ label }: { label: string }) {
  return (
    <span title={label}>
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** `wrap`: may break onto two lines (narrow summary columns); tables keep one line. */
export function SampleTag({ band, wrap = false }: { band: SampleBand; wrap?: boolean }) {
  const t = useTranslations("Analytics");
  return (
    <Badge
      tone="neutral"
      className={cx(
        wrap ? "h-auto max-w-full py-0.5 leading-tight" : "whitespace-nowrap",
        (band === "none" || band === "very-small") && "opacity-70",
      )}
    >
      {t(`sample.${band}`)}
    </Badge>
  );
}

const RESULT_STYLE: Record<MatchResult, string> = {
  win: "bg-win text-bg",
  loss: "bg-loss text-bg",
  draw: "bg-faint text-bg",
};

/**
 * Newest first; letters + screen-reader words, never colour alone. Visually grouped in blocks of
 * five (an extra gap after every 5th result) — one list, order unchanged.
 */
export function Sequence({ results, className }: { results: MatchResult[]; className?: string }) {
  const t = useTranslations("Analytics");
  return (
    <ol aria-label={t("sequenceLabel")} className={cx("flex flex-wrap gap-1", className)}>
      {results.map((r, i) => (
        <li
          key={i}
          data-block-end={(i + 1) % 5 === 0 && i < results.length - 1 ? "true" : undefined}
          className={cx(
            "grid h-6 w-6 place-items-center font-display text-xs font-bold",
            (i + 1) % 5 === 0 && i < results.length - 1 && "mr-2.5",
            RESULT_STYLE[r],
          )}
        >
          <span aria-hidden>{t(`resultShort.${r}`)}</span>
          <span className="sr-only">{t(`result.${r}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Table shell: scrolls INSIDE its panel on narrow screens (never the page). */
export function TablePanel({
  caption,
  minWidth,
  head,
  children,
}: {
  caption: ReactNode;
  minWidth: string;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="hud-panel">
      <div className="overflow-x-auto">
        <table className={cx("w-full text-sm", minWidth)}>
          <caption className="px-5 pt-4 pb-3 text-left text-xs text-muted">{caption}</caption>
          <thead>
            <tr className="hud-label border-b border-line text-left text-xs">{head}</tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Decorative wins-vs-losses bar (the existing `.ratio-bar` primitive). Decided matches only: draws
 * are never folded into either side, and with no decided match nothing is drawn. The numbers next
 * to it stay the accessible, primary information.
 */
export function RecordBar({ record, className }: { record: MatchRecord; className?: string }) {
  if (record.decided <= 0) return null;
  return (
    <span className={cx("ratio-bar mt-2 h-1 w-full max-w-40", className)} aria-hidden>
      <span className="bg-win" style={{ flexGrow: record.wins }} />
      <span className="bg-loss" style={{ flexGrow: record.losses }} />
    </span>
  );
}

/**
 * A long table with progressive disclosure, no client state: the first `limit` rows in a normal
 * table; the rest in a CONTINUATION table inside a native <details> (keyboard + screen readers get
 * the expanded state natively). Both tables share the column widths (`table-fixed` + colgroup) and
 * one horizontal scroll container, so columns line up and scroll together on narrow screens. The
 * row order is the caller's — nothing is re-sorted or picked.
 */
export function DisclosureTablePanel<T>({
  caption,
  continuationCaption,
  columns,
  minWidth,
  head,
  rows,
  renderRow,
  limit,
  showMore,
  showLess,
  defaultOpen = false,
  testId,
}: {
  caption: ReactNode;
  /** Screen-reader caption of the continuation table (e.g. "Characters 9–17, continued"). */
  continuationCaption: string;
  /** Column widths (CSS lengths), one per column. */
  columns: readonly string[];
  minWidth: string;
  head: ReactNode;
  rows: readonly T[];
  renderRow: (row: T) => ReactNode;
  limit: number;
  showMore: string;
  showLess: string;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const first = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const colgroup = (
    <colgroup>
      {columns.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
  return (
    <div className="hud-panel" data-testid={testId}>
      <div className="overflow-x-auto">
        <div className={minWidth}>
          <table className="w-full table-fixed text-sm" data-part="primary">
            <caption className="px-5 pt-4 pb-3 text-left text-xs text-muted">{caption}</caption>
            {colgroup}
            <thead>
              <tr className="hud-label border-b border-line text-left text-xs">{head}</tr>
            </thead>
            <tbody className="divide-y divide-line">{first.map(renderRow)}</tbody>
          </table>
          {rest.length > 0 && (
            <details className="group border-t border-line" open={defaultOpen || undefined}>
              <summary className="sticky left-0 inline-flex min-h-11 cursor-pointer items-center gap-2 px-5 font-display text-sm font-bold tracking-wide text-cyan uppercase hover:text-text">
                <span
                  aria-hidden
                  className="transition-transform group-open:rotate-90 motion-reduce:transition-none"
                >
                  ▸
                </span>
                <span className="group-open:hidden">{showMore}</span>
                <span className="hidden group-open:inline">{showLess}</span>
              </summary>
              <table className="w-full table-fixed text-sm" data-part="continuation">
                <caption className="sr-only">{continuationCaption}</caption>
                {colgroup}
                <thead className="sr-only">
                  <tr>{head}</tr>
                </thead>
                <tbody className="divide-y divide-line border-t border-line">
                  {rest.map(renderRow)}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
