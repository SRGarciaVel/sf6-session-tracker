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
import { HALVES_MIN_MATCHES, MATCH_POSITION_CAP } from "@/domain/analytics/sessions";
import { formatDecimal, formatInteger, formatMinutes, formatWinRate } from "@/domain/format";
import { MATCHUP_CALLOUT_MIN_DECIDED, type MatchupPerformance } from "@/domain/analytics/matchups";
import type { CharacterKey, MatchResult } from "@/domain/sf6/types";
import type { PlayerAnalytics } from "@/server/analytics/service";

/**
 * Analytics page body (6.0b + 6.1 matchups). Presentation only: every number comes from
 * domain/analytics; nothing is computed here besides formatting. Filters are URL state: links for
 * range/mode, a plain GET form for the own character (keyboard-native, no client state).
 */
export function AnalyticsView({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const { summary, range, mode, character } = data;
  const empty = summary.overall.matches === 0;
  const characterName = characterNameOf(data);

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
        </div>
      </header>

      {characterName && (
        <p className="text-sm text-muted" data-testid="character-context">
          {t("characterContext", { character: characterName })} ·{" "}
          <Link
            href={analyticsHref(range, mode, null)}
            className="text-cyan underline underline-offset-4"
          >
            {t("characterClear")}
          </Link>
        </p>
      )}

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
        <>
          <Panel>
            <h2 className="font-display text-xl font-bold uppercase">
              {characterName
                ? t("emptyCharacterTitle", { character: characterName })
                : t("emptyTitle")}
            </h2>
            <p className="mt-2 text-sm text-muted">{t("emptyHint")}</p>
          </Panel>
          {characterName && summary.characters.length > 0 && <Characters data={data} />}
        </>
      ) : (
        <>
          <Summary data={data} />
          <Recent forms={summary.recent} />
          <Characters data={data} />
          <Matchups data={data} />
          <SessionPerformance data={data} />
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

export function analyticsHref(
  range: AnalyticsRange,
  mode: AnalyticsMode,
  character: CharacterKey | null = null,
): string {
  const base = `/dashboard/analytics?range=${range}&mode=${mode}`;
  return character ? `${base}&character=${encodeURIComponent(character)}` : base;
}

function characterNameOf(data: PlayerAnalytics): string | null {
  if (!data.character) return null;
  return (
    data.characters.find((c) => c.characterKey === data.character)?.characterName ?? data.character
  );
}

/** GET form: keeps range/mode, sends `character` ("" = all). Works without JavaScript. */
function CharacterFilter({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  return (
    <form method="get" action="/dashboard/analytics" className="flex flex-col">
      <label htmlFor="analytics-character" className="hud-label mb-1 text-xs">
        {t("characterLabel")}
      </label>
      <input type="hidden" name="range" value={data.range} />
      <input type="hidden" name="mode" value={data.mode} />
      <div className="flex gap-1">
        <select
          id="analytics-character"
          name="character"
          defaultValue={data.character ?? ""}
          className="h-8 border border-line-strong bg-surface-2 px-2 text-sm text-text focus:border-cyan"
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
          className="h-8 border border-line-strong px-3 font-display text-sm font-bold tracking-wide uppercase text-muted hover:border-cyan hover:text-text"
        >
          {t("characterApply")}
        </button>
      </div>
    </form>
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
          <SampleTag band={overall.sample} wrap />
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
  const filtered = data.character !== null;
  return (
    <Panel title={t("charactersTitle")} bodyClassName="px-0 pb-2 pt-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="px-5 pb-3 text-left text-xs text-muted">
            {filtered ? t("charactersOverviewCaption") : t("charactersCaption")}
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
              <tr
                key={c.characterKey}
                data-character={c.characterKey}
                data-selected={c.characterKey === data.character ? "true" : undefined}
                className={cx(c.characterKey === data.character && "bg-cyan/8")}
              >
                <th scope="row" className="px-5 py-2.5 text-left font-display text-base font-bold">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={analyticsHref(data.range, data.mode, c.characterKey)}
                      aria-current={c.characterKey === data.character ? "true" : undefined}
                      className="hover:text-cyan"
                    >
                      {c.characterName}
                    </Link>
                    {c.characterKey === data.character && (
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

function Matchups({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const { matchups } = data.summary;
  const characterName = characterNameOf(data);
  return (
    <section aria-labelledby="analytics-matchups" className="space-y-4">
      <h2 id="analytics-matchups" className="hud-heading">
        {t("matchups.title")}
      </h2>
      <p className="text-sm text-muted">{t("matchups.note")}</p>

      {matchups.considered === 0 ? (
        <Panel>
          <p className="text-sm text-muted">{t("matchups.noOpponentData")}</p>
        </Panel>
      ) : (
        <>
          <Highlights data={data} />
          <Panel title={t("matchups.opponentsTitle")} bodyClassName="px-0 pb-2 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <caption className="px-5 pb-3 text-left text-xs text-muted">
                  {characterName
                    ? t("matchups.usingCharacter", { character: characterName })
                    : t("matchups.acrossCharacters")}
                </caption>
                <thead>
                  <tr className="hud-label border-b border-line text-left text-xs">
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      {t("matchups.colOpponent")}
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
                    <th scope="col" className="px-3 pb-2 text-right font-semibold">
                      {t("matchups.colFrequency")}
                    </th>
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      {t("colSample")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {matchups.opponents.map((o) => (
                    <tr key={o.opponentKey} data-opponent={o.opponentKey}>
                      <th
                        scope="row"
                        className="px-5 py-2.5 text-left font-display text-base font-bold"
                      >
                        {o.opponentName}
                      </th>
                      <td className="px-3 py-2.5 text-right tabular">
                        {formatInteger(o.record.matches, locale)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular">
                        <RecordValue record={o.record} />
                        {o.record.draws > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            {t("draws", { count: o.record.draws })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">
                        <WinRate record={o.record} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">
                        {formatWinRate(Math.round(o.share * 10) / 10, locale)}
                      </td>
                      <td className="px-5 py-2.5">
                        <SampleTag band={o.record.sample} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
      {matchups.unavailable > 0 && (
        <p className="text-xs text-muted">
          {t("matchups.unavailable", { count: matchups.unavailable })}
        </p>
      )}
    </section>
  );
}

/** Strongest / weakest RECORDED performance — only pairs with enough decided matches. */
function Highlights({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const { strongest, weakest } = data.summary.matchups.highlights;
  if (!strongest) {
    return (
      <p
        className="border-l-2 border-line-strong px-4 py-2 text-sm text-muted"
        data-testid="matchup-highlights-none"
      >
        {t("matchups.highlightsNone", { min: MATCHUP_CALLOUT_MIN_DECIDED })}
      </p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="matchup-highlights">
      <HighlightCard kind="strongest" matchup={strongest} />
      {weakest && <HighlightCard kind="weakest" matchup={weakest} />}
    </div>
  );
}

function HighlightCard({
  kind,
  matchup,
}: {
  kind: "strongest" | "weakest";
  matchup: MatchupPerformance;
}) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  return (
    <article className="hud-panel p-5" data-highlight={kind}>
      <h3 className="hud-label">{t(`matchups.${kind}`)}</h3>
      <p className="mt-2 font-display text-xl font-bold">
        {t("matchups.pair", { own: matchup.characterName, opponent: matchup.opponentName })}
      </p>
      <p className="mt-1 font-display text-3xl font-bold tabular">
        <WinRate record={matchup.record} />
      </p>
      <p className="mt-1 text-xs text-muted">
        {t("matchups.sample", {
          decided: formatInteger(matchup.record.decided, locale),
          matches: formatInteger(matchup.record.matches, locale),
        })}
      </p>
    </article>
  );
}

/** Phase 6.2: descriptive patterns inside recorded sessions (no tilt / fatigue claims). */
function SessionPerformance({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics.sessionPerformance");
  const ta = useTranslations("Analytics");
  const locale = useLocale();
  const s = data.summary.sessionPerformance;
  return (
    <section
      aria-labelledby="analytics-sessions"
      className="space-y-4"
      data-testid="session-performance"
    >
      <h2 id="analytics-sessions" className="hud-heading">
        {t("title")}
      </h2>
      <div className="space-y-1 text-sm text-muted">
        <p>{t("note")}</p>
        <p>{t("durationNote")}</p>
      </div>

      {s.segments === 0 ? (
        <Panel>
          <p className="text-sm text-muted" data-testid="sessions-empty">
            {t("empty")}
          </p>
        </Panel>
      ) : (
        <>
          <Panel>
            <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat label={t("segments")} value={formatInteger(s.segments, locale)}>
                <span>{t("realSessions", { count: s.sessions })}</span>
                {s.splitSessions > 0 && (
                  <span>{t("splitSessions", { count: s.splitSessions })}</span>
                )}
              </Stat>
              <Stat
                label={t("medianMatches")}
                value={formatDecimal(s.medianMatchesPerSegment, locale)}
              />
              <Stat label={t("medianDuration")} value={formatMinutes(s.duration.medianMs, locale)}>
                <span>
                  {t("averageDuration", { value: formatMinutes(s.duration.averageMs, locale) })}
                </span>
              </Stat>
              <Stat
                label={t("pace")}
                value={
                  s.duration.matchesPerHour === null ? (
                    <Unavailable label={t("paceUnavailable")} />
                  ) : (
                    t("paceValue", { value: formatDecimal(s.duration.matchesPerHour, locale) })
                  )
                }
              >
                {s.duration.matchesPerHour !== null && (
                  <span>{t("paceBasis", { count: s.duration.measurableSegments })}</span>
                )}
              </Stat>
            </dl>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-3">
            <article className="hud-panel p-5" data-testid="streak-win">
              <h3 className="hud-label">{t("longestWin")}</h3>
              <p className="mt-2 font-display text-3xl font-bold tabular">
                {formatInteger(s.streaks.longestWin, locale)}
              </p>
            </article>
            <article className="hud-panel p-5" data-testid="streak-loss">
              <h3 className="hud-label">{t("longestLoss")}</h3>
              <p className="mt-2 font-display text-3xl font-bold tabular">
                {formatInteger(s.streaks.longestLoss, locale)}
              </p>
            </article>
            <article className="hud-panel p-5" data-testid="recovery">
              <h3 className="hud-label">{t("recovery")}</h3>
              {s.recovery.rate === null ? (
                <p className="mt-2 text-sm text-muted">{t("recoveryUnavailable")}</p>
              ) : (
                <>
                  <p className="mt-2 font-display text-3xl font-bold tabular">
                    {formatWinRate(Math.round(s.recovery.rate * 10) / 10, locale)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {t("recoveryCount", {
                      won: formatInteger(s.recovery.recoveredWithWin, locale),
                      total: formatInteger(s.recovery.lossesWithNextMatch, locale),
                    })}
                  </p>
                </>
              )}
            </article>
          </div>

          <Panel title={t("halvesTitle")}>
            {s.halves.eligibleSegments === 0 ? (
              <p className="text-sm text-muted" data-testid="halves-unavailable">
                {t("halvesUnavailable", { min: HALVES_MIN_MATCHES })}
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2" data-testid="halves">
                  {(["first", "second"] as const).map((half) => (
                    <div key={half} data-half={half}>
                      <p className="hud-label">
                        {t(half === "first" ? "firstHalf" : "secondHalf")}
                      </p>
                      <p className="mt-1 font-display text-2xl font-bold tabular">
                        <RecordValue record={s.halves[half]} />
                      </p>
                      <p className="mt-1 text-sm">
                        <WinRate record={s.halves[half]} />
                        {s.halves[half].draws > 0 && (
                          <span className="ml-2 text-muted">
                            {ta("draws", { count: s.halves[half].draws })}
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {ta("available", { count: s.halves[half].matches })}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">
                  {t("halvesRule", { count: s.halves.eligibleSegments, min: HALVES_MIN_MATCHES })}
                </p>
              </>
            )}
          </Panel>

          <Panel title={t("positionsTitle")} bodyClassName="px-0 pb-2 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-sm">
                <caption className="px-5 pb-3 text-left text-xs text-muted">
                  {t("positionsCaption", { cap: MATCH_POSITION_CAP })}
                </caption>
                <thead>
                  <tr className="hud-label border-b border-line text-left text-xs">
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      {t("colPosition")}
                    </th>
                    <th scope="col" className="px-3 pb-2 text-right font-semibold">
                      {t("colSegments")}
                    </th>
                    <th scope="col" className="px-3 pb-2 font-semibold">
                      {ta("colRecord")}
                    </th>
                    <th scope="col" className="px-3 pb-2 text-right font-semibold">
                      {ta("colWinRate")}
                    </th>
                    <th scope="col" className="px-5 pb-2 font-semibold">
                      {ta("colSample")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.positions.map((p) => (
                    <tr key={p.position} data-position={p.position}>
                      <th
                        scope="row"
                        className="px-5 py-2 text-left font-display font-bold whitespace-nowrap"
                      >
                        {t("position", { n: p.position })}
                      </th>
                      <td className="px-3 py-2 text-right tabular">
                        {formatInteger(p.record.matches, locale)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular">
                        <RecordValue record={p.record} />
                        {p.record.draws > 0 && (
                          <span className="ml-2 text-xs text-muted">
                            {ta("draws", { count: p.record.draws })}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular">
                        <WinRate record={p.record} />
                      </td>
                      <td className="px-5 py-2">
                        <SampleTag band={p.record.sample} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </section>
  );
}

function Unavailable({ label }: { label: string }) {
  return (
    <span title={label}>
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
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

/** `wrap`: may break onto two lines (narrow summary columns); tables keep one line. */
function SampleTag({ band, wrap = false }: { band: SampleBand; wrap?: boolean }) {
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
