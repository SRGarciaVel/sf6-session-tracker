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
import { useRef, useState, useTransition } from "react";
import {
  CharacterLine,
  EndSessionControl,
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
import { SessionPanel } from "../SessionPanel";

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
  const character = pickRatingCharacter(state.live.session);

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
    <>
      <SessionStage id="session" ghost={character?.characterName} labelledBy="fs-active-title">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-3">
            <p className="fs-eyebrow m-0 text-magenta">{t("live.eyebrow")}</p>
            <h1 id="fs-active-title" className="fs-display m-0 text-4xl sm:text-6xl">
              {t(`status.${status}`)}
            </h1>
            {character && (
              <CharacterLine
                characterName={character.characterName}
                rank={character.current?.rank ?? character.heldRating?.current.rank ?? null}
                rating={character.current ?? character.heldRating?.current ?? null}
              />
            )}
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
      </SessionStage>
      <h2 className="sr-only">{t("live.statsTitle")}</h2>
      <SessionPanel actions={false} />
    </>
  );
}

/** PREPARE when no session is active, otherwise the intermediate ACTIVE view. */
export function FightSessionArea() {
  const { state } = useLiveDashboard();
  return state.live.session.status === "active" ? <ActiveStage /> : <PrepareStage />;
}
