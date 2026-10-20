/**
 * Rating continuity (Phase 5.5, pure). After a match, the battlelog reports it before the next
 * profile snapshot reports the new rating (Companion: battlelog every 30 s, play.json every 90 s
 * during a session), so for up to ~90 s the engine honestly says "post-match rating not observed
 * yet" (`current: null`, `heldRating` = last confirmed observation). The Session overlay keeps
 * showing that last confirmed observation — rating AND its own session delta, never mixed —
 * instead of "—", but only for a bounded time:
 *
 *   held while   now ≤ pendingSince + RATING_HOLD_MAX_MS   (server timeline)
 *   then         the honest unknown ("—"): a Companion that stopped reporting must not leave an
 *                apparently current rating on screen indefinitely.
 *
 * Identity is preserved by construction: the held observation belongs to the same character,
 * rating system and session (the engine computes it per character, per session).
 */
import type { LiveCharacterProgress, PlayerLiveState } from "./state";

/**
 * 3 min = two active-session profile intervals (90 s) — covers the normal battlelog → profile gap
 * plus one late or failed profile cycle, and no more.
 */
export const RATING_HOLD_MAX_MS = 180_000;

/** Server-timeline instant until which a pending character keeps its held rating; null = none. */
export function heldRatingDeadline(character: LiveCharacterProgress): number | null {
  if (character.current !== null || !character.heldRating) return null;
  const since = Date.parse(character.heldRating.pendingSince);
  return Number.isFinite(since) ? since + RATING_HOLD_MAX_MS : null;
}

/**
 * The live state the Session overlay renders: each character whose post-match rating is pending
 * shows its last confirmed observation while the hold lasts. Same object back when nothing
 * applies (the common case), so non-pending states render exactly as before.
 */
export function withHeldRatings(live: PlayerLiveState, nowMs: number): PlayerLiveState {
  let changed = false;
  const characters = live.session.characters.map((c) => {
    const deadline = heldRatingDeadline(c);
    if (deadline === null || nowMs > deadline || !c.heldRating) return c;
    changed = true;
    return { ...c, current: c.heldRating.current, delta: c.heldRating.delta };
  });
  return changed ? { ...live, session: { ...live.session, characters } } : live;
}

/** Future hold deadlines (for an exact re-render when a hold expires). */
export function heldRatingEdges(live: PlayerLiveState): number[] {
  return live.session.characters.map(heldRatingDeadline).filter((d): d is number => d !== null);
}
