import { useLocale, useTranslations } from "next-intl";
import { cx } from "@/components/ui/primitives";
import { deltaTone, formatDelta, formatInteger, formatWinRate } from "@/domain/format";
import type { RatingData, ScoreboardData } from "./types";

/**
 * The Fight Session "versus": wins cut in from the left, losses from the right, win rate and
 * game count in between. `highlight` plays a short hit on the side(s) that just changed (state
 * feedback only: the number itself is the information); a new `pulse` replays it.
 */
export function FightScoreboard({
  data,
  size = "large",
  highlight = null,
  pulse = 0,
  className,
}: {
  data: ScoreboardData;
  size?: "large" | "compact";
  highlight?: "win" | "loss" | "both" | null;
  /** Arrival counter: a new value remounts the accents so back-to-back events replay. */
  pulse?: number;
  className?: string;
}) {
  const hitWin = highlight === "win" || highlight === "both";
  const hitLoss = highlight === "loss" || highlight === "both";
  const t = useTranslations("FightSession.scoreboard");
  const locale = useLocale();
  const rate = data.winRate === null ? "—" : formatWinRate(data.winRate, locale);
  const summary = t("summary", {
    wins: formatInteger(data.wins, locale),
    losses: formatInteger(data.losses, locale),
    winRate: rate,
    games: data.games,
  });
  return (
    <section
      aria-label={t("label")}
      className={cx("fs-versus", size === "compact" && "fs-versus-compact", className)}
    >
      <p className="sr-only">{summary}</p>
      <div className="fs-side fs-side-win" aria-hidden>
        {hitWin && <span key={`f${pulse}`} className="fs-side-flash" data-motion="side-flash" />}
        <span className="fs-eyebrow">{t("wins")}</span>
        <span
          key={hitWin ? `w${pulse}` : "w"}
          className={cx("fs-num text-win", hitWin && "fs-hit")}
          data-testid="fs-wins"
        >
          {formatInteger(data.wins, locale)}
        </span>
      </div>
      <div className="fs-mid" aria-hidden>
        <span className="fs-eyebrow">{t("winRate")}</span>
        <span className="fs-num" data-testid="fs-winrate">
          {rate}
        </span>
        <span className="fs-meter">
          {data.wins + data.losses > 0 && (
            <>
              <span style={{ flexGrow: data.wins }} />
              <span style={{ flexGrow: data.losses }} />
            </>
          )}
        </span>
        <span className="text-sm text-muted">
          {data.wins + data.losses === 0 && data.games > 0
            ? t("noDecided")
            : t("games", { count: data.games })}
          {data.draws > 0 && ` · ${t("draws", { count: data.draws })}`}
        </span>
      </div>
      <div className="fs-side fs-side-loss" aria-hidden>
        {hitLoss && <span key={`f${pulse}`} className="fs-side-flash" data-motion="side-flash" />}
        <span className="fs-eyebrow">{t("losses")}</span>
        <span
          key={hitLoss ? `l${pulse}` : "l"}
          className={cx("fs-num text-loss", hitLoss && "fs-hit")}
          data-testid="fs-losses"
        >
          {formatInteger(data.losses, locale)}
        </span>
      </div>
    </section>
  );
}

const TONE = { positive: "text-win", negative: "text-loss", neutral: "text-muted" } as const;
const ARROW = { positive: "▲", negative: "▼", neutral: "" } as const;

/**
 * One character's rating for the session: start → now, the engine's session delta and honest
 * states (pending confirmation, unknown baseline, final value unavailable). Never per match.
 */
export function RatingSummary({
  rating,
  confirmedPulse = 0,
  className,
}: {
  rating: RatingData;
  /**
   * Grows when a newly CONFIRMED value replaced a different confirmed one: one short accent
   * under the value (no counter, never while pending or unknown).
   */
  confirmedPulse?: number;
  className?: string;
}) {
  const t = useTranslations("FightSession.rating");
  const locale = useLocale();
  const unit = t(`unit.${rating.system}`);
  const tone = deltaTone(rating.delta);
  const unavailable = rating.current === null;
  const noBaseline = rating.initial === null && !unavailable;
  return (
    <div
      className={cx("fs-rating font-display", className)}
      role="group"
      aria-label={t("label", { unit, character: rating.characterName })}
    >
      <span className="text-base font-bold tracking-[0.14em] text-cyan uppercase">
        {rating.characterName}
      </span>
      {rating.initial !== null && (
        <>
          <span className="text-2xl font-bold text-muted tabular">
            <span className="sr-only">{t("from")} </span>
            {formatInteger(rating.initial, locale)}
          </span>
          <span className="fs-rating-arrow" aria-hidden />
        </>
      )}
      <span
        key={`v${confirmedPulse}`}
        className={cx(
          "fs-num text-5xl max-sm:text-4xl",
          (rating.pending || unavailable) && "text-muted",
          confirmedPulse > 0 && !rating.pending && !unavailable && "fs-rating-confirmed",
        )}
      >
        {unavailable ? "—" : formatInteger(rating.current, locale)}
      </span>
      <span className="text-base font-bold text-muted">{unit}</span>
      {!unavailable && rating.delta !== null && (
        <span className={cx("text-3xl font-extrabold tabular", TONE[tone])}>
          <span className="sr-only">{t("sessionDelta")}: </span>
          {ARROW[tone] && <span aria-hidden>{ARROW[tone]} </span>}
          {formatDelta(rating.delta, locale)}
        </span>
      )}
      {rating.pending && (
        <span className="ml-auto font-sans text-sm font-semibold text-warn max-sm:ml-0 max-sm:w-full">
          <span aria-hidden>⏳ </span>
          {t("pending", { unit })}
          <span className="sr-only">. {t("pendingHint", { unit })}</span>
        </span>
      )}
      {unavailable && (
        <span className="font-sans text-sm font-semibold text-warn max-sm:w-full">
          {t("unavailable", { unit })}
        </span>
      )}
      {noBaseline && (
        <span className="w-full font-sans text-sm text-muted">{t("noBaseline", { unit })}</span>
      )}
    </div>
  );
}

/**
 * Prepare-state identity line: character, league/rank and the latest known rating (no session
 * delta — there is no session yet).
 */
export function CharacterLine({
  characterName,
  rank,
  rating,
  className,
}: {
  characterName: string;
  rank: string | null;
  rating: { system: RatingData["system"]; value: number } | null;
  className?: string;
}) {
  const t = useTranslations("FightSession.rating");
  const locale = useLocale();
  return (
    <p
      className={cx(
        "m-0 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 font-display text-2xl font-bold uppercase",
        className,
      )}
    >
      <span>{characterName}</span>
      {rank && <span className="text-lg tracking-[0.1em] text-muted">{rank}</span>}
      {rating && (
        <span className="tabular">
          {formatInteger(rating.value, locale)}{" "}
          <span className="text-sm text-muted">{t(`unit.${rating.system}`)}</span>
        </span>
      )}
    </p>
  );
}

/**
 * Recap results bar: games, wins, losses, win rate and the session rating change of one character
 * (or an explicit "unavailable"). Same data as the scoreboard; the recap's conclusive layout.
 */
export function SessionResults({
  data,
  rating,
  className,
}: {
  data: ScoreboardData;
  rating: RatingData | null;
  className?: string;
}) {
  const t = useTranslations("FightSession.scoreboard");
  const tr = useTranslations("FightSession.rating");
  const locale = useLocale();
  // Layout and numeral size come from the bar's own width (.fs-results*, globals.css).
  const num = "fs-num fs-results-num m-0 mt-2";
  const unit = rating ? tr(`unit.${rating.system}`) : "";
  const tone = deltaTone(rating?.delta ?? null);
  return (
    <div className={cx("fs-results-wrap", className)}>
      <dl className="fs-results" data-testid="fs-session-results">
        <div>
          <dt className="fs-eyebrow">{t("gamesLabel")}</dt>
          <dd className={num}>{formatInteger(data.games, locale)}</dd>
        </div>
        <div>
          <dt className="fs-eyebrow">{t("wins")}</dt>
          <dd className={cx(num, "text-win")}>{formatInteger(data.wins, locale)}</dd>
        </div>
        <div>
          <dt className="fs-eyebrow">{t("losses")}</dt>
          <dd className={cx(num, "text-loss")}>{formatInteger(data.losses, locale)}</dd>
        </div>
        <div>
          <dt className="fs-eyebrow">{t("winRate")}</dt>
          <dd className={num}>
            {data.winRate === null ? "—" : formatWinRate(data.winRate, locale)}
          </dd>
        </div>
        {rating && (
          <div>
            <dt className="fs-eyebrow">
              {tr("sessionDelta")} · {rating.characterName}
            </dt>
            {rating.current === null || rating.delta === null ? (
              <>
                <dd className={cx(num, "text-faint")}>—</dd>
                <dd className="m-0 mt-1 text-sm font-semibold text-warn">
                  {rating.current === null
                    ? tr("unavailable", { unit })
                    : tr("noBaseline", { unit })}
                </dd>
              </>
            ) : (
              <>
                <dd className={cx(num, TONE[tone])}>
                  {ARROW[tone] && <span aria-hidden>{ARROW[tone]} </span>}
                  {formatDelta(rating.delta, locale)}
                </dd>
                <dd className="m-0 mt-1 text-sm text-muted tabular">
                  {rating.initial !== null && `${formatInteger(rating.initial, locale)} → `}
                  {formatInteger(rating.current, locale)} {unit}
                </dd>
              </>
            )}
          </div>
        )}
      </dl>
    </div>
  );
}
