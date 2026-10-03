import Link from "next/link";
import { LocalTime } from "@/components/ui/LocalTime";
import { Panel, cx } from "@/components/ui/primitives";
import { deltaTone, formatDelta, formatWinRate } from "@/domain/format";
import type { SessionSummary } from "@/domain/session/engine";

export function SessionHistory({ items }: { items: Array<{ id: string; summary: SessionSummary }> }) {
  return (
    <Panel title="Session history">
      {items.length === 0 ? (
        <p className="text-sm text-muted">Your sessions will show up here.</p>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {items.map(({ id, summary: s }) => {
            const unit = s.rating.system === "mr" ? "MR" : "LP";
            const tone = deltaTone(s.rating.primary.delta);
            return (
              <li key={id}>
                <Link href={`/dashboard/sessions/${id}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-3 hover:opacity-90 sm:gap-8">
                  <span>
                    <span className="block font-medium">
                      <LocalTime iso={s.startedAt.toISOString()} format="day" />
                      {s.status === "active" && <span className="ml-2 text-xs font-semibold text-win">LIVE</span>}
                    </span>
                    <span className="text-xs text-faint tabular">
                      <LocalTime iso={s.startedAt.toISOString()} format="time" /> · {s.totalGames} games
                    </span>
                  </span>
                  <span className="font-display font-semibold tabular">
                    <span className="text-win">{s.wins}W</span> <span className="text-faint">/</span> <span className="text-loss">{s.losses}L</span>
                  </span>
                  <span className="w-14 text-right font-display tabular">{formatWinRate(Math.round(s.winRate * 10) / 10)}</span>
                  <span className={cx("w-20 text-right font-display font-semibold tabular", tone === "positive" ? "text-win" : tone === "negative" ? "text-loss" : "text-muted")}>
                    {formatDelta(s.rating.primary.delta)} {unit}
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
