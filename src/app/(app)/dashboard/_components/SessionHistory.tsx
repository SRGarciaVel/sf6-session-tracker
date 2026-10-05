import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LocalTime } from "@/components/ui/LocalTime";
import { Panel, cx } from "@/components/ui/primitives";
import { deltaTone, formatDelta, formatWinRate } from "@/domain/format";
import type { SessionSummary } from "@/domain/session/engine";

const COLS =
  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-5 sm:grid-cols-[minmax(0,1.3fr)_7rem_minmax(0,0.9fr)_10rem_1rem]";

/** Compact replay-list style rows: dense, line-separated, cyan edge on hover/focus. */
export async function SessionHistory({
  items,
}: {
  items: Array<{ id: string; summary: SessionSummary }>;
}) {
  const t = await getTranslations("Dashboard.history");
  const tr = await getTranslations("Recap");
  const locale = await getLocale();
  return (
    <Panel title={t("title")} bodyClassName="px-0 pb-2 pt-3">
      {items.length === 0 ? (
        <div className="px-5 pb-3 text-sm">
          <p className="text-text">{t("empty")}</p>
          <p className="mt-1 text-muted">{t("emptyAction")}</p>
        </div>
      ) : (
        <>
          <div className={cx(COLS, "hud-label border-b border-line px-5 pb-2 text-xs")} aria-hidden>
            <span>{t("colSession")}</span>
            <span>{t("colRecord")}</span>
            <span className="hidden sm:block">{t("colWinRate")}</span>
            <span className="text-right">{t("colRating")}</span>
            <span className="hidden sm:block" />
          </div>
          <ul className="divide-y divide-line">
            {items.map(({ id, summary: s }) => {
              // Compact row: the session's active character only (details page lists all).
              const featured =
                s.characters.find((c) => c.characterKey === s.activeCharacterKey) ?? null;
              const system = featured?.current?.system ?? featured?.ratingSystem ?? null;
              const unit = system === "mr" ? "MR" : system === "lp" ? "LP" : "";
              const tone = deltaTone(featured?.delta ?? null);
              const decided = s.wins + s.losses;
              const live = s.status === "active";
              return (
                <li key={id}>
                  <Link
                    href={`/dashboard/sessions/${id}`}
                    className={cx(COLS, "hud-row px-5 py-2.5")}
                    aria-pressed={live ? true : undefined}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-display text-lg leading-tight font-bold uppercase">
                        <LocalTime iso={s.startedAt.toISOString()} format="day" />
                        {live && (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-[0.12em] text-win">
                            <span className="live-dot" aria-hidden />
                            {t("live")}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-muted tabular">
                        <LocalTime iso={s.startedAt.toISOString()} format="time" /> ·{" "}
                        {t("games", { count: s.totalGames })}
                      </span>
                    </span>
                    <span className="font-display text-lg font-bold whitespace-nowrap tabular">
                      <span className="text-win">{`${s.wins}${tr("resultWin")}`}</span>
                      <span className="mx-1 text-faint">/</span>
                      <span className="text-loss">{`${s.losses}${tr("resultLoss")}`}</span>
                    </span>
                    <span className="hidden items-center gap-3 sm:flex">
                      <span className="w-16 font-display text-lg font-semibold tabular">
                        {formatWinRate(Math.round(s.winRate * 10) / 10, locale)}
                      </span>
                      <span className="ratio-bar h-1 flex-1" aria-hidden>
                        {decided === 0 ? (
                          <span className="grow bg-line-strong" />
                        ) : (
                          <>
                            <span className="bg-win/80" style={{ flexGrow: s.wins }} />
                            <span className="bg-loss/80" style={{ flexGrow: s.losses }} />
                          </>
                        )}
                      </span>
                    </span>
                    <span
                      className={cx(
                        "text-right font-display text-lg font-bold whitespace-nowrap tabular",
                        tone === "positive"
                          ? "text-win"
                          : tone === "negative"
                            ? "text-loss"
                            : "text-muted",
                      )}
                    >
                      <span aria-hidden className="mr-1 text-xs">
                        {tone === "positive" ? "▲" : tone === "negative" ? "▼" : ""}
                      </span>
                      {featured && (
                        <span className="mr-1.5 text-xs font-semibold text-muted uppercase">
                          {featured.characterName}
                        </span>
                      )}
                      {formatDelta(featured?.delta ?? null, locale)}
                      <span className="ml-1 text-xs font-semibold text-muted">{unit}</span>
                    </span>
                    <span aria-hidden className="hidden text-faint sm:block">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
