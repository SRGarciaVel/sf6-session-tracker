/** Matchups (Phase 6.1) — presentation only. Highlights are neutral callouts, not good/bad. */
import { useLocale, useTranslations } from "next-intl";
import { MATCHUP_CALLOUT_MIN_DECIDED, type MatchupPerformance } from "@/domain/analytics/matchups";
import { formatInteger, formatWinRate } from "@/domain/format";
import type { PlayerAnalytics } from "@/server/analytics/service";
import {
  AnalyticsSection,
  RecordValue,
  SampleTag,
  DisclosureTablePanel,
  WinRate,
  characterNameOf,
} from "./parts";

/** Opponent rows shown before "Show N more" (existing order: matches desc; never a ranking). */
export const OPPONENT_ROWS_INITIAL = 10;
const OPPONENT_COLUMNS = ["22%", "10%", "19%", "11%", "14%", "24%"] as const;

export function MatchupsSection({ data }: { data: PlayerAnalytics }) {
  const t = useTranslations("Analytics");
  const locale = useLocale();
  const { matchups } = data.summary;
  const characterName = characterNameOf(data);
  const hidden = Math.max(0, matchups.opponents.length - OPPONENT_ROWS_INITIAL);
  return (
    <AnalyticsSection
      id="matchups"
      eyebrow={t("eyebrows.matchups")}
      title={t("matchups.title")}
      description={<p>{t("matchups.note")}</p>}
    >
      {matchups.considered === 0 ? (
        <div className="hud-panel p-5">
          <p className="text-sm text-muted">{t("matchups.noOpponentData")}</p>
        </div>
      ) : (
        <>
          <Highlights data={data} />
          <DisclosureTablePanel
            testId="opponents-table"
            minWidth="min-w-[42rem]"
            columns={OPPONENT_COLUMNS}
            rows={matchups.opponents}
            limit={OPPONENT_ROWS_INITIAL}
            showMore={t("disclosure.moreOpponents", { count: hidden })}
            showLess={t("disclosure.lessOpponents")}
            continuationCaption={t("disclosure.opponentsContinued", {
              from: OPPONENT_ROWS_INITIAL + 1,
              to: matchups.opponents.length,
            })}
            caption={
              <>
                <span className="mb-1 block font-display text-base font-bold tracking-wide text-text uppercase">
                  {t("matchups.opponentsTitle")}
                </span>
                {characterName
                  ? t("matchups.usingCharacter", { character: characterName })
                  : t("matchups.acrossCharacters")}
              </>
            }
            head={
              <>
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
              </>
            }
            renderRow={(o) => (
              <tr
                key={o.opponentKey}
                data-opponent={o.opponentKey}
                className="transition-colors hover:bg-surface-2/50 motion-reduce:transition-none"
              >
                <th scope="row" className="px-5 py-3 text-left font-display text-base font-bold">
                  {o.opponentName}
                </th>
                <td className="px-3 py-3 text-right tabular">
                  {formatInteger(o.record.matches, locale)}
                </td>
                <td className="px-3 py-3 whitespace-nowrap tabular">
                  <RecordValue record={o.record} />
                  {o.record.draws > 0 && (
                    <span className="ml-2 text-xs text-muted">
                      {t("draws", { count: o.record.draws })}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular">
                  <WinRate record={o.record} />
                </td>
                <td className="px-3 py-3 text-right tabular">
                  {formatWinRate(Math.round(o.share * 10) / 10, locale)}
                </td>
                <td className="px-5 py-3">
                  <SampleTag band={o.record.sample} wrap />
                </td>
              </tr>
            )}
          />
        </>
      )}
      {matchups.unavailable > 0 && (
        <p className="text-xs text-muted">
          {t("matchups.unavailable", { count: matchups.unavailable })}
        </p>
      )}
    </AnalyticsSection>
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

/** Restrained callout: same neutral surface for both kinds; the sample size stays prominent. */
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
    <article className="hud-panel border-t-2 border-t-line-strong p-5" data-highlight={kind}>
      <h3 className="hud-label">{t(`matchups.${kind}`)}</h3>
      <p className="mt-2 font-display text-xl font-bold">
        {t("matchups.pair", { own: matchup.characterName, opponent: matchup.opponentName })}
      </p>
      <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="font-display text-3xl font-bold tabular">
          <WinRate record={matchup.record} />
        </span>
        <span className="text-sm text-muted tabular">
          {t("matchups.sample", {
            decided: formatInteger(matchup.record.decided, locale),
            matches: formatInteger(matchup.record.matches, locale),
          })}
        </span>
      </p>
    </article>
  );
}
