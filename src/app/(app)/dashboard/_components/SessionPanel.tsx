"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge, Button, Dot, ErrorText, LiveIndicator, cx } from "@/components/ui/primitives";
import {
  deltaTone,
  formatDelta,
  formatDuration,
  formatInteger,
  formatWinRate,
} from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";
import { pickRatingCharacter, type LiveCharacterProgress } from "@/domain/overlay/state";
import { endSessionAction, startSessionAction } from "../actions";
import { timeAgo, useLiveDashboard, useNow } from "./LiveDashboard";

type Tone = "win" | "loss" | "neutral";

/**
 * Re-mounts on value change so the rise + flash animation plays; static on first render
 * (no flashing on page load / refresh).
 */
function Changing({
  value,
  tone = "neutral",
  className,
}: {
  value: string;
  tone?: Tone;
  className?: string;
}) {
  const [tracked, setTracked] = useState({ value, version: 0 });
  if (tracked.value !== value) setTracked({ value, version: tracked.version + 1 });
  return (
    <span
      key={tracked.version}
      className={cx(
        "inline-block",
        className,
        tracked.version > 0 && `num-change num-change-${tone}`,
      )}
    >
      {value}
    </span>
  );
}

const RESULT_KEY = { win: "resultWin", loss: "resultLoss", draw: "resultDraw" } as const;
const CHIP: Record<MatchResult, string> = {
  win: "bg-win text-bg",
  loss: "bg-loss text-bg",
  draw: "bg-faint text-bg",
};

/** Arrow glyph + sign: never rely on color alone for up/down. */
function DeltaChip({ delta, locale }: { delta: number | null; locale: string }) {
  const tone = deltaTone(delta);
  const arrow = tone === "positive" ? "▲" : tone === "negative" ? "▼" : "■";
  return (
    <Changing
      value={`${arrow} ${formatDelta(delta, locale)}`}
      tone={tone === "positive" ? "win" : tone === "negative" ? "loss" : "neutral"}
      className={cx(
        "hud-tag h-7 px-3 text-base tabular",
        tone === "positive" && "bg-win/15 text-win",
        tone === "negative" && "bg-loss/15 text-loss",
        tone === "neutral" && "text-muted",
      )}
    />
  );
}

/* ───────────────────────── Player header ───────────────────────── */

export function PlayerHeader() {
  const t = useTranslations("Dashboard");
  const locale = useLocale();
  const { state } = useLiveDashboard();
  // Ratings are per character: show the active (or favorite) character, never a global value.
  const active = pickRatingCharacter(state.live.session);
  const unit = unitOf(active);
  const current = active?.current?.value ?? null;
  const name = state.live.player.displayName;

  return (
    <section className="hud-panel animate-panel-in overflow-hidden">
      {/* oversized outlined name: texture, not content */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -bottom-10 font-display text-[8.5rem] leading-none font-extrabold whitespace-nowrap text-transparent uppercase select-none [-webkit-text-stroke:1px_rgb(255_255_255/0.045)]"
      >
        {name}
      </span>
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-magenta" />

      <div className="relative grid gap-5 py-5 pr-6 pl-6 sm:pl-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="hud-tag bg-magenta text-white">{t("playerTag")}</span>
            <span className="hud-label">{t("eyebrow")}</span>
          </div>
          <h1 className="mt-2 truncate font-display text-4xl leading-none font-bold sm:text-5xl">
            {name}
          </h1>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="hud-label">{t("cfnId")}</dt>
              <dd className="font-mono text-text">{state.player.cfnUserId}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="hud-label">{t("character")}</dt>
              <dd className="font-display text-base font-semibold uppercase">
                {active?.characterName ?? t("noCharacter")}
              </dd>
            </div>
          </dl>
        </div>

        <dl className="flex items-stretch">
          <div className="pr-6">
            <dt className="hud-label">{t("rank")}</dt>
            <dd className="mt-1 font-display text-3xl font-bold tracking-wide text-cyan uppercase">
              {active?.current?.rank ?? active?.initial?.rank ?? "—"}
            </dd>
          </div>
          <div aria-hidden className="w-px -skew-x-[18deg] bg-line-strong" />
          <div className="pl-6 text-right">
            <dt className="hud-label">{t("currentRating", { unit })}</dt>
            <dd className="mt-1 font-display text-5xl leading-none font-bold tabular">
              <Changing value={formatInteger(current, locale)} />
              <span className="ml-1.5 text-lg font-semibold text-muted">{unit}</span>
            </dd>
          </div>
        </dl>
      </div>
      <div
        aria-hidden
        className="h-0.5 bg-gradient-to-r from-magenta via-violet/50 to-transparent"
      />
    </section>
  );
}

function unitOf(c: LiveCharacterProgress | null): string {
  const system = c?.current?.system ?? c?.ratingSystem ?? null;
  return system === "mr" ? "MR" : system === "lp" ? "LP" : "";
}

/** One compact row per character played this session — ratings never mixed across rows. */
export function CharacterBreakdown({
  characters,
  legacy,
}: {
  characters: LiveCharacterProgress[];
  legacy: boolean;
}) {
  const t = useTranslations("Dashboard.session");
  const tr = useTranslations("Recap");
  const locale = useLocale();
  return (
    <div className="border-t border-line px-5 py-3 sm:px-6">
      <p className="hud-label">{t("characters")}</p>
      {legacy && <p className="mt-1 text-xs text-faint">{t("legacyNote")}</p>}
      <ul className="mt-2 divide-y divide-line/70">
        {characters.map((c) => {
          const unit = unitOf(c);
          return (
            <li
              key={c.characterKey}
              data-character-row={c.characterKey}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-4 py-1.5 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)_6rem]"
            >
              <span className="min-w-0 truncate font-display text-base font-bold uppercase">
                {c.characterName}
                {c.initial?.rank && c.current?.rank && c.initial.rank !== c.current.rank && (
                  <span className="ml-2 text-xs font-semibold text-magenta normal-case">
                    {c.initial.rank} → {c.current.rank}
                  </span>
                )}
              </span>
              <span className="font-display text-base font-bold tabular">
                <span className="text-win">{`${c.wins}${tr("resultWin")}`}</span>
                <span className="mx-1 text-faint">/</span>
                <span className="text-loss">{`${c.losses}${tr("resultLoss")}`}</span>
              </span>
              <span className="hidden font-display text-base text-muted tabular sm:block">
                {c.initial && c.delta !== null
                  ? `${formatInteger(c.initial.value, locale)} → ${formatInteger(c.current?.value ?? null, locale)}`
                  : formatInteger(c.current?.value ?? null, locale)}{" "}
                <span className="text-xs">{unit}</span>
              </span>
              <span
                data-delta
                title={c.baselineKnown ? undefined : t("noBaseline")}
                className={cx(
                  "text-right font-display text-base font-bold tabular",
                  deltaTone(c.delta) === "positive"
                    ? "text-win"
                    : deltaTone(c.delta) === "negative"
                      ? "text-loss"
                      : "text-muted",
                )}
              >
                {c.delta === null ? "—" : `${formatDelta(c.delta, locale)} ${unit}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────────── Scoreboard ───────────────────────── */

function ScoreSide({
  label,
  value,
  letter,
  tone,
  align,
}: {
  label: string;
  value: string;
  letter: string;
  tone: "win" | "loss";
  align: "left" | "right";
}) {
  return (
    <div className={cx("min-w-0", align === "right" && "text-right")}>
      <p className={cx("hud-label", tone === "win" ? "text-win/90" : "text-loss/90")}>{label}</p>
      <p
        className={cx(
          "mt-1 flex items-baseline gap-1.5 font-display leading-[0.85] font-extrabold tabular",
          align === "right" && "justify-end",
          tone === "win" ? "text-win" : "text-loss",
        )}
      >
        <span data-testid={`score-${tone === "win" ? "wins" : "losses"}`}>
          <Changing value={value} tone={tone} className="text-7xl sm:text-8xl" />
        </span>
        <span className="text-2xl font-bold opacity-70" aria-hidden>
          {letter}
        </span>
      </p>
    </div>
  );
}

export function SessionPanel() {
  const t = useTranslations("Dashboard.session");
  const tc = useTranslations("Common");
  const tr = useTranslations("Recap");
  const locale = useLocale();
  const { state } = useLiveDashboard();
  const router = useRouter();
  const now = useNow(30_000);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const s = state.live.session;
  const featured = pickRatingCharacter(s);
  const played = s.characters.filter((c) => c.games > 0);
  const active = s.status === "active";
  const unit = unitOf(featured);
  const duration =
    s.startedAt && now !== null
      ? formatDuration(
          (s.endedAt ? new Date(s.endedAt).getTime() : now) - new Date(s.startedAt).getTime(),
        )
      : null;
  const decided = s.wins + s.losses;

  const start = () => {
    setError(null);
    startTransition(async () => {
      const res = await startSessionAction();
      if (!res.ok) setError(res.error);
    });
  };
  const end = () => {
    setError(null);
    setConfirmEnd(false);
    startTransition(async () => {
      const res = await endSessionAction();
      if (!res.ok) setError(res.error);
      else if (res.data.sessionId) router.push(`/dashboard/sessions/${res.data.sessionId}`);
    });
  };

  const streak =
    s.currentWinStreak > 0
      ? { text: t("streakWins", { count: s.currentWinStreak }), tone: "text-win" }
      : s.currentLossStreak > 0
        ? { text: t("streakLosses", { count: s.currentLossStreak }), tone: "text-loss" }
        : { text: "—", tone: "text-muted" };

  return (
    <section
      className="hud-panel animate-panel-in"
      style={
        active ? ({ "--frame": "var(--color-line-strong)" } as React.CSSProperties) : undefined
      }
    >
      <span
        aria-hidden
        className={cx(
          "absolute inset-x-0 top-0 h-0.5",
          active
            ? "bg-gradient-to-r from-cyan via-blue to-transparent"
            : "bg-gradient-to-r from-line-strong to-transparent",
        )}
      />
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4 sm:px-6">
        <h2 className="hud-heading min-w-40 flex-1">{t("title")}</h2>
        {duration && <span className="font-display text-base text-muted tabular">{duration}</span>}
        {active ? (
          <LiveIndicator label={t("live").replace("●", "").trim()} />
        ) : s.status === "ended" ? (
          <Badge>{t("ended")}</Badge>
        ) : (
          <Badge>{t("none")}</Badge>
        )}
      </header>

      {/* Scoreline: P1-vs-P2 style — wins left, losses right, win rate in the middle. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3 px-5 pt-5 sm:gap-6 sm:px-8">
        <ScoreSide
          label={t("wins")}
          value={formatInteger(s.wins, locale)}
          letter={tr("resultWin")}
          tone="win"
          align="left"
        />
        <div className="pb-1 text-center">
          <p className="hud-label">{t("winRate")}</p>
          <p className="mt-1 font-display text-5xl leading-none font-bold tabular sm:text-6xl">
            <Changing value={formatWinRate(s.winRate, locale)} />
          </p>
          <p className="mt-1 text-sm text-muted">{t("games", { count: s.totalGames })}</p>
        </div>
        <ScoreSide
          label={t("losses")}
          value={formatInteger(s.losses, locale)}
          letter={tr("resultLoss")}
          tone="loss"
          align="right"
        />
      </div>
      <div
        className="ratio-bar mx-5 mt-4 sm:mx-8"
        role="img"
        aria-label={`${t("ratio")}: ${s.wins}–${s.losses}`}
      >
        {decided === 0 ? (
          <span className="grow bg-line-strong" />
        ) : (
          <>
            <span
              className="bg-win shadow-[0_0_10px_rgb(41_240_168/0.45)]"
              style={{ flexGrow: s.wins }}
            />
            <span className="bg-loss" style={{ flexGrow: s.losses }} />
          </>
        )}
      </div>

      {/* Telemetry band: rating track + streaks */}
      <div className="mt-6 grid border-t border-line md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-baseline gap-2">
              <span className="hud-label">{t("activeCharacter")}</span>
              <span
                className="font-display text-xl leading-none font-bold uppercase"
                data-testid="active-character"
              >
                {featured?.characterName ?? "—"}
              </span>
            </span>
            {featured?.current?.rank && (
              <span className="hud-tag text-cyan">{featured.current.rank}</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {featured?.initial && featured.delta !== null && (
              <>
                <span className="font-display text-xl font-semibold text-muted tabular">
                  {formatInteger(featured.initial.value, locale)}
                </span>
                <span
                  aria-hidden
                  className="relative h-px min-w-12 flex-1 bg-gradient-to-r from-line-strong to-cyan"
                >
                  <span className="absolute -top-[5px] -right-1 text-[10px] leading-none text-cyan">
                    ▶
                  </span>
                </span>
              </>
            )}
            <span className="font-display text-4xl leading-none font-bold tabular">
              <Changing value={formatInteger(featured?.current?.value ?? null, locale)} />
              <span className="ml-1 text-base font-semibold text-muted">{unit}</span>
            </span>
            <DeltaChip delta={featured?.delta ?? null} locale={locale} />
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line md:border-t-0 md:border-l">
          <div className="px-5 py-4">
            <dt className="hud-label">{t("currentStreak")}</dt>
            <dd
              className={cx(
                "mt-2 font-display text-4xl leading-none font-bold tabular",
                streak.tone,
              )}
            >
              <Changing value={streak.text} tone={s.currentWinStreak > 0 ? "win" : "neutral"} />
            </dd>
          </div>
          <div className="border-l border-line px-5 py-4">
            <dt className="hud-label">{t("bestStreak")}</dt>
            <dd className="mt-2 font-display text-4xl leading-none font-bold tabular">
              {t("streakWins", { count: s.bestWinStreak })}
            </dd>
          </div>
        </dl>
      </div>

      {(played.length > 0 || s.ratingModel === "legacy") && (
        <CharacterBreakdown characters={played} legacy={s.ratingModel === "legacy"} />
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-0/70 px-5 py-3 sm:px-6">
        <div className="flex min-h-7 items-center gap-1" aria-label={t("recentResults")}>
          {s.recentResults.length === 0 ? (
            <span className="text-sm text-muted">
              {active
                ? t("waitingFirstMatch")
                : s.status === "none"
                  ? t("noSessionHint")
                  : t("resultsAppearHere")}
            </span>
          ) : (
            s.recentResults.map((res, i) => (
              <span
                key={`${i}-${res}`}
                className={cx(
                  "grid h-7 w-6 place-items-center font-display text-sm font-bold [clip-path:polygon(3px_0,100%_0,calc(100%-3px)_100%,0_100%)]",
                  CHIP[res],
                )}
              >
                {tr(RESULT_KEY[res])}
              </span>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.sessionId && (
            <Link href={`/dashboard/sessions/${s.sessionId}`} className="btn btn-ghost btn-md">
              {t("details")}
            </Link>
          )}
          {active && !confirmEnd && (
            <Button variant="danger" onClick={() => setConfirmEnd(true)} disabled={pending}>
              {t("endSession")}
            </Button>
          )}
          {active && confirmEnd && (
            <>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                {tc("cancel")}
              </Button>
              <Button variant="danger" onClick={end} disabled={pending}>
                {t("confirmEnd")}
              </Button>
            </>
          )}
          <Button
            variant="primary"
            onClick={start}
            disabled={pending}
            title={active ? t("startNewTooltip") : undefined}
          >
            {pending ? tc("working") : active ? t("startNewSession") : t("startSession")}
          </Button>
        </div>
      </footer>
      {error && (
        <div className="border-t border-line px-5 py-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── Status bar ───────────────────────── */

/** lastError is stored as "<provider code>: <technical message>"; show a translated message. */
const TRACKER_ERROR_KEYS = {
  not_found: "notFound",
  rate_limited: "rateLimited",
  timeout: "timeout",
  unavailable: "unavailable",
  invalid_response: "invalidResponse",
} as const;

function trackerErrorKey(lastError: string | null) {
  const code = lastError?.split(":")[0] ?? "";
  return code in TRACKER_ERROR_KEYS
    ? TRACKER_ERROR_KEYS[code as keyof typeof TRACKER_ERROR_KEYS]
    : "generic";
}

/** Bottom telemetry strip (SF6 hint-bar placement): tracker health, realtime link, OBS sources. */
export function StatusBar() {
  const t = useTranslations("Dashboard.tracker");
  const ts = useTranslations("Dashboard.status");
  const tc = useTranslations("Common");
  const tErrors = useTranslations("Errors");
  const locale = useLocale();
  const { state, stream } = useLiveDashboard();
  const now = useNow(1000);
  const { tracker } = state;

  const trackerText =
    tracker.state === "idle"
      ? t("idle")
      : tracker.state === "degraded"
        ? t("degraded", { count: tracker.consecutiveFailures })
        : tracker.state === "starting"
          ? t("starting")
          : t("ok", {
              ago: timeAgo(tracker.lastSuccessAt, now, locale, {
                never: tc("never"),
                justNow: tc("justNow"),
              }),
            });

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line-strong bg-bg/95 backdrop-blur-sm"
    >
      <div className="mx-auto flex h-10 max-w-[1440px] items-center gap-5 overflow-hidden px-4 text-[13px] sm:px-6">
        <span
          className="flex min-w-0 items-center gap-2"
          title={
            tracker.state === "degraded"
              ? tErrors(`provider.${trackerErrorKey(tracker.lastError)}`)
              : undefined
          }
        >
          <span className="hud-label hidden sm:inline">{ts("tracker")}</span>
          {tracker.state === "ok" ? (
            <span className="live-dot shrink-0" aria-hidden />
          ) : (
            <Dot
              tone={
                tracker.state === "idle" ? "neutral" : tracker.state === "degraded" ? "warn" : "win"
              }
            />
          )}
          <span
            className={cx("truncate", tracker.state === "degraded" ? "text-warn" : "text-muted")}
          >
            {trackerText}
          </span>
        </span>
        <span aria-hidden className="hidden h-4 w-px -skew-x-[18deg] bg-line-strong md:block" />
        <span className="hidden items-center gap-2 md:flex">
          <span className="hud-label">{ts("link")}</span>
          <Dot tone={stream === "open" ? "win" : "warn"} />
          <span className="text-muted">{stream === "open" ? ts("linkOk") : ts("linkDown")}</span>
        </span>
        <span aria-hidden className="hidden h-4 w-px -skew-x-[18deg] bg-line-strong md:block" />
        <span className="ml-auto flex items-center gap-2 md:ml-0">
          <span className="hud-label">{ts("obs")}</span>
          <span
            className={cx(
              "font-display text-base font-bold tabular",
              state.overlayConnections > 0 ? "text-win" : "text-muted",
            )}
          >
            {state.overlayConnections}
          </span>
        </span>
      </div>
    </div>
  );
}
