"use client";

/**
 * Presentation rotation controller for the overlay renderer (Phase 5.2 characters, Phase 5.3A
 * views). The decisions live in the pure state machine (domain/overlay/rotation.ts); this hook
 * only runs it:
 *
 *  - every render reconciles the state with the live snapshot (adjusting state during render,
 *    like useOverlayUpdate): repeated snapshots, SSE reconnects, resizes, locale/theme edits
 *    return the same state, so nothing restarts;
 *  - at most ONE pending setTimeout (interval or priority), keyed on the state's epoch and the
 *    delay: replaced when the visible view or the priority changes, cleared on unmount, when
 *    rotation turns off, or with fewer than two DISTINCT views (no periodic work).
 *
 * Presentation only: nothing is persisted, sent to the server or written to the config.
 */
import { useEffect, useRef, useState } from "react";
import {
  advanceRotation,
  initRotation,
  rotationDelayMs,
  rotationOrder,
  syncRotation,
  type CharacterRotation,
  type PresentationView,
  type RotationInput,
  type RotationState,
} from "@/domain/overlay/rotation";
import { sessionIdentity, type LiveSessionState } from "@/domain/overlay/state";

export interface RotationView {
  /** View the overlay represents right now (presentation only). */
  view: PresentationView;
  /** Increments on every change of view (0 = initial: no transition). */
  seq: number;
  /** True while a new match's character is being prioritized. */
  priority: boolean;
}

/** Rotation runs only for an active session with the rotation block enabled. */
export function isRotationActive(
  session: Pick<LiveSessionState, "status">,
  rotation: CharacterRotation | undefined,
): rotation is CharacterRotation {
  return rotation?.enabled === true && session.status === "active";
}

export function useCharacterRotation(
  session: LiveSessionState,
  rotation: CharacterRotation | undefined,
): RotationView | null {
  const active = isRotationActive(session, rotation);
  const input: RotationInput = {
    // The public (OBS) payload has no sessionId: identify the session by what it does carry.
    sessionId: sessionIdentity(session),
    totalGames: session.totalGames,
    activeCharacterKey: session.activeCharacterKey,
    order: active ? rotationOrder(session.characters, rotation.order) : [],
    prioritizeLatestMatch: active && rotation.prioritizeLatestMatch,
    mode: active ? rotation.mode : "characters",
  };

  const [state, setState] = useState<RotationState>(() => initRotation(input));
  // The match-signal baseline is tracked even while rotation is off, so turning it on (or a
  // config edit) never looks like a new match.
  const synced = syncRotation(state, input);
  if (synced !== state) setState(synced);

  // The timer callback reads the latest input (the order may change after a match, the active
  // character too) without being rescheduled by it: only the epoch and the delay restart it.
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });

  const delay = active ? rotationDelayMs(synced, input, rotation) : null;
  const epoch = synced.epoch;
  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => setState((s) => advanceRotation(s, inputRef.current)), delay);
    return () => clearTimeout(id);
  }, [epoch, delay]);

  if (!active || synced.visible === null) return null;
  return { view: synced.visible, seq: synced.shownSeq, priority: synced.priority !== null };
}
