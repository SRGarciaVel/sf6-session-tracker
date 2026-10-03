import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { LocalTime } from "@/components/ui/LocalTime";
import { LiveIndicator, buttonClass, cx } from "@/components/ui/primitives";
import { formatDuration, formatInteger, formatWinRate } from "@/domain/format";
import { toLiveSessionState } from "@/domain/overlay/state";
import { requirePlayer } from "@/server/auth/session";
import { CharacterBreakdown } from "../../_components/SessionPanel";
import { getDb } from "@/server/db/client";
import { match } from "@/server/db/schema";
import { getOwnedSession, summarizeSessionRow } from "@/server/sessions/service";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("Meta"))("sessionRecap") };
}
export const dynamic = "force-dynamic";

const RESULT_STYLE = {
  win: "bg-win text-bg",
  loss: "bg-loss text-bg",
  draw: "bg-faint text-bg",
} as const;

export default async function SessionRecapPage({ params }: PageProps<"/dashboard/sessions/[id]">) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { player } = await requirePlayer();
  const db = getDb();
  const session = await getOwnedSession(db, player.id, id); // IDOR-safe
  if (!session) notFound();

  const [summary, matches] = await Promise.all([
    summarizeSessionRow(db, session, player),
    db
      .select()
      .from(match)
      .where(eq(match.sessionId, session.id))
      .orderBy(desc(match.playedAt))
      .limit(200),
  ]);
  // Per-character progress (never a single global rating).
  const characters = toLiveSessionState(session.id, summary, {
    characters: [],
    activeCharacterKey: null,
  }).characters.filter((c) => c.games > 0);
  const t = await getTranslations("Recap");
  const tc = await getTranslations("Common");
  const locale = await getLocale();
  const ended = summary.status === "ended";
  const duration = formatDuration(
    (summary.endedAt ?? new Date()).getTime() - summary.startedAt.getTime(),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard" className="text-sm text-muted hover:text-text">
        {tc("backToDashboard")}
      </Link>

      <section className="hud-panel animate-panel-in overflow-hidden p-6 [--notch:20px] sm:p-10">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-magenta via-violet to-cyan"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-4xl leading-none font-extrabold uppercase italic sm:text-5xl">
            {ended ? t("complete") : t("inProgress")}
          </p>
          {!ended && <LiveIndicator label={t("live").replace("●", "").trim()} />}
        </div>
        <p className="mt-2 text-sm text-muted">
          {player.displayName} ·{" "}
          <LocalTime iso={summary.startedAt.toISOString()} format="datetime" /> · {duration}
        </p>

        <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat
            label={t("wins")}
            value={formatInteger(summary.wins, locale)}
            className="text-win"
          />
          <Stat
            label={t("losses")}
            value={formatInteger(summary.losses, locale)}
            className="text-loss"
          />
          <Stat label={t("winRate")} value={formatWinRate(summary.winRate, locale)} />
          <Stat label={t("matches")} value={formatInteger(summary.totalGames, locale)} />
        </div>

        <div className="mt-8 grid gap-6 border-t border-line pt-8">
          <div>
            <p className="hud-label">{t("bestStreak")}</p>
            <p className="mt-1 font-display text-2xl font-bold tabular">
              {t("bestStreakValue", { count: summary.bestWinStreak })}
            </p>
          </div>
        </div>
        <div className="-mx-6 mt-6 sm:-mx-10">
          <CharacterBreakdown characters={characters} legacy={summary.ratingModel === "legacy"} />
        </div>
      </section>

      <section className="hud-panel">
        <h2 className="hud-heading border-b border-line px-5 py-3">{t("matchesTitle")}</h2>
        {matches.length === 0 ? (
          <p className="p-5 text-sm text-muted">{t("noMatches")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center gap-4 px-5 py-2.5 text-sm">
                <span
                  className={cx(
                    "grid h-7 w-6 shrink-0 place-items-center font-display text-sm font-bold [clip-path:polygon(3px_0,100%_0,calc(100%-3px)_100%,0_100%)]",
                    RESULT_STYLE[m.result],
                  )}
                >
                  {m.result === "win"
                    ? t("resultWin")
                    : m.result === "loss"
                      ? t("resultLoss")
                      : t("resultDraw")}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {m.characterName} <span className="text-faint">{t("vs")}</span>{" "}
                  {m.opponentCharacter ?? "?"}
                  <span className="text-faint"> · {m.opponentName ?? t("unknownOpponent")}</span>
                </span>
                <span className="text-xs text-faint tabular">
                  <LocalTime iso={m.playedAt.toISOString()} format="time" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-end">
        <Link href="/dashboard" className={buttonClass("secondary")}>
          {t("backToDashboard")}
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="hud-label">{label}</p>
      <p className={cx("mt-1 font-display text-5xl font-bold tabular", className)}>{value}</p>
    </div>
  );
}
