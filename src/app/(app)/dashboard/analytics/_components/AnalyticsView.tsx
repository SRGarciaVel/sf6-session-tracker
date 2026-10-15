import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge, Panel, cx } from "@/components/ui/primitives";
import {
  ANALYTICS_MODES,
  ANALYTICS_RANGES,
  type AnalyticsMode,
  type AnalyticsRange,
  type MatchRecord,
  type RecentForm,
} from "@/domain/analytics/aggregate";
import type { SampleBand } from "@/domain/analytics/samples";
import { formatDecimal, formatInteger, formatWinRate } from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";
import type { PlayerAnalytics } from "@/server/analytics/service";

/**
 * Analytics 6.0b page body. Presentation only: every number comes from domain/analytics; nothing
 * is computed here besides formatting. Filters are plain links (URL state, keyboard-native).
 */
export function AnalyticsView({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const { summary, range, mode } = data;
  const empty = summary.overall.matches === 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl leading-none font-extrabold uppercase italic sm:text-5xl">
            {t("title")}
          </h1>
          <p className="mt-2 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <FilterGroup
            label={t("rangeLabel")}
            options={ANALYTICS_RANGES.map((r) => ({
              key: r,
              label: t(`ranges.${r}`),
              href: analyticsHref(r, mode),
              current: r === range,
            }))}
          />
          <FilterGroup
            label={t("modeLabel")}
            options={ANALYTICS_MODES.map((m) => ({
              key: m,
              label: t(`modes.${m}`),
              href: analyticsHref(range, m),
              current: m === mode,
            }))}
          />
        </div>
      </header>

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

      {empty ? (
        <Panel>
          <h2 className="font-display text-xl font-bold uppercase">{t("emptyTitle")}</h2>
          <p className="mt-2 text-sm text-muted">{t("emptyHint")}</p>
        </Panel>
      ) : (
        <>
          <Summary data={data} />
          <Recent forms={summary.recent} />
          <Characters data={data} />
        </>
      )}

      <footer className="space-y-1 text-xs text-faint">
        <p>{t("sampleNote")}</p>
        <p>{t("drawsExcluded")}</p>
        <p>{t("rangeNote")}</p>
      </footer>
    </div>
  );
}

export function analyticsHref(range: AnalyticsRange, mode: AnalyticsMode): string {
  return `/dashboard/analytics?range=${range}&mode=${mode}`;
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
      <p className="hud-label mb-1 text-xs">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {options.map((o) => (
          <li key={o.key}>
            <Link
              href={o.href}
              aria-current={o.current ? "page" : undefined}
              className={cx(
                "inline-flex h-8 items-center border px-3 font-display text-sm font-bold tracking-wide uppercase",
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

function Summary({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const { overall, sessions } = data.summary;
  return (
    <Panel title={t("summaryTitle")}>
      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label={t("matches")} value={formatInteger(overall.matches, locale)} />
        <Stat label={t("record")} value={<RecordValue record={overall} />}>
          {overall.draws > 0 && <span>{t("draws", { count: overall.draws })}</span>}
        </Stat>
        <Stat label={t("winRate")} value={<WinRate record={overall} />}>
          <SampleTag band={overall.sample} />
        </Stat>
        <Stat label={t("sessions")} value={formatInteger(sessions.sessions, locale)}>
          {sessions.averageMatchesPerSession !== null && (
            <span>
              {t("perSession", {
                value: formatDecimal(sessions.averageMatchesPerSession, locale),
              })}
            </span>
          )}
          {sessions.outsideSessions > 0 && (
            <span>{t("outsideSessions", { count: sessions.outsideSessions })}</span>
          )}
        </Stat>
      </dl>
    </Panel>
  );
}

function Recent({ forms }: { forms: RecentForm[] }) {
  const t = useTranslations("Analytics");
  return (
    <section aria-labelledby="analytics-recent">
      <h2 id="analytics-recent" className="hud-heading mb-3">
        {t("recentTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {forms.map((f) => (
          <article key={f.window} className="hud-panel p-5" data-window={f.window}>
            <h3 className="hud-label">{t("lastN", { n: f.window })}</h3>
            <p className="mt-2 font-display text-3xl font-bold tabular">
              <RecordValue record={f.record} />
            </p>
            <p className="mt-1 text-sm">
              <WinRate record={f.record} />
              {f.record.draws > 0 && (
                <span className="ml-2 text-muted">{t("draws", { count: f.record.draws })}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              {f.complete
                ? t("available", { count: f.available })
                : t("availableOf", { count: f.available, n: f.window })}
            </p>
            {f.results.length > 0 && <Sequence results={f.results} />}
          </article>
        ))}
      </div>
    </section>
  );
}

const RESULT_STYLE: Record<MatchResult, string> = {
  win: "bg-win text-bg",
  loss: "bg-loss text-bg",
  draw: "bg-faint text-bg",
};

/** Newest first; letters + screen-reader words, never colour alone. */
function Sequence({ results }: { results: MatchResult[] }) {
  const t = useTranslations("Analytics");
  return (
    <ol aria-label={t("sequenceLabel")} className="mt-3 flex flex-wrap gap-1">
      {results.map((r, i) => (
        <li
          key={i}
          className={cx(
            "grid h-6 w-6 place-items-center font-display text-xs font-bold",
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

function Characters({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  return (
    <Panel title={t("charactersTitle")} bodyClassName="px-0 pb-2 pt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="px-5 pb-3 text-left text-xs text-muted">
            {t("charactersCaption")}
          </caption>
          <thead>
            <tr className="hud-label border-b border-line text-left text-xs">
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
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.summary.characters.map((c) => (
              <tr key={c.characterKey} data-character={c.characterKey}>
                <th scope="row" className="px-5 py-2.5 text-left font-display text-base font-bold">
                  <span className="flex flex-wrap items-center gap-2">
                    {c.characterName}
                    {c.mostPlayed && (
                      <Badge tone="accent" className="whitespace-nowrap">
                        {t("mostPlayed")}
                      </Badge>
                    )}
                  </span>
                </th>
                <td className="px-3 py-2.5 text-right tabular">
                  {formatInteger(c.record.matches, locale)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap tabular">
                  <RecordValue record={c.record} />
                  {c.record.draws > 0 && (
                    <span className="ml-2 text-xs text-muted">
                      {t("draws", { count: c.record.draws })}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  <WinRate record={c.record} />
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="w-14 tabular">
                      {formatWinRate(Math.round(c.usage * 10) / 10, locale)}
                    </span>
                    <span className="hidden h-1 w-20 bg-line-strong sm:block" aria-hidden>
                      <span className="block h-full bg-cyan" style={{ width: `${c.usage}%` }} />
                    </span>
                  </span>
                </td>
                <td className="px-5 py-2.5">
                  <SampleTag band={c.record.sample} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="hud-label">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-bold tabular">{value}</dd>
      {children && <dd className="mt-1 flex flex-col gap-0.5 text-xs text-muted">{children}</dd>}
    </div>
  );
}

/** "W–L" (draws are shown separately, never folded into losses). */
function RecordValue({ record }: { record: MatchRecord }) {
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
function WinRate({ record }: { record: MatchRecord }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  if (record.winRate === null) {
    return (
      <span title={t("winRateUnavailable")}>
        <span aria-hidden>—</span>
        <span className="sr-only">{t("winRateUnavailable")}</span>
      </span>
    );
  }
  return <span>{formatWinRate(Math.round(record.winRate * 10) / 10, locale)}</span>;
}

function SampleTag({ band }: { band: SampleBand }) {
  const t = useTranslations("Analytics");
  return (
    <Badge
      tone="neutral"
      className={cx(
        "whitespace-nowrap",
        (band === "none" || band === "very-small") && "opacity-70",
      )}
    >
      {t(`sample.${band}`)}
    </Badge>
  );
}
