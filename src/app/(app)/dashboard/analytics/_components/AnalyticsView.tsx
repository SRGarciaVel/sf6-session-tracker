/**
 * Analytics workspace: page identity → filter toolbar (defines the whole dataset) → coverage note
 * → [section nav | sections] → methodology disclosure.
 *
 * Everything here is server-rendered presentation; the only client component is the in-page
 * section navigation (AnalyticsSectionNav: anchors + scroll-spy). Every number comes from
 * domain/analytics — nothing is computed here besides formatting.
 */
import { useTranslations } from "next-intl";
import type { PlayerAnalytics } from "@/server/analytics/service";
import { AnalyticsFilters, useFilterContext } from "./AnalyticsFilters";
import { AnalyticsSectionNav, type SectionNavGroup } from "./AnalyticsSectionNav";
import { MatchupsSection } from "./MatchupsSection";
import { cx } from "@/components/ui/primitives";
import { SECTION_SCROLL_MARGIN, characterNameOf, type AnalyticsSectionId } from "./parts";
import { CharactersSection, OverviewSection, RecentFormSection } from "./PerformanceSections";
import { SessionPerformanceSection } from "./SessionPerformanceSection";

export { analyticsHref } from "./parts";

/** Sidebar groups → sections, in page order. */
const NAV: ReadonlyArray<{
  group: "overview" | "performance" | "matchups" | "sessions";
  items: AnalyticsSectionId[];
}> = [
  { group: "overview", items: ["overview"] },
  { group: "performance", items: ["recent", "characters"] },
  { group: "matchups", items: ["matchups"] },
  { group: "sessions", items: ["sessions"] },
];

export function AnalyticsView({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const context = useFilterContext(data);
  const { summary, mode } = data;
  const empty = summary.overall.matches === 0;
  const characterName = characterNameOf(data);

  // Only the sections actually rendered are navigable.
  const present = new Set<AnalyticsSectionId>(
    empty
      ? characterName && summary.characters.length > 0
        ? ["overview", "characters"]
        : ["overview"]
      : ["overview", "recent", "characters", "matchups", "sessions"],
  );
  const groups: SectionNavGroup[] = NAV.map(({ group, items }) => ({
    label: t(`nav.groups.${group}`),
    items: items
      .filter((id) => present.has(id))
      .map((id) => ({ id, label: t(`nav.items.${id}`), shortLabel: t(`nav.short.${id}`) })),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      <header>
        <h1 className="font-display text-4xl leading-none font-extrabold uppercase italic sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("subtitle")}</p>
      </header>

      <AnalyticsFilters data={data} />

      <aside
        role="note"
        aria-label={t("coverageTitle")}
        className="border-l-2 border-cyan bg-surface-2/60 px-4 py-3 text-sm text-muted"
      >
        <p>{t("coverage")}</p>
        {mode === "all" && summary.unknownModeMatches > 0 && (
          <p className="mt-1">{t("unknownModeNote", { count: summary.unknownModeMatches })}</p>
        )}
      </aside>

      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <AnalyticsSectionNav label={t("nav.label")} groups={groups} context={context} />

        <div className="min-w-0 space-y-12 pt-4 lg:pt-0">
          {empty ? (
            <>
              <section
                id="overview"
                aria-labelledby="overview-title"
                className={cx("hud-panel p-5", SECTION_SCROLL_MARGIN)}
              >
                <h2 id="overview-title" className="font-display text-xl font-bold uppercase">
                  {characterName
                    ? t("emptyCharacterTitle", { character: characterName })
                    : t("emptyTitle")}
                </h2>
                <p className="mt-2 text-sm text-muted">{t("emptyHint")}</p>
              </section>
              {present.has("characters") && <CharactersSection data={data} />}
            </>
          ) : (
            <>
              <OverviewSection data={data} />
              <RecentFormSection data={data} />
              <CharactersSection data={data} />
              <MatchupsSection data={data} />
              <SessionPerformanceSection data={data} />
            </>
          )}

          <footer className="border-t border-line pt-5" data-testid="analytics-end">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-sm font-extrabold tracking-[0.14em] text-heading uppercase">
                {t("end.brand")}
              </span>
              <span className="text-xs text-muted">
                {t("end.basedOn", { count: summary.overall.matches })} · {context}
              </span>
            </p>
            <details className="group mt-4 text-sm" data-testid="methodology">
              <summary className="cursor-pointer font-display font-bold tracking-wide text-muted uppercase hover:text-text">
                {t("methodology.title")}
              </summary>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs text-muted">
                <li>{t("sampleNote")}</li>
                <li>{t("drawsExcluded")}</li>
                <li>{t("rangeNote")}</li>
                <li>{t("matchups.note")}</li>
                <li>{t("sessionPerformance.note")}</li>
                <li>{t("sessionPerformance.durationNote")}</li>
              </ul>
            </details>
          </footer>
        </div>
      </div>
    </div>
  );
}
