"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Dot, ErrorText, cx } from "@/components/ui/primitives";
import {
  deltaTone,
  formatDelta,
  formatDuration,
  formatInteger,
  formatWinRate,
} from "@/domain/format";
import type { MatchResult } from "@/domain/sf6/types";
import { endSessionAction, startSessionAction } from "../actions";
import { timeAgo, useLiveDashboard, useNow } from "./LiveDashboard";

function BigStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "win" | "loss" | "accent" | "muted";
  hint?: string;
}) {
  const color = { win: "text-win", loss: "text-loss", accent: "text-accent", muted: "text-muted" }[
    tone ?? "muted"
  ];
  return (
    <div className="bg-surface px-4 py-4 sm:px-5">
      <p className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">{label}</p>
      <p
        key={value}
        className={cx(
          "mt-1 font-display text-3xl font-bold tabular sm:text-4xl",
          tone ? color : "text-text",
          "animate-rise",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-faint tabular">{hint}</p>}
    </div>
  );
}

const CHIP: Record<MatchResult, string> = {
  win: "bg-win text-bg",
  loss: "bg-loss text-bg",
  draw: "bg-faint text-bg",
};

function TrackerLine() {
  const { state, stream } = useLiveDashboard();
  const now = useNow(1000);
  const { tracker } = state;

  if (tracker.state === "idle") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted">
        <Dot tone="neutral" /> Tracking paused — start a session to track matches
      </span>
    );
  }
  if (tracker.state === "degraded") {
    return (
      <span
        className="flex items-center gap-2 text-xs text-warn"
        title={tracker.lastError ?? undefined}
      >
        <Dot tone="warn" /> CFN not responding ({tracker.consecutiveFailures} failed checks) —
        retrying automatically. Your stats are safe.
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-win opacity-60" />
        <Dot tone="win" />
      </span>
      {tracker.state === "starting"
        ? "Tracking started — first check in progress"
        : `Tracking · last check ${timeAgo(tracker.lastSuccessAt, now)}`}
      {stream !== "open" && <span className="text-faint">· reconnecting live view…</span>}
    </span>
  );
}

export function SessionPanel() {
  const { state } = useLiveDashboard();
  const router = useRouter();
  const now = useNow(30_000);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const s = state.live.session;
  const r = s.rating;
  const active = s.status === "active";
  const unit = r.system === "mr" ? "MR" : "LP";
  const duration =
    s.startedAt && now !== null
      ? formatDuration(
          (s.endedAt ? new Date(s.endedAt).getTime() : now) - new Date(s.startedAt).getTime(),
        )
      : null;

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

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-xs font-semibold tracking-[0.18em] text-muted uppercase">
            Current session
          </h2>
          {active ? (
            <Badge tone="win">● Live</Badge>
          ) : s.status === "ended" ? (
            <Badge>Ended</Badge>
          ) : (
            <Badge>No session</Badge>
          )}
          {duration && <span className="text-xs text-faint tabular">{duration}</span>}
        </div>
        <TrackerLine />
      </header>

      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
        <BigStat label="Wins" value={String(s.wins)} tone="win" />
        <BigStat label="Losses" value={String(s.losses)} tone="loss" />
        <BigStat label="Win rate" value={formatWinRate(s.winRate)} hint={`${s.totalGames} games`} />
        <BigStat
          label={`${unit} change`}
          value={formatDelta(r.primary.delta)}
          tone={
            deltaTone(r.primary.delta) === "positive"
              ? "win"
              : deltaTone(r.primary.delta) === "negative"
                ? "loss"
                : undefined
          }
          hint={
            r.primary.initial !== null
              ? `${formatInteger(r.primary.initial)} → ${formatInteger(r.primary.current)}`
              : undefined
          }
        />
        <BigStat
          label="Streak"
          value={
            s.currentWinStreak > 0
              ? `${s.currentWinStreak}W`
              : s.currentLossStreak > 0
                ? `${s.currentLossStreak}L`
                : "—"
          }
          tone={s.currentWinStreak >= 3 ? "accent" : s.currentLossStreak > 0 ? "loss" : undefined}
        />
        <BigStat label="Best streak" value={`${s.bestWinStreak}W`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-h-6 items-center gap-1" aria-label="Recent results">
          {s.recentResults.length === 0 ? (
            <span className="text-xs text-faint">
              {active ? "Waiting for your first ranked match…" : "Results will appear here."}
            </span>
          ) : (
            s.recentResults.map((res, i) => (
              <span
                key={`${i}-${res}`}
                className={cx(
                  "grid size-6 place-items-center rounded text-[11px] font-bold",
                  CHIP[res],
                )}
              >
                {res === "win" ? "W" : res === "loss" ? "L" : "D"}
              </span>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {s.sessionId && (
            <Link
              href={`/dashboard/sessions/${s.sessionId}`}
              className="px-2 text-sm text-muted hover:text-text"
            >
              Details
            </Link>
          )}
          {active && !confirmEnd && (
            <Button variant="danger" onClick={() => setConfirmEnd(true)} disabled={pending}>
              End session
            </Button>
          )}
          {active && confirmEnd && (
            <>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={end} disabled={pending}>
                Yes, end session
              </Button>
            </>
          )}
          <Button
            variant="primary"
            onClick={start}
            disabled={pending}
            title={active ? "Ends the current session and starts a new one from zero" : undefined}
          >
            {pending ? "Working…" : active ? "Start new session" : "Start session"}
          </Button>
        </div>
      </div>
      {error && (
        <div className="border-t border-line px-5 py-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  );
}

export function PlayerHeader({ characterFallback }: { characterFallback: string | null }) {
  const { state } = useLiveDashboard();
  const r = state.live.session.rating;
  const unit = r.system === "mr" ? "MR" : "LP";
  const current = r.system === "mr" ? state.player.masterRate : state.player.leaguePoints;
  return (
    <div className="bg-slash relative overflow-hidden rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <p className="font-display text-[11px] font-semibold tracking-[0.3em] text-accent uppercase">
        Street Fighter 6
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {state.live.player.displayName}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {state.live.player.mainCharacter ?? characterFallback ?? "—"} · CFN ID{" "}
            <span className="font-mono text-text">{state.player.cfnUserId}</span>
          </p>
        </div>
        <dl className="flex gap-8">
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
              Rank
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold">{state.player.rank ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
              Current {unit}
            </dt>
            <dd
              key={current ?? "none"}
              className="mt-1 animate-rise font-display text-2xl font-bold tabular"
            >
              {formatInteger(current)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
