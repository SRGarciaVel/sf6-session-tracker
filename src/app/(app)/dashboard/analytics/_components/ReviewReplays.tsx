/**
 * Replay Selection (Phase 6.4C) — presentation only (server-rendered; the copy button is the only
 * client piece). The selection comes from domain/analytics/review-replays.ts: concrete matches of
 * the signal's evidence. Nothing here claims what happened inside a replay.
 *
 * Replay ids are shown ONLY on this authenticated page (not in the plain-text summary or the PDF).
 * There is no Buckler deep link: the user opens a Replay ID inside Street Fighter 6.
 */
import { useTranslations } from "next-intl";
import { REVIEW_TYPE_KEYS } from "@/components/analytics/review-content";
import { cx } from "@/components/ui/primitives";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  ReviewReplayCandidate,
  ReviewReplayGroup,
  ReviewReplaySelection,
} from "@/domain/analytics/review-replays";
import type { MatchResult } from "@/domain/sf6/types";
import { ReviewReplayCopyButton } from "./ReviewReplayCopyButton";
import { Icon } from "@/components/ui/Icon";

const RESULT_STYLE: Record<MatchResult, string> = {
  win: "border-win/60 text-win",
  loss: "border-loss/60 text-loss",
  draw: "border-line-strong text-muted",
};

/** Group label keys (Analytics.review.replays.groups.*); single-list groups have none. */
const GROUP_LABEL: Record<string, string | null> = {
  matchup: null,
  exposure: null,
  recent: "recent",
  previous: "previous",
  "first-half": "firstHalf",
  "second-half": "secondHalf",
};

export function ReviewReplayDisclosure({
  selection,
}: {
  selection: ReviewReplaySelection | undefined;
}) {
  const t = useTranslations("Analytics.review.replays");
  // Empty selection: the priority stays as it is, simply without this disclosure.
  if (!selection || selection.totalCandidates === 0) return null;
  const typeKey = REVIEW_TYPE_KEYS[selection.signalType];
  return (
    <details
      className="group/replays mt-3 border-t border-line pt-3"
      data-testid="review-replays"
      data-signal={selection.signalId}
    >
      <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 font-display text-sm font-bold tracking-wide text-text uppercase hover:text-cyan">
        <span
          aria-hidden
          className="inline-block transition-transform group-open/replays:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
        {t("title", { count: selection.totalCandidates })}
      </summary>
      <p className="mt-2 text-xs text-muted">{t(`intro.${typeKey}`)}</p>
      <div className="mt-3 space-y-3">
        {selection.groups.map((g) =>
          g.id.startsWith("transition-") ? (
            <TransitionPair key={g.id} group={g} />
          ) : (
            <ReplayGroup key={g.id} group={g} />
          ),
        )}
      </div>
    </details>
  );
}

function ReplayGroup({ group }: { group: ReviewReplayGroup }) {
  const t = useTranslations("Analytics.review.replays");
  const label = GROUP_LABEL[group.id] ?? null;
  const headingId = `replays-${group.id}-${group.candidates[0]?.externalMatchId ?? "x"}`;
  return (
    <div
      role={label ? "group" : undefined}
      aria-labelledby={label ? headingId : undefined}
      data-group={group.id}
    >
      {label && (
        <h4 id={headingId} className="hud-label mb-1 text-xs">
          {t(`groups.${label}`)}
        </h4>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {group.candidates.map((c) => (
          <li key={c.externalMatchId}>
            <ReplayRow candidate={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TransitionPair({ group }: { group: ReviewReplayGroup }) {
  const t = useTranslations("Analytics.review.replays");
  const n = group.id.slice("transition-".length);
  const [loss, next] = group.candidates;
  const headingId = `replays-${group.id}-${loss?.externalMatchId ?? "x"}`;
  return (
    <div role="group" aria-labelledby={headingId} data-group={group.id}>
      <h4 id={headingId} className="hud-label mb-1 text-xs">
        {t("transition", { n })}
      </h4>
      <ol className="border-y border-line">
        {loss && (
          <li>
            <p className="pt-1.5 text-[0.7rem] font-semibold tracking-wide text-muted uppercase">
              {t("afterLossLabel")}
            </p>
            <ReplayRow candidate={loss} />
          </li>
        )}
        {next && (
          <li className="border-t border-dashed border-line">
            <p className="pt-1.5 text-[0.7rem] font-semibold tracking-wide text-muted uppercase">
              <Icon name="arrow-down" className="mr-1 inline-block align-[-0.125em] text-cyan" />
              {t("nextLabel")}
            </p>
            <ReplayRow candidate={next} />
          </li>
        )}
      </ol>
    </div>
  );
}

function ReplayRow({ candidate: c }: { candidate: ReviewReplayCandidate }) {
  const t = useTranslations("Analytics.review.replays");
  const ta = useTranslations("Analytics");
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2"
      data-replay={c.externalMatchId}
    >
      <span
        className={cx(
          "grid h-6 w-6 shrink-0 place-items-center border font-display text-xs font-bold",
          RESULT_STYLE[c.result],
        )}
      >
        <span aria-hidden>{ta(`resultShort.${c.result}`)}</span>
        <span className="sr-only">{ta(`result.${c.result}`)}</span>
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold break-words">
          {c.opponentCharacterName
            ? t("pair", { own: c.characterName, opponent: c.opponentCharacterName })
            : c.characterName}
        </span>
        <span className="block text-xs text-muted">
          <LocalTime iso={c.playedAt.toISOString()} format="datetime" />
        </span>
      </span>
      <span className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        <span className="min-w-0 text-xs">
          <span className="sr-only">{t("replayId")} </span>
          <code className="font-mono text-xs break-all text-text" data-testid="replay-id">
            {c.externalMatchId}
          </code>
        </span>
        <ReviewReplayCopyButton
          replayId={c.externalMatchId}
          labels={{
            copy: t("copy"),
            copied: t("copied"),
            failed: t("copyFailed"),
            aria: t("copyAria", { id: c.externalMatchId }),
          }}
        />
      </span>
    </div>
  );
}

/** Section-level help (once, not per card): how to open a Replay ID inside SF6. */
export function ReplayIdHelp() {
  const t = useTranslations("Analytics.review.replays");
  return (
    <details className="group/help text-sm" data-testid="replay-id-help">
      <summary className="inline-flex min-h-9 cursor-pointer items-center gap-2 font-display font-bold tracking-wide text-muted uppercase hover:text-text">
        <span
          aria-hidden
          className="inline-block transition-transform group-open/help:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
        {t("helpTitle")}
      </summary>
      <p className="mt-2 text-xs text-muted">{t("helpIntro")}</p>
      <p className="mt-1 font-mono text-xs text-text">{t("helpPath")}</p>
      <p className="mt-1 text-xs text-muted">{t("helpNote")}</p>
    </details>
  );
}
