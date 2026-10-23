/**
 * M2B — Fight Session motion triggers. Both hooks adjust state during render (React's "storing
 * information from previous renders" pattern), so the first render — a page load, a return to
 * the dashboard, a hydration — is always the baseline and never an event.
 */
import { useEffect, useState } from "react";
import {
  detectArrival,
  seedArrivals,
  type ArrivalSnapshot,
  type ArrivalTracker,
  type MatchArrival,
  type RatingData,
} from "@/components/fight-session";

/** How long a match stays marked «new» (badge, outline). */
export const FRESH_MATCH_MS = 4_000;

export interface ArrivalEvent extends MatchArrival {
  /** Grows with every arrival: keys the accents so back-to-back events replay, never stack. */
  seq: number;
}

/** The latest genuine match arrival of the live session (see detectArrival), or null. */
export function useMatchArrival(snapshot: ArrivalSnapshot): ArrivalEvent | null {
  const key = [
    snapshot.sessionId,
    snapshot.totalGames,
    snapshot.wins,
    snapshot.losses,
    snapshot.ids.join(","),
  ].join("|");
  const [tracked, setTracked] = useState<{ key: string; tracker: ArrivalTracker; seq: number }>(
    () => ({ key, tracker: seedArrivals(snapshot), seq: 0 }),
  );
  const [event, setEvent] = useState<ArrivalEvent | null>(null);
  if (key !== tracked.key) {
    const { tracker, arrival } = detectArrival(tracked.tracker, snapshot);
    const seq = arrival ? tracked.seq + 1 : tracked.seq;
    setTracked({ key, tracker, seq });
    if (arrival) setEvent({ ...arrival, seq });
    else if (snapshot.sessionId !== tracked.tracker.sessionId) setEvent(null);
  }
  useEffect(() => {
    if (!event) return;
    const id = setTimeout(() => setEvent(null), FRESH_MATCH_MS);
    return () => clearTimeout(id);
  }, [event]);
  return event;
}

export const ratingKey = (r: Pick<RatingData, "characterName" | "system">) =>
  `${r.characterName}-${r.system}`;

/**
 * Per character/system: a counter that grows each time a CONFIRMED rating value replaces a
 * different confirmed value. Pending (held) and unknown ratings never count, and the outcome of
 * a match is never used to guess one: the change is a separate, observed state transition.
 */
export function useConfirmedRatingPulses(ratings: readonly RatingData[]): Record<string, number> {
  const key = ratings.map((r) => `${ratingKey(r)}:${r.current}:${r.pending}`).join("|");
  const seed = () =>
    Object.fromEntries(ratings.map((r) => [ratingKey(r), { value: r.current, pulse: 0 }]));
  const [tracked, setTracked] = useState(() => ({ key, entries: seed() }));
  if (key !== tracked.key) {
    const entries = { ...tracked.entries };
    for (const r of ratings) {
      const k = ratingKey(r);
      const prev = entries[k];
      if (!prev) entries[k] = { value: r.current, pulse: 0 };
      else if (!r.pending && r.current !== null && r.current !== prev.value)
        entries[k] = {
          value: r.current,
          pulse: prev.value === null ? prev.pulse : prev.pulse + 1,
        };
    }
    setTracked({ key, entries });
  }
  return Object.fromEntries(Object.entries(tracked.entries).map(([k, e]) => [k, e.pulse]));
}
