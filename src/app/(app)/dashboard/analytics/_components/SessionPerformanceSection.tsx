/**
 * Session performance (Phase 6.2) — presentation only, grouped as Activity · Sequences · Within
 * the session. Neutral wording (no tilt / fatigue claims).
 */
import { useLocale, useTranslations } from "next-intl";
import { HALVES_MIN_MATCHES, MATCH_POSITION_CAP } from "@/domain/analytics/sessions";
import { formatDecimal, formatInteger, formatMinutes, formatWinRate } from "@/domain/format";
import type { PlayerAnalytics } from "@/server/analytics/service";
import {
  AnalyticsSection,
  RecordValue,
  SampleTag,
  Stat,
  StatSurface,
  SubGroupTitle,
  TablePanel,
  Unavailable,
  WinRate,
} from "./parts";

export function SessionPerformanceSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics.sessionPerformance");
  const ta = useTranslations("Analytics");
  const locale = useLocale();
  const s = data.summary.sessionPerformance;
  return (
    <AnalyticsSection
      id="sessions"
      testId="session-performance"
      eyebrow={ta("nav.groups.sessions")}
      title={t("title")}
      description={<p>{t("note")}</p>}
    >
      {s.segments === 0 ? (
        <div className="hud-panel p-5">
          <p className="text-sm text-muted" data-testid="sessions-empty">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-3" data-group="activity">
            <SubGroupTitle>{t("groups.activity")}</SubGroupTitle>
            <StatSurface>
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
            </StatSurface>
            <p className="text-xs text-muted">{t("durationNote")}</p>
          </div>

          <div className="space-y-3" data-group="sequences">
            <SubGroupTitle>{t("groups.sequences")}</SubGroupTitle>
            <StatSurface columns={3}>
              <Stat label={t("longestWin")} value={formatInteger(s.streaks.longestWin, locale)} />
              <Stat label={t("longestLoss")} value={formatInteger(s.streaks.longestLoss, locale)} />
              <Stat
                label={t("recovery")}
                value={
                  s.recovery.rate === null ? (
                    // The explanation is the visible line below: no duplicate for screen readers.
                    <span aria-hidden>—</span>
                  ) : (
                    formatWinRate(Math.round(s.recovery.rate * 10) / 10, locale)
                  )
                }
              >
                <span data-testid="recovery">
                  {s.recovery.rate === null
                    ? t("recoveryUnavailable")
                    : t("recoveryCount", {
                        won: formatInteger(s.recovery.recoveredWithWin, locale),
                        total: formatInteger(s.recovery.lossesWithNextMatch, locale),
                      })}
                </span>
              </Stat>
            </StatSurface>
          </div>

          <div className="space-y-3" data-group="within">
            <SubGroupTitle>{t("groups.within")}</SubGroupTitle>
            <div className="hud-panel p-5">
              <p className="hud-label mb-3">{t("halvesTitle")}</p>
              {s.halves.eligibleSegments === 0 ? (
                <p className="text-sm text-muted" data-testid="halves-unavailable">
                  {t("halvesUnavailable", { min: HALVES_MIN_MATCHES })}
                </p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2" data-testid="halves">
                    {(["first", "second"] as const).map((half) => (
                      <div key={half} data-half={half}>
                        <p className="text-sm text-muted">
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
                  <p className="mt-4 text-xs text-muted">
                    {t("halvesRule", {
                      count: s.halves.eligibleSegments,
                      min: HALVES_MIN_MATCHES,
                    })}
                  </p>
                </>
              )}
            </div>

            <TablePanel
              minWidth="min-w-[30rem]"
              caption={
                <>
                  <span className="mb-1 block font-display text-base font-bold tracking-wide text-text uppercase">
                    {t("positionsTitle")}
                  </span>
                  {t("positionsCaption", { cap: MATCH_POSITION_CAP })}
                </>
              }
              head={
                <>
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
                </>
              }
            >
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
            </TablePanel>
          </div>
        </div>
      )}
    </AnalyticsSection>
  );
}
