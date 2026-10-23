/**
 * Phase 5.6C — Fight Session RECAP (allowlist only; the classic recap stays the default).
 * Server-rendered from the same authoritative data as the classic page: the engine summary of
 * THIS session (status, W/L, win rate, per-character baseline/final ratings) and its persisted,
 * counted matches. Nothing is computed here; no per-match rating exists, so none is shown.
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ActionLink } from "@/components/ui/ActionLink";
import { Icon } from "@/components/ui/Icon";
import {
  ActivityList,
  FocusTarget,
  RatingSummary,
  RoundStrip,
  SessionResults,
  SessionStage,
  SessionStatusIndicator,
  ratingFromCharacter,
  scoreboardFromSession,
  type ActivityItem,
} from "@/components/fight-session";
import { LocalTime } from "@/components/ui/LocalTime";
import { cx } from "@/components/ui/primitives";
import { formatDuration } from "@/domain/format";
import { pickRatingCharacter, type LiveSessionState } from "@/domain/overlay/state";
import type { RatingModel } from "@/domain/session/engine";

/** Round markers shown at once; the full sequence is in the match list below. */
export const RECAP_STRIP_MAX = 30;
/** Matches listed before «show all». */
export const RECAP_LIST_MAX = 20;

export function FightSessionRecap({
  session,
  ratingModel,
  startedAt,
  endedAt,
  matches,
  justEnded,
}: {
  session: LiveSessionState;
  ratingModel: RatingModel;
  startedAt: string;
  endedAt: string | null;
  /** Counted matches of this session, oldest → newest (engine order/dedupe). */
  matches: readonly ActivityItem[];
  justEnded: boolean;
}) {
  const t = useTranslations("FightSession.recap");
  const ended = session.status === "ended" && endedAt !== null;
  const active = pickRatingCharacter(session);
  const legacy = ratingModel === "legacy";
  const played = session.characters.filter((c) => c.games > 0);
  // Ratings belong to characters: one summary per character PLAYED in this session, the latest
  // first (a session without matches has no rating change to report).
  const ratings = legacy
    ? []
    : [
        ...played.filter((c) => c.characterKey === active?.characterKey),
        ...played.filter((c) => c.characterKey !== active?.characterKey),
      ]
        .map((c) => ratingFromCharacter(c, session.status))
        .filter((r): r is NonNullable<typeof r> => r !== null);
  const scoreboard = scoreboardFromSession(session);
  const strip = matches.slice(-RECAP_STRIP_MAX);
  const latest = matches.slice(-RECAP_LIST_MAX);
  const older = matches.slice(0, matches.length - latest.length);
  const firstNumber = matches.length - strip.length + 1;
  const duration = endedAt ? formatDuration(Date.parse(endedAt) - Date.parse(startedAt)) : null;

  return (
    <div className="grid gap-6">
      {/* Just ended from LIVE: the stage settles in once and focus lands on the summary heading
          (the «End session» control is gone). Content is never delayed or hidden. */}
      {justEnded && ended && <FocusTarget id="fs-recap-title" />}
      <SessionStage
        ghost={active?.characterName}
        labelledBy="fs-recap-title"
        className={cx(justEnded && ended && "fs-recap-in")}
      >
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="grid gap-2">
            {justEnded && ended ? (
              <p role="status" className="fs-eyebrow fs-recap-saved m-0 text-win">
                <span aria-hidden>✓ </span>
                {t("saved")}
              </p>
            ) : (
              <p className="fs-eyebrow m-0 text-cyan">{t("eyebrow")}</p>
            )}
            <h1
              id="fs-recap-title"
              tabIndex={-1}
              className="fs-display m-0 text-5xl outline-none sm:text-7xl"
            >
              {ended ? t("title") : t("inProgressTitle")}
            </h1>
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
              <div className="flex gap-2">
                <dt className="sr-only">{t("period")}</dt>
                <dd className="m-0 tabular">
                  <LocalTime iso={startedAt} format="datetime" />
                  {endedAt && (
                    <>
                      {" – "}
                      <LocalTime iso={endedAt} format="time" />
                    </>
                  )}
                </dd>
              </div>
              {duration && (
                <div className="flex gap-2">
                  <dt>{t("duration")}</dt>
                  <dd className="m-0 font-semibold text-text tabular">{duration}</dd>
                </div>
              )}
            </dl>
          </div>
          <nav aria-label={t("eyebrow")} className="flex flex-wrap items-center gap-3">
            <Link href="/dashboard#session" className="fs-cta fs-cut">
              <span>{t("prepareAnother")}</span>
              <Icon name="arrow-right" size="1.15em" className="fs-cta-arrow" />
            </Link>
            <Link href="/dashboard" className="fs-btn fs-cut">
              <Icon name="arrow-left" />
              {t("backToDashboard")}
            </Link>
          </nav>
        </div>

        {!ended ? (
          <div className="grid gap-3">
            <SessionStatusIndicator status="live" />
            <p className="m-0 max-w-2xl text-muted">{t("inProgressBody")}</p>
          </div>
        ) : (
          <>
            <SessionResults data={scoreboard} rating={ratings[0] ?? null} />
            {scoreboard.draws > 0 && (
              <p className="m-0 text-sm text-muted">{t("draws", { count: scoreboard.draws })}</p>
            )}

            {session.totalGames > 0 && (
              <section aria-labelledby="fs-recap-characters" className="grid gap-3">
                <h2 id="fs-recap-characters" className="fs-eyebrow m-0">
                  {t("characters")}
                </h2>
                {legacy ? (
                  <p className="m-0 text-sm text-muted">{t("legacy")}</p>
                ) : ratings.length === 0 ? (
                  <p className="m-0 text-sm text-muted">{t("noRatingCharacter")}</p>
                ) : (
                  ratings.map((r) => (
                    <RatingSummary key={`${r.characterName}-${r.system}`} rating={r} />
                  ))
                )}
              </section>
            )}

            {matches.length > 0 && (
              <div className="grid gap-2">
                <RoundStrip results={strip.map((m) => m.result)} firstNumber={firstNumber} titled />
                {strip.length < matches.length && (
                  <p className="m-0 text-xs text-muted">
                    {t("stripTruncated", { shown: strip.length, total: matches.length })}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </SessionStage>

      {ended && (
        <section aria-labelledby="fs-recap-matches" className="fs-stage grid gap-2 p-5 sm:p-7">
          <h2 id="fs-recap-matches" className="fs-eyebrow m-0">
            {t("matchesTitle")}
          </h2>
          {/* Newest first; a long session shows its latest matches and folds the older ones. */}
          <ActivityList items={latest} firstNumber={matches.length - latest.length + 1} />
          {older.length > 0 && (
            <details className="border-t border-line pt-2">
              <summary className="cursor-pointer py-2 text-sm font-semibold text-cyan">
                {t("showAll", { count: older.length })}
              </summary>
              <ActivityList items={older} firstNumber={1} />
            </details>
          )}
        </section>
      )}

      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <ActionLink href="/dashboard#overlays">{t("overlays")}</ActionLink>
        {/* A plain anchor on purpose: the UI choice is made by the server on a full request. */}
        <a href="?ui=classic" className="sst-link sst-link--quiet">
          {t("classic")}
        </a>
      </nav>
    </div>
  );
}
