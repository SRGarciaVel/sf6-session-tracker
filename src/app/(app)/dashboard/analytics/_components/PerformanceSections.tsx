/** Overview · Recent form · Characters (presentation only; data from domain/analytics). */
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge, cx } from "@/components/ui/primitives";
import { formatDecimal, formatInteger, formatWinRate } from "@/domain/format";
import type { PlayerAnalytics } from "@/server/analytics/service";
import {
  AnalyticsSection,
  RecordValue,
  SampleTag,
  RecordBar,
  Sequence,
  Stat,
  StatSurface,
  DisclosureTablePanel,
  WinRate,
  analyticsHref,
} from "./parts";

export function OverviewSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const { overall, sessions } = data.summary;
  return (
    <AnalyticsSection id="overview" eyebrow={t("eyebrows.overview")} title={t("summaryTitle")}>
      <StatSurface testId="overview-stats">
        <Stat label={t("matches")} value={formatInteger(overall.matches, locale)} />
        <Stat label={t("record")} value={<RecordValue record={overall} />}>
          <RecordBar record={overall} />
          {overall.draws > 0 && <span>{t("draws", { count: overall.draws })}</span>}
        </Stat>
        <Stat label={t("winRate")} value={<WinRate record={overall} />}>
          <span>
            <SampleTag band={overall.sample} wrap />
          </span>
        </Stat>
        <Stat label={t("sessions")} value={formatInteger(sessions.sessions, locale)}>
          {sessions.averageMatchesPerSession !== null && (
            <span>
              {t("perSession", { value: formatDecimal(sessions.averageMatchesPerSession, locale) })}
            </span>
          )}
          {sessions.outsideSessions > 0 && (
            <span>{t("outsideSessions", { count: sessions.outsideSessions })}</span>
          )}
        </Stat>
      </StatSurface>
    </AnalyticsSection>
  );
}

/**
 * One surface: the latest results sequence (prominent), then compact last 5 / 10 / 20 blocks.
 * The sequence is the 20-window's results (it contains the 5 and 10 windows).
 */
export function RecentFormSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const forms = data.summary.recent;
  const latest = forms[forms.length - 1]?.results ?? [];
  return (
    <AnalyticsSection id="recent" eyebrow={t("eyebrows.recent")} title={t("recentTitle")}>
      <div className="hud-panel">
        {latest.length > 0 && (
          <div className="border-b border-line p-5">
            <p className="hud-label mb-2">{t("recentLatest")}</p>
            <Sequence results={latest} />
          </div>
        )}
        <dl className="grid sm:grid-cols-3 [&>*]:border-line [&>*:not(:first-child)]:border-t sm:[&>*:not(:first-child)]:border-t-0 sm:[&>*:not(:first-child)]:border-l">
          {forms.map((f) => (
            <div key={f.window} className="p-5" data-window={f.window}>
              <dt className="hud-label">{t("lastN", { n: f.window })}</dt>
              <dd className="mt-1 font-display text-3xl font-bold tabular">
                <RecordValue record={f.record} />
              </dd>
              <dd className="mt-1 text-sm">
                <WinRate record={f.record} />
                {f.record.draws > 0 && (
                  <span className="ml-2 text-muted">{t("draws", { count: f.record.draws })}</span>
                )}
              </dd>
              <dd className="mt-1 text-xs text-muted">
                {f.complete
                  ? t("available", { count: f.available })
                  : t("availableOf", { count: f.available, n: f.window })}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </AnalyticsSection>
  );
}

/** Rows shown before "Show N more characters" (existing order; never a ranking). */
export const CHARACTER_ROWS_INITIAL = 8;
const CHARACTER_COLUMNS = ["22%", "9%", "18%", "10%", "19%", "22%"] as const;

export function CharactersSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const filtered = data.character !== null;
  const rows = data.summary.characters;
  const hidden = Math.max(0, rows.length - CHARACTER_ROWS_INITIAL);
  const selectedIndex = rows.findIndex((c) => c.characterKey === data.character);
  return (
    <AnalyticsSection
      id="characters"
      eyebrow={t("eyebrows.characters")}
      title={t("charactersTitle")}
    >
      <DisclosureTablePanel
        testId="characters-table"
        minWidth="min-w-[44rem]"
        columns={CHARACTER_COLUMNS}
        rows={rows}
        limit={CHARACTER_ROWS_INITIAL}
        // A selected character below the cutoff opens the disclosure (order unchanged).
        defaultOpen={selectedIndex >= CHARACTER_ROWS_INITIAL}
        showMore={t("disclosure.moreCharacters", { count: hidden })}
        showLess={t("disclosure.lessCharacters")}
        continuationCaption={t("disclosure.charactersContinued", {
          from: CHARACTER_ROWS_INITIAL + 1,
          to: rows.length,
        })}
        caption={filtered ? t("charactersOverviewCaption") : t("charactersCaption")}
        head={
          <>
            <th scope="col" className="px-5 pb-2 font-semibold">
              {t("colCharacter")}
            </th>
            <th scope="col" className="px-3 pb-2 text-right font-semibold">
              {t("colMatches")}
            </th>
            <th scope="col" className="px-3 pb-2 font-semibold">
              {t("colRecord")}
            </th>
            <th scope="col" className="px-3 pb-2 text-right font-semibold">
              {t("colWinRate")}
            </th>
            <th scope="col" className="px-3 pb-2 font-semibold">
              {t("colUsage")}
            </th>
            <th scope="col" className="px-5 pb-2 font-semibold">
              {t("colSample")}
            </th>
          </>
        }
        renderRow={(c) => {
          const selected = c.characterKey === data.character;
          return (
            <tr
              key={c.characterKey}
              data-character={c.characterKey}
              data-selected={selected ? "true" : undefined}
              className={cx(
                "transition-colors motion-reduce:transition-none hover:bg-surface-2/50",
                selected && "bg-cyan/8 shadow-[inset_3px_0_0_var(--color-cyan)]",
              )}
            >
              <th scope="row" className="px-5 py-3 text-left font-display text-base font-bold">
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={analyticsHref(data.range, data.mode, c.characterKey)}
                    aria-current={selected ? "true" : undefined}
                    className="hover:text-cyan"
                  >
                    {c.characterName}
                  </Link>
                  {selected && (
                    <Badge tone="info" className="whitespace-nowrap">
                      {t("selected")}
                    </Badge>
                  )}
                  {c.mostPlayed && (
                    <Badge tone="accent" className="whitespace-nowrap">
                      {t("mostPlayed")}
                    </Badge>
                  )}
                </span>
              </th>
              <td className="px-3 py-3 text-right tabular">
                {formatInteger(c.record.matches, locale)}
              </td>
              <td className="px-3 py-3 whitespace-nowrap tabular">
                <RecordValue record={c.record} />
                {c.record.draws > 0 && (
                  <span className="ml-2 text-xs text-muted">
                    {t("draws", { count: c.record.draws })}
                  </span>
                )}
              </td>
              <td className="px-3 py-3 text-right font-semibold tabular">
                <WinRate record={c.record} />
              </td>
              <td className="px-3 py-3">
                <span className="flex items-center gap-2">
                  <span className="w-14 tabular">
                    {formatWinRate(Math.round(c.usage * 10) / 10, locale)}
                  </span>
                  <span className="hidden h-1 w-20 bg-line-strong sm:block" aria-hidden>
                    <span className="block h-full bg-cyan" style={{ width: `${c.usage}%` }} />
                  </span>
                </span>
              </td>
              <td className="px-5 py-3">
                <SampleTag band={c.record.sample} wrap />
              </td>
            </tr>
          );
        }}
      />
    </AnalyticsSection>
  );
}
