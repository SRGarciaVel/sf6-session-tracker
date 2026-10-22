import { useTranslations } from "next-intl";
import { LocalTime } from "@/components/ui/LocalTime";
import { cx } from "@/components/ui/primitives";
import type { MatchResult } from "@/domain/sf6/types";
import type { ActivityItem } from "./types";

const ROUND: Record<MatchResult, string> = {
  win: "fs-round-win",
  loss: "fs-round-loss",
  draw: "fs-round-draw",
};
const STAMP: Record<MatchResult, string> = {
  win: "bg-win",
  loss: "bg-loss",
  draw: "bg-muted",
};

/** Numbered round markers, oldest → newest (results always carry a letter, not colour alone). */
export function RoundStrip({
  results,
  newestIsNew = false,
  titled = false,
  firstNumber = 1,
  className,
}: {
  results: readonly MatchResult[];
  /** Session position of the first marker (when only the latest matches are shown). */
  firstNumber?: number;
  /** Marks the newest marker (outline + pop); the announcement belongs to `LastMatch`. */
  newestIsNew?: boolean;
  /** Show the visible «Partidas» label above the markers. */
  titled?: boolean;
  className?: string;
}) {
  const t = useTranslations("FightSession.activity");
  if (results.length === 0) return null;
  const list = (
    <ol
      aria-label={t("label")}
      className={cx("m-0 flex list-none flex-wrap gap-1.5 p-0", !titled && className)}
    >
      {results.map((r, i) => {
        const isNew = newestIsNew && i === results.length - 1;
        return (
          <li
            key={i}
            className={cx("fs-round fs-cut", ROUND[r], isNew && "fs-round-new fs-pop")}
            aria-label={`${t("matchNumber", { n: firstNumber + i })}: ${t(`result.${r}`)}`}
          >
            <span className="fs-round-n" aria-hidden>
              {firstNumber + i}
            </span>
            <span className="fs-round-r" aria-hidden>
              {t(`letter.${r}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
  if (!titled) return list;
  return (
    <div className={cx("grid gap-3", className)}>
      <p className="fs-eyebrow m-0" aria-hidden>
        {t("matches")}
      </p>
      {list}
    </div>
  );
}

function opponentOf(item: ActivityItem, unknown: string) {
  return item.opponentCharacter ?? item.opponentName ?? unknown;
}

/**
 * The latest registered match: a result stamp, opponent and time. When `isNew`, a polite live
 * region announces it once (new-match feedback for screen readers).
 */
export function LastMatch({
  item,
  isNew = false,
  className,
}: {
  item: ActivityItem;
  isNew?: boolean;
  className?: string;
}) {
  const t = useTranslations("FightSession.activity");
  const opponent = opponentOf(item, t("unknownOpponent"));
  const result = t(`result.${item.result}`);
  return (
    <div className={cx("flex min-w-0 items-center gap-4", className)}>
      <span
        className={cx("fs-stamp fs-cut", STAMP[item.result], isNew && "fs-stamp-in")}
        aria-hidden
      >
        {t(`letter.${item.result}`)}
      </span>
      <div className="min-w-0">
        <p className="fs-eyebrow m-0 flex items-center gap-2">
          {t("lastMatch")}
          {isNew && (
            <span className="bg-cyan px-1.5 py-0.5 tracking-[0.1em] text-bg">{t("new")}</span>
          )}
        </p>
        <p className="m-0 truncate font-display text-2xl font-bold uppercase">
          {result} {t("vs")} {opponent}
        </p>
        <p className="m-0 truncate text-sm text-muted">
          {item.characterName}
          {item.opponentName && item.opponentCharacter && ` · ${item.opponentName}`}
          {item.playedAt && (
            <>
              {" · "}
              <LocalTime iso={item.playedAt} format="time" />
            </>
          )}
        </p>
      </div>
      <span className="sr-only" aria-live="polite">
        {isNew ? t("newAnnounce", { result, opponent }) : ""}
      </span>
    </div>
  );
}

/**
 * Concise match log (newest first), with honest empty / waiting states. No per-match rating:
 * SST does not store one (design/phase-5-6a/audit.md, data constraint).
 */
export function ActivityList({
  items,
  waiting = false,
  limit,
  firstNumber = 1,
  className,
}: {
  items: readonly ActivityItem[];
  /** Active session with no match yet: say what happens next instead of "empty". */
  waiting?: boolean;
  limit?: number;
  /** Session position of `items[0]` (when the list is a slice of a longer session). */
  firstNumber?: number;
  className?: string;
}) {
  const t = useTranslations("FightSession.activity");
  if (items.length === 0) {
    return (
      <div className={cx("py-6", className)}>
        <p className="m-0 font-display text-xl font-bold uppercase">
          {waiting ? t("waiting") : t("empty")}
        </p>
        {waiting && <p className="m-0 mt-1 text-sm text-muted">{t("waitingHint")}</p>}
      </div>
    );
  }
  const shown = [...items].reverse().slice(0, limit ?? items.length);
  return (
    <ol aria-label={t("label")} className={cx("m-0 list-none divide-y divide-line p-0", className)}>
      {shown.map((m) => {
        const n = items.indexOf(m) + firstNumber;
        return (
          <li
            key={m.id}
            className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2"
          >
            <span className={cx("fs-round fs-round-sm fs-cut", ROUND[m.result])} aria-hidden>
              <span className="fs-round-r">{t(`letter.${m.result}`)}</span>
            </span>
            <span className="min-w-0 truncate">
              <span className="sr-only">{t(`result.${m.result}`)}. </span>
              <span className="text-muted tabular">{n}.</span> {m.characterName} {t("vs")}{" "}
              {opponentOf(m, t("unknownOpponent"))}
            </span>
            <span className="text-sm text-muted tabular">
              {m.playedAt ? <LocalTime iso={m.playedAt} format="time" /> : "—"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
