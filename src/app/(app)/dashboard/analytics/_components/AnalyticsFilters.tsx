/**
 * The filter toolbar: period · mode · own character define the WHOLE analytics dataset. Pure URL
 * state (links + a GET form), no client state, no stored preference.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { cx } from "@/components/ui/primitives";
import {
  ANALYTICS_MODES,
  ANALYTICS_RANGES,
  DEFAULT_ANALYTICS_MODE,
  DEFAULT_ANALYTICS_RANGE,
} from "@/domain/analytics/aggregate";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { analyticsHref, characterNameOf } from "./parts";

/** "90 días · Ranked · A.K.I." — the compact active-dataset summary. */
export function useFilterContext(data: PlayerAnalytics): string {
  const t = useTranslations("Analytics");
  return [
    t(`ranges.${data.range}`),
    t(`modes.${data.mode}`),
    characterNameOf(data) ?? t("characterAll"),
  ].join(" · ");
}

export function isDefaultFilters(data: PlayerAnalytics): boolean {
  return (
    data.range === DEFAULT_ANALYTICS_RANGE &&
    data.mode === DEFAULT_ANALYTICS_MODE &&
    data.character === null
  );
}

export function AnalyticsFilters({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const { range, mode, character } = data;
  const characterName = characterNameOf(data);
  const context = useFilterContext(data);
  return (
    <section
      aria-labelledby="analytics-filters-title"
      className="hud-panel px-5 py-4"
      data-testid="analytics-filters"
    >
      <h2 id="analytics-filters-title" className="sr-only">
        {t("filters.title")}
      </h2>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <FilterGroup
          label={t("rangeLabel")}
          options={ANALYTICS_RANGES.map((r) => ({
            key: r,
            label: t(`ranges.${r}`),
            href: analyticsHref(r, mode, character),
            current: r === range,
          }))}
        />
        <FilterGroup
          label={t("modeLabel")}
          options={ANALYTICS_MODES.map((m) => ({
            key: m,
            label: t(`modes.${m}`),
            href: analyticsHref(range, m, character),
            current: m === mode,
          }))}
        />
        {data.characters.length > 0 && <CharacterFilter data={data} />}
        {!isDefaultFilters(data) && (
          <Link
            href={analyticsHref(DEFAULT_ANALYTICS_RANGE, DEFAULT_ANALYTICS_MODE, null)}
            className="ml-auto inline-flex h-9 items-center text-sm text-muted underline-offset-4 hover:text-text hover:underline"
            data-testid="analytics-reset"
          >
            {t("filters.reset")}
          </Link>
        )}
      </div>
      <p
        className="mt-3 border-t border-line pt-3 text-xs text-muted"
        data-testid="analytics-context"
      >
        <span className="hud-label mr-2 text-xs">{t("filters.context")}</span>
        <span className="text-text">{context}</span>
        {characterName && (
          <span data-testid="character-context">
            <span className="sr-only">{t("characterContext", { character: characterName })}</span>
            {" · "}
            <Link
              href={analyticsHref(range, mode, null)}
              className="text-cyan underline underline-offset-4"
            >
              {t("characterClear")}
            </Link>
          </span>
        )}
      </p>
    </section>
  );
}

function FilterGroup({
  label,
  options,
}: {
  label: string;
  options: Array<{ key: string; label: string; href: string; current: boolean }>;
}) {
  return (
    <nav aria-label={label}>
      <p className="hud-label mb-1.5 text-xs">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href}
              aria-current={o.current ? "page" : undefined}
              className={cx(
                "inline-flex h-9 items-center border px-3 font-display text-sm font-bold tracking-wide uppercase transition-colors motion-reduce:transition-none",
                "focus-visible:-outline-offset-2",
                o.current
                  ? "border-cyan bg-cyan/12 text-text"
                  : "border-line-strong text-muted hover:border-cyan hover:text-text",
              )}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** GET form: keeps range/mode, sends `character` ("" = all). Works without JavaScript. */
function CharacterFilter({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  return (
    <form method="get" action="/dashboard/analytics" className="flex flex-col">
      <label htmlFor="analytics-character" className="hud-label mb-1.5 text-xs">
        {t("characterLabel")}
      </label>
      <input type="hidden" name="range" value={data.range} />
      <input type="hidden" name="mode" value={data.mode} />
      <div className="flex gap-1">
        <select
          id="analytics-character"
          name="character"
          defaultValue={data.character ?? ""}
          className="h-9 min-w-40 border border-line-strong bg-surface-2 px-2 text-sm text-text focus-visible:border-cyan"
        >
          <option value="">{t("characterAll")}</option>
          {data.characters.map((c) => (
            <option key={c.characterKey} value={c.characterKey}>
              {c.characterName}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 border border-line-strong px-3 font-display text-sm font-bold tracking-wide text-muted uppercase hover:border-cyan hover:text-text"
        >
          {t("characterApply")}
        </button>
      </div>
    </form>
  );
}
