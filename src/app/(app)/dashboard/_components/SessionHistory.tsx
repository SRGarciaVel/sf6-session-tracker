import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LocalTime } from "@/components/ui/LocalTime";
import { Panel, cx } from "@/components/ui/primitives";
import { deltaTone, formatDelta, formatWinRate } from "@/domain/format";
import type { SessionSummary } from "@/domain/session/engine";

export async function SessionHistory({
  items,
}: {
  items: Array<{ id: string; summary: SessionSummary }>;
}) {
  const t = await getTranslations("Dashboard.history");
  const tr = await getTranslations("Recap");
  const locale = await getLocale();
  return (
    <Panel title={t("title")}>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t("empty")}</p>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {items.map(({ id, summary: s }) => {
            const unit = s.rating.system === "mr" ? "MR" : "LP";
            const tone = deltaTone(s.rating.primary.delta);
            return (
              <li key={id}>
                <Link
                  href={`/dashboard/sessions/${id}`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-3 hover:opacity-90 sm:gap-8"
                >
                  <span>
                    <span className="block font-medium">
                      <LocalTime iso={s.startedAt.toISOString()} format="day" />
                      {s.status === "active" && (
                        <span className="ml-2 text-xs font-semibold text-win">{t("live")}</span>
                      )}
                    </span>
                    <span className="text-xs text-faint tabular">
                      <LocalTime iso={s.startedAt.toISOString()} format="time" /> ·{" "}
                      {t("games", { count: s.totalGames })}
                    </span>
                  </span>
                  <span className="font-display font-semibold tabular">
                    <span className="text-win">{`${s.wins}${tr("resultWin")}`}</span>{" "}
                    <span className="text-faint">/</span>{" "}
                    <span className="text-loss">{`${s.losses}${tr("resultLoss")}`}</span>
                  </span>
                  <span className="w-14 text-right font-display tabular">
                    {formatWinRate(Math.round(s.winRate * 10) / 10, locale)}
                  </span>
                  <span
                    className={cx(
                      "w-20 text-right font-display font-semibold tabular",
                      tone === "positive"
                        ? "text-win"
                        : tone === "negative"
                          ? "text-loss"
                          : "text-muted",
                    )}
                  >
                    {formatDelta(s.rating.primary.delta, locale)} {unit}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
