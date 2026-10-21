import { useLocale, useTranslations } from "next-intl";
import { cx } from "@/components/ui/primitives";
import { deltaTone, formatDelta, formatInteger, formatWinRate } from "@/domain/format";
import type { RatingData, ScoreboardData } from "./types";

/**
 * The Fight Session "versus": wins cut in from the left, losses from the right, win rate and
 * game count in between. `highlight` replays a short hit on the side that just changed (state
 * feedback only: the number itself is the information).
 */
export function FightScoreboard({
  data,
  size = "large",
  highlight = null,
  className,
}: {
  data: ScoreboardData;
  size?: "large" | "compact";
  highlight?: "win" | "loss" | null;
  className?: string;
}) {
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
        <span className="fs-eyebrow">{t("wins")}</span>
        <span
          className={cx("fs-num text-win", highlight === "win" && "fs-hit")}
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
        <span className="fs-eyebrow">{t("losses")}</span>
        <span
          className={cx("fs-num text-loss", highlight === "loss" && "fs-hit")}
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
export function RatingSummary({ rating, className }: { rating: RatingData; className?: string }) {
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
        className={cx(
          "fs-num text-5xl max-sm:text-4xl",
          (rating.pending || unavailable) && "text-muted",
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
  const cell = "min-w-0 border-line px-5 py-4 max-sm:px-3.5";
  const num = "fs-num m-0 mt-2 text-[clamp(3.25rem,5vw,4.75rem)] max-sm:text-5xl";
  const unit = rating ? tr(`unit.${rating.system}`) : "";
  const tone = deltaTone(rating?.delta ?? null);
  return (
    <dl
      className={cx(
        "m-0 grid grid-cols-2 border-y border-line sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)] sm:divide-x sm:divide-line",
        className,
      )}
    >
      <div className={cell}>
        <dt className="fs-eyebrow">{t("gamesLabel")}</dt>
        <dd className={num}>{formatInteger(data.games, locale)}</dd>
      </div>
      <div className={cell}>
        <dt className="fs-eyebrow">{t("wins")}</dt>
        <dd className={cx(num, "text-win")}>{formatInteger(data.wins, locale)}</dd>
      </div>
      <div className={cell}>
        <dt className="fs-eyebrow">{t("losses")}</dt>
        <dd className={cx(num, "text-loss")}>{formatInteger(data.losses, locale)}</dd>
      </div>
      <div className={cell}>
        <dt className="fs-eyebrow">{t("winRate")}</dt>
        <dd className={num}>{data.winRate === null ? "—" : formatWinRate(data.winRate, locale)}</dd>
      </div>
      {rating && (
        <div className={cx(cell, "max-sm:col-span-2 max-sm:border-t")}>
          <dt className="fs-eyebrow">
            {tr("sessionDelta")} · {rating.characterName}
          </dt>
          {rating.current === null || rating.delta === null ? (
            <>
              <dd className={cx(num, "text-faint")}>—</dd>
              <dd className="m-0 mt-1 text-sm font-semibold text-warn">
                {rating.current === null ? tr("unavailable", { unit }) : tr("noBaseline", { unit })}
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
  );
}
