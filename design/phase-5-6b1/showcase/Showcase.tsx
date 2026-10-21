"use client";

/**
 * Isolated review page for the Fight Session foundation. Rendered by build.mts (SSR) and hydrated
 * in the browser; the interactive section keeps LOCAL state only and never calls SST.
 */
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  ActivityList,
  CharacterLine,
  EndSessionControl,
  FightScoreboard,
  LastMatch,
  OverlayAccessCard,
  OverlayDock,
  RatingSummary,
  RoundStrip,
  SessionActionBar,
  SessionFeedback,
  SessionResults,
  SessionStage,
  StartSessionButton,
  StatusStrip,
  activityFromMatches,
  companionStatus,
  ratingFromCharacter,
  scoreboardFromSession,
  sessionIndicatorStatus,
} from "@/components/fight-session";
import { pickRatingCharacter, type LiveSessionState } from "@/domain/overlay/state";
import { formatDuration, formatWinRate } from "@/domain/format";
import {
  LAST_SYNC,
  NOW,
  OVERLAYS,
  READINESS,
  SESSIONS,
  endedSession,
  liveSession,
  matchRows,
} from "./fixtures";

type Readiness = (typeof READINESS)[keyof typeof READINESS];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid gap-4">
      <h2
        id={`${id}-h`}
        className="m-0 border-b border-line pb-2 font-mono text-xs tracking-[0.16em] text-faint uppercase"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function strip(session: LiveSessionState, readiness: Readiness, key: keyof typeof LAST_SYNC) {
  const status = sessionIndicatorStatus({ session, readiness, tracker: null });
  const duration =
    session.startedAt && session.status !== "none"
      ? formatDuration(
          (session.endedAt ? Date.parse(session.endedAt) : NOW) - Date.parse(session.startedAt),
        )
      : null;
  return (
    <StatusStrip
      status={status}
      duration={status === "ready" || status === "blocked" ? null : duration}
      companion={companionStatus(readiness, LAST_SYNC[key])}
      overlays={{ total: OVERLAYS.length, inObs: 1 }}
      now={NOW}
    />
  );
}

function Stage({ children }: { children: ReactNode }) {
  return <SessionStage ghost="Ryu">{children}</SessionStage>;
}

/** Prepare: identity + readiness + the session CTA (local preview). */
function Prepare({
  readiness,
  readinessKey,
}: {
  readiness: Readiness;
  readinessKey: keyof typeof LAST_SYNC;
}) {
  const t = useTranslations("Dashboard.readiness");
  const tc = useTranslations("FightSession.controls");
  const ts = useTranslations("FightSession.status");
  const blocked = !readiness.canStart;
  const previous = SESSIONS.ended;
  const whyId = `${readinessKey}-why`;
  return (
    <>
      {strip(SESSIONS.none, readiness, readinessKey)}
      <Stage>
        <div>
          <p className="fs-eyebrow m-0 text-cyan">Street Fighter 6</p>
          <h3 className="fs-display m-0 mt-2 text-5xl sm:text-7xl">
            {ts(blocked ? "blocked" : "ready")}
          </h3>
          <CharacterLine
            className="mt-3"
            characterName="Ryu"
            rank={pickRatingCharacter(previous)?.current?.rank ?? null}
            rating={pickRatingCharacter(previous)?.current ?? null}
          />
        </div>
        <div className="grid gap-3">
          {/* Static example: the fixed mobile bar is exercised once, in the interactive section. */}
          <div className="flex flex-wrap items-center gap-3">
            <StartSessionButton onStart={() => undefined} disabled={blocked} describedBy={whyId} />
          </div>
          <p
            id={whyId}
            className={
              blocked
                ? "m-0 max-w-2xl border-l-4 border-warn pl-3 text-sm"
                : "m-0 text-sm text-muted"
            }
          >
            {blocked && readiness.nextStep ? t(`steps.${readiness.nextStep}`) : tc("startHelp")}
          </p>
        </div>
      </Stage>
    </>
  );
}

/** Interactive lifecycle with local state only: start → simulate matches → end (Esc cancels). */
function Lifecycle() {
  const [phase, setPhase] = useState<"prepare" | "live" | "ended">("prepare");
  const [games, setGames] = useState(0);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const locale = useLocale();
  const session =
    phase === "prepare"
      ? SESSIONS.none
      : phase === "ended"
        ? endedSession(games)
        : liveSession(games);
  const items = activityFromMatches(matchRows(phase === "prepare" ? 0 : games));
  const last = items.at(-1) ?? null;
  return (
    <div className="grid gap-4" data-testid="lifecycle">
      {strip(session, READINESS.connected, "connected")}
      <Stage>
        {phase === "prepare" ? (
          <SessionActionBar>
            <StartSessionButton
              onStart={() => {
                setPending(true);
                setTimeout(() => {
                  setPending(false);
                  setPhase("live");
                  setGames(0);
                }, 400);
              }}
              pending={pending}
            />
          </SessionActionBar>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-xs text-faint" lang={locale}>
                {phase === "live" ? "local preview" : "recap"}
              </span>
              {phase === "live" && (
                <SessionActionBar>
                  <EndSessionControl
                    confirming={confirming}
                    onAsk={() => setConfirming(true)}
                    onCancel={() => setConfirming(false)}
                    onConfirm={() => {
                      setConfirming(false);
                      setPhase("ended");
                    }}
                  />
                </SessionActionBar>
              )}
            </div>
            <FightScoreboard
              data={scoreboardFromSession(session)}
              highlight={last && phase === "live" ? (last.result === "win" ? "win" : "loss") : null}
            />
            <RoundStrip results={items.map((i) => i.result)} newestIsNew={phase === "live"} />
            {last ? (
              <LastMatch item={last} isNew={phase === "live"} />
            ) : (
              <ActivityList items={[]} waiting />
            )}
            {phase === "live" && (
              <button
                type="button"
                className="fs-btn fs-btn-sm fs-cut justify-self-start"
                onClick={() => setGames((g) => Math.min(10, g + 1))}
                data-k="simulate"
              >
                + match (local)
              </button>
            )}
            {phase === "ended" && (
              <button
                type="button"
                className="fs-btn fs-btn-sm fs-cut justify-self-start"
                onClick={() => setPhase("prepare")}
                data-k="again"
              >
                ↺
              </button>
            )}
          </>
        )}
      </Stage>
    </div>
  );
}

export function Showcase() {
  const live = SESSIONS.live;
  const pending = SESSIONS.livePending;
  const ended = SESSIONS.ended;
  const items7 = activityFromMatches(matchRows(7));
  const items10 = activityFromMatches(matchRows(10));
  return (
    <main className="mx-auto grid max-w-[1360px] gap-12 px-4 pt-6 pb-32 sm:px-7">
      <header className="grid gap-1">
        <p className="fs-eyebrow m-0 text-cyan">SST · Phase 5.6B1</p>
        <h1 className="fs-display m-0 text-4xl sm:text-6xl">Fight Session foundation</h1>
        <p className="m-0 max-w-3xl text-muted">
          Production components from <code>src/components/fight-session</code> with fictional data
          produced by the real session engine. Local only: nothing here calls SST.
        </p>
      </header>

      <Section id="prepare" title="Prepare · Companion connected">
        <Prepare readiness={READINESS.connected} readinessKey="connected" />
      </Section>

      <Section id="prepare-off" title="Prepare · Companion disconnected">
        <Prepare readiness={READINESS.disconnected} readinessKey="disconnected" />
      </Section>

      <Section id="live" title="Live · recent match registered">
        {strip(live, READINESS.connected, "connected")}
        <Stage>
          <FightScoreboard data={scoreboardFromSession(live)} highlight="win" />
          <RatingSummary rating={ratingFromCharacter(pickRatingCharacter(live), live.status)!} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <LastMatch item={items7.at(-1)!} isNew />
            <RoundStrip results={live.recentResults} newestIsNew titled />
          </div>
        </Stage>
      </Section>

      <Section id="live-pending" title="Live · MR pending · Companion quiet">
        {strip(pending, READINESS.quiet, "quiet")}
        <Stage>
          <FightScoreboard data={scoreboardFromSession(pending)} />
          <RatingSummary
            rating={ratingFromCharacter(pickRatingCharacter(pending), pending.status)!}
          />
          <ActivityList items={items7} limit={4} />
        </Stage>
      </Section>

      <Section id="live-empty" title="Live · empty session">
        {strip(SESSIONS.liveEmpty, READINESS.connected, "connected")}
        <Stage>
          <FightScoreboard data={scoreboardFromSession(SESSIONS.liveEmpty)} />
          <ActivityList items={[]} waiting />
        </Stage>
      </Section>

      <Section id="recap" title="Recap · completed session">
        {strip(ended, READINESS.connected, "connected")}
        <Stage>
          <SessionResults
            data={scoreboardFromSession(ended)}
            rating={ratingFromCharacter(pickRatingCharacter(ended), ended.status)}
          />
          <RoundStrip results={items10.map((i) => i.result)} titled />
          <ActivityList items={items10} />
        </Stage>
      </Section>

      <Section id="recap-norating" title="Recap · missing rating">
        <Stage>
          <SessionResults
            data={scoreboardFromSession(SESSIONS.endedNoRating)}
            rating={ratingFromCharacter(
              pickRatingCharacter(SESSIONS.endedNoRating),
              SESSIONS.endedNoRating.status,
            )}
          />
          <FightScoreboard data={scoreboardFromSession(SESSIONS.endedNoRating)} size="compact" />
        </Stage>
      </Section>

      <Section id="recap-empty" title="Recap · no matches">
        <Stage>
          <FightScoreboard data={scoreboardFromSession(SESSIONS.endedEmpty)} size="compact" />
          <ActivityList items={[]} />
        </Stage>
      </Section>

      <Section id="lp" title="Rating · LP system">
        <RatingSummary
          rating={{
            characterName: "A.K.I.",
            system: "lp",
            initial: 21850,
            current: 21950,
            delta: 100,
            pending: false,
          }}
        />
      </Section>

      <Section id="controls" title="Controls · states">
        <div className="flex flex-wrap items-center gap-4">
          <StartSessionButton onStart={() => undefined} />
          <StartSessionButton onStart={() => undefined} pending />
          <StartSessionButton onStart={() => undefined} disabled />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <EndSessionControl
            confirming={false}
            onAsk={() => undefined}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
          <EndSessionControl
            confirming
            onAsk={() => undefined}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
          <EndSessionControl
            confirming
            pending
            onAsk={() => undefined}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
        </div>
        <SessionFeedback error="No se pudo iniciar la sesión (ejemplo)." slow />
      </Section>

      <Section id="overlays" title="Overlay access">
        <OverlayDock count={OVERLAYS.length} manageHref="#overlays">
          {OVERLAYS.map((o) => (
            <OverlayAccessCard
              key={o.id}
              name={o.name}
              kind={o.kind}
              canvas={o.canvas}
              url={o.url}
              configureHref="#overlays"
              previewHref="#overlays"
              inObs={o.inObs}
              preview={<MiniPreview kind={o.kind} />}
            />
          ))}
        </OverlayDock>
        <OverlayDock count={0} manageHref="#overlays" />
      </Section>

      <Section id="lifecycle" title="Interactive · local state">
        <Lifecycle />
      </Section>
    </main>
  );
}

/** Stand-in for the real `OverlayView` preview (the dashboard passes the real one in B2). */
function MiniPreview({ kind }: { kind: "session" | "rankProgress" }) {
  const locale = useLocale();
  return (
    <div className="flex h-11 items-center gap-2 border-l-[3px] border-cyan bg-[#121834] px-3 font-display text-lg font-extrabold">
      {kind === "session" ? (
        <>
          <span className="text-win">5</span>
          <span className="text-faint">/</span>
          <span className="text-loss">2</span>
          <span className="ml-2 text-base">{formatWinRate(71.4, locale)}</span>
          <span className="ml-auto text-base">1602</span>
        </>
      ) : (
        <span className="text-sm">MASTER · 1602</span>
      )}
    </div>
  );
}
