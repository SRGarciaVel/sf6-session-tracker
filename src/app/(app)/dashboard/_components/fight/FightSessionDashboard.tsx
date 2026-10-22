"use client";

/**
 * Phase 5.6B2 — Fight Session dashboard (experimental, behind the server allowlist in
 * server/features/fight-session.ts). PREPARE is the new experience; ACTIVE is an intermediate
 * state: Fight Session status + end control above the classic statistics panel.
 *
 * Everything reads the existing LiveDashboardProvider (its single SSE stream) and calls the
 * existing server actions unchanged: no client-side session logic, no extra polling.
 */
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ActivityList,
  CharacterLine,
  EndSessionControl,
  FightScoreboard,
  LastMatch,
  RatingSummary,
  RoundStrip,
  SessionActionBar,
  SessionFeedback,
  SessionResults,
  SessionStage,
  StartSessionButton,
  StatusStrip,
  companionStatus,
  ratingFromCharacter,
  scoreboardFromSession,
  sessionIndicatorStatus,
  type SessionIndicatorStatus,
} from "@/components/fight-session";
import { formatDuration } from "@/domain/format";
import { pickRatingCharacter } from "@/domain/overlay/state";
import { useSlowFlag } from "@/lib/use-slow-flag";
import { endSessionAction, startSessionAction } from "../../actions";
import { useLiveDashboard, useNow } from "../LiveDashboard";
import { useCompanionReadiness } from "../Readiness";

/** Dashboard status: an ended session is "prepare another" here (the recap has its own page). */
function useDashboardStatus(): SessionIndicatorStatus {
  const { state } = useLiveDashboard();
  const readiness = useCompanionReadiness();
  const session = state.live.session;
  const status = sessionIndicatorStatus({ session, readiness, tracker: state.tracker });
  if (status !== "ended") return status;
  return readiness && !readiness.canStart ? "blocked" : "ready";
}

export function FightStatusStrip({ overlayCount }: { overlayCount: number }) {
  const t = useTranslations("FightSession.prepare");
  const { state, stream } = useLiveDashboard();
  const readiness = useCompanionReadiness();
  const status = useDashboardStatus();
  const now = useNow(15_000);
  const s = state.live.session;
  const duration =
    s.status === "active" && s.startedAt && now !== null
      ? formatDuration(now - Date.parse(s.startedAt))
      : null;
  return (
    <StatusStrip
      status={status}
      duration={duration}
      companion={companionStatus(readiness, state.companion.matchesObservedAt)}
      overlays={{ total: overlayCount, inObs: state.overlayConnections }}
      now={now}
      realtime={stream === "open" ? "open" : stream === "fallback" ? "reconnecting" : null}
      trailing={
        <a href="#overlays" className="fs-btn fs-btn-sm fs-cut hud:hidden">
          {t("overlaysJump")} <span aria-hidden>↓</span>
        </a>
      }
    />
  );
}

function PrepareStage() {
  const t = useTranslations("FightSession");
  const tr = useTranslations("Dashboard.readiness");
  const { state } = useLiveDashboard();
  const readiness = useCompanionReadiness();
  const status = useDashboardStatus();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const slow = useSlowFlag(pending);

  const s = state.live.session;
  const character = pickRatingCharacter(s);
  const blocked = status === "blocked";

  const start = () => {
    // One request at a time, even for clicks landing before the pending state renders.
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const res = await startSessionAction();
        if (!res.ok) setError(res.error);
      } finally {
        inFlight.current = false;
      }
    });
  };

  return (
    <SessionStage id="session" ghost={character?.characterName} labelledBy="fs-prepare-title">
      <div className="grid gap-3">
        <p className="fs-eyebrow m-0 text-cyan">{t("prepare.eyebrow")}</p>
        <h1 id="fs-prepare-title" className="fs-display m-0 text-5xl sm:text-7xl">
          {t(`status.${status}`)}
        </h1>
        {character ? (
          <CharacterLine
            characterName={character.characterName}
            rank={character.current?.rank ?? null}
            rating={character.current}
          />
        ) : (
          <p className="m-0 text-muted">{t("prepare.noCharacter")}</p>
        )}
      </div>

      <div className="grid gap-3">
        {blocked && readiness?.nextStep && (
          <p
            id="fs-start-why"
            className="m-0 max-w-2xl border-l-4 border-warn bg-warn/8 px-3 py-2 text-sm"
          >
            {tr(`steps.${readiness.nextStep}`)}{" "}
            <a
              href="#companion"
              className="font-semibold text-cyan underline-offset-2 hover:underline"
            >
              {tr("goToCompanion")}
            </a>
          </p>
        )}
        <SessionActionBar>
          <StartSessionButton
            onStart={start}
            pending={pending}
            disabled={blocked}
            describedBy={blocked && readiness?.nextStep ? "fs-start-why" : "fs-start-tracked"}
          />
        </SessionActionBar>
        <p id="fs-start-tracked" className="m-0 max-w-2xl text-sm text-muted">
          {t("prepare.tracked")}
        </p>
        <SessionFeedback error={error} slow={slow} />
      </div>

      <div className="grid gap-3">
        <p className="fs-eyebrow m-0">{t("prepare.lastSession")}</p>
        {s.status === "ended" && s.sessionId ? (
          <>
            <SessionResults
              data={scoreboardFromSession(s)}
              rating={ratingFromCharacter(character, s.status)}
            />
            <a
              href={`/dashboard/sessions/${s.sessionId}`}
              className="fs-btn fs-btn-sm fs-cut justify-self-start"
            >
              {t("prepare.viewRecap")} <span aria-hidden>→</span>
            </a>
          </>
        ) : (
          <p className="m-0 text-sm text-muted">{t("prepare.firstSession")}</p>
        )}
      </div>
    </SessionStage>
  );
}

/**
 * Briefly marks the newest match as "new" when it arrives through the live state (never on the
 * first render: a page load is not an event). Feedback only: the data itself is already shown.
 */
function useFreshMatchId(latestId: string | null): string | null {
  // Adjusted during render (React's "storing information from previous renders" pattern).
  const [previous, setPrevious] = useState(latestId);
  const [fresh, setFresh] = useState<string | null>(null);
  if (latestId !== previous) {
    setPrevious(latestId);
    setFresh(latestId);
  }
  useEffect(() => {
    if (!fresh) return;
    const id = setTimeout(() => setFresh(null), 4_000);
    return () => clearTimeout(id);
  }, [fresh]);
  return fresh;
}

function ActiveStage() {
  const t = useTranslations("FightSession");
  const { state } = useLiveDashboard();
  const status = useDashboardStatus();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const slow = useSlowFlag(pending);

  const s = state.live.session;
  const active = pickRatingCharacter(s);
  // Ratings belong to characters: the active one first, then the other characters played.
  const played = s.characters.filter((c) => c.games > 0 && c.characterKey !== active?.characterKey);
  const ratings = [active, ...played.slice(0, 2)]
    .map((c) => ratingFromCharacter(c, s.status))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // Recent matches: the server projection (same counted rows as the scoreboard) when present;
  // older payloads only carry the result letters.
  const recent = state.recentMatches;
  const latest = recent?.at(-1) ?? null;
  const freshId = useFreshMatchId(latest?.id ?? null);
  const results = recent ? recent.map((m) => m.result) : s.recentResults;
  const firstNumber = recent?.[0]?.n ?? s.totalGames - s.recentResults.length + 1;

  const end = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const res = await endSessionAction();
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setConfirming(false);
        // Same post-session destination as the classic dashboard (the saved recap).
        if (res.data.sessionId) router.push(`/dashboard/sessions/${res.data.sessionId}?ended=1`);
      } finally {
        inFlight.current = false;
      }
    });
  };

  return (
    <SessionStage id="session" ghost={active?.characterName} labelledBy="fs-active-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="fs-eyebrow m-0 text-magenta">{t("live.eyebrow")}</p>
          <h1 id="fs-active-title" className="fs-display m-0 text-4xl sm:text-5xl">
            {t(`status.${status}`)}
          </h1>
        </div>
        <EndSessionControl
          confirming={confirming}
          pending={pending}
          onAsk={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onConfirm={end}
        />
      </div>
      <SessionFeedback error={error} slow={slow} />

      <FightScoreboard
        data={scoreboardFromSession(s)}
        highlight={
          freshId && latest
            ? latest.result === "win"
              ? "win"
              : latest.result === "loss"
                ? "loss"
                : null
            : null
        }
      />

      {ratings.length > 0 ? (
        <div className="grid gap-3">
          {ratings.map((r) => (
            <RatingSummary key={`${r.characterName}-${r.system}`} rating={r} />
          ))}
        </div>
      ) : (
        active && <CharacterLine characterName={active.characterName} rank={null} rating={null} />
      )}

      {s.totalGames === 0 ? (
        <ActivityList items={[]} waiting />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {latest ? (
            <LastMatch item={latest} isNew={freshId === latest.id} />
          ) : (
            <p className="m-0 text-sm text-muted">{t("live.lastMatchUnavailable")}</p>
          )}
          <RoundStrip
            results={results}
            firstNumber={firstNumber}
            newestIsNew={freshId !== null}
            titled
          />
        </div>
      )}
    </SessionStage>
  );
}

/** PREPARE when no session is active, otherwise the LIVE view. */
export function FightSessionArea() {
  const { state } = useLiveDashboard();
  return state.live.session.status === "active" ? <ActiveStage /> : <PrepareStage />;
}
