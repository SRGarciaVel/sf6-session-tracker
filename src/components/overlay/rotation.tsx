"use client";

/**
 * Character rotation controller for the overlay renderer (Phase 5.2). The decisions live in the
 * pure state machine (domain/overlay/rotation.ts); this hook only runs it:
 *
 *  - every render reconciles the state with the live snapshot (adjusting state during render,
 *    like useOverlayUpdate): repeated snapshots, SSE reconnects, resizes, locale/theme edits
 *    return the same state, so nothing restarts;
 *  - at most ONE pending setTimeout (interval or priority), keyed on the state's epoch and the
 *    delay: replaced when the visible character or the priority changes, cleared on unmount,
 *    when rotation turns off, or when fewer than two characters are eligible (no periodic work).
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
  type RotationInput,
  type RotationState,
} from "@/domain/overlay/rotation";
import type { LiveSessionState } from "@/domain/overlay/state";
import type { CharacterKey } from "@/domain/sf6/types";

export interface RotationView {
  /** Character the overlay represents right now (presentation only). */
  characterKey: CharacterKey;
  /** Increments on every change of character (0 = initial: no transition). */
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
  const order = active ? rotationOrder(session.characters, rotation.order) : [];
  const input: RotationInput = {
    sessionId: session.sessionId,
    totalGames: session.totalGames,
    activeCharacterKey: session.activeCharacterKey,
    order,
    prioritizeLatestMatch: active && rotation.prioritizeLatestMatch,
  };

  const [state, setState] = useState<RotationState>(() => initRotation(input));
  // The match-signal baseline is tracked even while rotation is off, so turning it on (or a
  // config edit) never looks like a new match.
  const synced = syncRotation(state, input);
  if (synced !== state) setState(synced);

  // The timer callback reads the latest order (it may reorder after a match) without being
  // rescheduled by it: only the epoch and the delay restart the timer.
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  });

  const delay = active ? rotationDelayMs(synced, order, rotation) : null;
  const epoch = synced.epoch;
  useEffect(() => {
    if (delay === null) return;
    const id = setTimeout(() => setState((s) => advanceRotation(s, orderRef.current)), delay);
    return () => clearTimeout(id);
  }, [epoch, delay]);

  if (!active || synced.visible === null) return null;
  return { characterKey: synced.visible, seq: synced.shownSeq, priority: synced.priority !== null };
}
