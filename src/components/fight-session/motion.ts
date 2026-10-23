/**
 * M2B — which live-state changes are GAMEPLAY EVENTS worth a motion cue. Pure and UI-only: it
 * never counts or derives results (the engine's summary is compared as given), it only decides
 * whether a snapshot brought genuinely new matches.
 *
 * A match "arrives" when, within the same session, the engine's game count grows AND the
 * snapshot carries a stable match id never seen by this view. Everything else is a re-render:
 * a page load or a return to the dashboard (the first snapshot seeds the view), an SSE
 * reconnect or duplicate snapshot (same ids), a reordering, or a session switch (re-seeds).
 */

export interface ArrivalSnapshot {
  sessionId: string | null;
  /** Engine summary values, compared as given (never recomputed here). */
  totalGames: number;
  wins: number;
  losses: number;
  /** Stable match ids of the snapshot's recent matches (server projection), any order. */
  ids: readonly string[];
}

export interface ArrivalTracker {
  sessionId: string | null;
  totalGames: number;
  wins: number;
  losses: number;
  /** Every match id this view has already shown for `sessionId`. */
  seen: ReadonlySet<string>;
}

export interface MatchArrival {
  /** The newly arrived ids (snapshot order); empty when the payload carries no ids. */
  ids: readonly string[];
  /** The engine's win / loss count went up (which scoreboard side reacts). */
  win: boolean;
  loss: boolean;
}

/** The first snapshot a view sees: shown as-is, never an event. */
export function seedArrivals(snapshot: ArrivalSnapshot): ArrivalTracker {
  return {
    sessionId: snapshot.sessionId,
    totalGames: snapshot.totalGames,
    wins: snapshot.wins,
    losses: snapshot.losses,
    seen: new Set(snapshot.ids),
  };
}

export function detectArrival(
  prev: ArrivalTracker,
  next: ArrivalSnapshot,
): { tracker: ArrivalTracker; arrival: MatchArrival | null } {
  if (next.sessionId !== prev.sessionId) return { tracker: seedArrivals(next), arrival: null };
  const seen = new Set(prev.seen);
  const unseen = next.ids.filter((id) => !seen.has(id));
  for (const id of unseen) seen.add(id);
  const tracker = {
    sessionId: next.sessionId,
    totalGames: next.totalGames,
    wins: next.wins,
    losses: next.losses,
    seen,
  };
  const added = next.totalGames - prev.totalGames;
  // No more games than before: reconnect, duplicate, reordering or a correction — not an event.
  if (added <= 0) return { tracker, arrival: null };
  return {
    tracker,
    arrival: {
      // Never more "new" matches than the engine added (the newest of the unseen ones).
      ids: unseen.slice(-added),
      win: next.wins > prev.wins,
      loss: next.losses > prev.losses,
    },
  };
}
