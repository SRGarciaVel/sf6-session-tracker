/**
 * Creator character rotation & latest-match priority (Phase 5.2, docs/creator-overlays.md).
 *
 * PRESENTATION state only: rotation decides which session character the overlay represents for a
 * while. It never changes wins, losses, streaks, ratings, the session, the authoritative active
 * character or the stored `ratingCharacterKey`, and nothing about it is persisted (no index, no
 * timer state). The browser rendering the overlay owns its timers; the server owns nothing.
 *
 *   creator.characterRotation  strict config (literal sets only — no free-form values)
 *   overlays.characterRotation the entitlement (independent of motionEffects)
 *   rotationOrder              eligible characters (games > 0) in the configured order
 *   syncRotation / advanceRotation / rotationDelayMs
 *                              the pure state machine the React controller runs
 *                              (components/overlay/rotation.tsx)
 */
import { z } from "zod";
import type { CharacterKey } from "@/domain/sf6/types";

export const ROTATION_INTERVALS = [5, 10, 15, 20, 30] as const;
export const PRIORITY_DURATIONS = [10, 15, 20, 30, 60] as const;
export const ROTATION_TRANSITIONS = ["fade", "slide", "instant"] as const;
export const ROTATION_ORDERS = ["recent", "mostPlayed", "alphabetical"] as const;

export type RotationInterval = (typeof ROTATION_INTERVALS)[number];
export type PriorityDuration = (typeof PRIORITY_DURATIONS)[number];
export type RotationTransition = (typeof ROTATION_TRANSITIONS)[number];
export type RotationOrder = (typeof ROTATION_ORDERS)[number];

export const characterRotationSchema = z.strictObject({
  enabled: z.boolean(),
  intervalSeconds: z.literal([...ROTATION_INTERVALS]),
  transition: z.enum(ROTATION_TRANSITIONS),
  prioritizeLatestMatch: z.boolean(),
  prioritySeconds: z.literal([...PRIORITY_DURATIONS]),
  order: z.enum(ROTATION_ORDERS),
});
export type CharacterRotation = z.infer<typeof characterRotationSchema>;

/** Off by default: every existing overlay renders exactly as before. */
export const DEFAULT_CHARACTER_ROTATION: CharacterRotation = {
  enabled: false,
  intervalSeconds: 10,
  transition: "fade",
  prioritizeLatestMatch: true,
  prioritySeconds: 20,
  order: "recent",
};

/**
 * Lenient read of a stored block (old or partially corrupt JSON): each field that doesn't
 * validate falls back to its safe default; a non-object ⇒ undefined (no rotation block).
 * Writes go through the strict schema and reject invalid values.
 */
export function parseCharacterRotation(raw: unknown): CharacterRotation | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const shape = characterRotationSchema.shape;
  const pick = <K extends keyof CharacterRotation>(key: K): CharacterRotation[K] => {
    const parsed = shape[key].safeParse(obj[key]);
    return parsed.success ? (parsed.data as CharacterRotation[K]) : DEFAULT_CHARACTER_ROTATION[key];
  };
  return {
    enabled: pick("enabled"),
    intervalSeconds: pick("intervalSeconds"),
    transition: pick("transition"),
    prioritizeLatestMatch: pick("prioritizeLatestMatch"),
    prioritySeconds: pick("prioritySeconds"),
    order: pick("order"),
  };
}

/* ───────── eligible characters & order ───────── */

/** What ordering needs from a live character (structural: LiveCharacterProgress fits). */
export interface RotationCandidate {
  characterKey: CharacterKey;
  characterName: string;
  games: number;
  /** ISO time of this character's latest counted match in the session (null = not played). */
  lastPlayedAt: string | null;
}

const playedAt = (c: RotationCandidate) => (c.lastPlayedAt ? Date.parse(c.lastPlayedAt) : 0);
const byKey = (a: RotationCandidate, b: RotationCandidate) =>
  a.characterKey < b.characterKey ? -1 : a.characterKey > b.characterKey ? 1 : 0;
const byRecent = (a: RotationCandidate, b: RotationCandidate) => playedAt(b) - playedAt(a);

const COMPARATORS: Record<RotationOrder, (a: RotationCandidate, b: RotationCandidate) => number> = {
  // Latest counted match first (the match time, never a rating snapshot); ties: key.
  recent: (a, b) => byRecent(a, b) || byKey(a, b),
  // Most games first; ties: most recent, then key.
  mostPlayed: (a, b) => b.games - a.games || byRecent(a, b) || byKey(a, b),
  // Displayed name (fixed locale, so every OBS instance agrees); ties: key.
  alphabetical: (a, b) =>
    a.characterName.localeCompare(b.characterName, "en", { sensitivity: "base" }) || byKey(a, b),
};

/**
 * Characters that may rotate, in order: only those actually played in this session
 * (games > 0) — never the rest of the CFN roster or characters known only from a baseline.
 * Deterministic for the same input (total order: every comparator ends on the unique key).
 */
export function rotationOrder(
  characters: readonly RotationCandidate[],
  order: RotationOrder,
): CharacterKey[] {
  return characters
    .filter((c) => c.games > 0)
    .sort(COMPARATORS[order])
    .map((c) => c.characterKey);
}

/** The character after `current` (wrapping). Unknown current ⇒ the first; empty ⇒ null. */
export function nextCharacter(
  order: readonly CharacterKey[],
  current: CharacterKey | null,
): CharacterKey | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.indexOf(current);
  return order[(i + 1) % order.length] ?? null;
}

/**
 * Resume policy after a priority period: continue with the character that FOLLOWS the
 * prioritized one in the current order (Chun-Li → Jamie → Ryu: Jamie prioritized ⇒ Ryu next).
 * A single eligible character resumes on itself (no transition).
 */
export function resumeAfterPriority(
  order: readonly CharacterKey[],
  prioritized: CharacterKey,
): CharacterKey | null {
  return nextCharacter(order, prioritized);
}

/* ───────── state machine ───────── */

/** Authoritative inputs from the live state (plus the presentation config). */
export interface RotationInput {
  sessionId: string | null;
  totalGames: number;
  /** Character of the latest counted match (authoritative). */
  activeCharacterKey: CharacterKey | null;
  order: readonly CharacterKey[];
  prioritizeLatestMatch: boolean;
}

export interface RotationState {
  /** Match-signal baseline: the session and its game count last seen. */
  sessionId: string | null;
  games: number;
  /** Character currently represented (null = nothing eligible). */
  visible: CharacterKey | null;
  /** Character shown because of a new match, until its priority period ends. */
  priority: CharacterKey | null;
  /** Bumps whenever the pending timer must restart (new visible character or new priority). */
  epoch: number;
  /** Bumps whenever `visible` changes to another character (drives the visual transition). */
  shownSeq: number;
}

export function initRotation(input: RotationInput): RotationState {
  return {
    sessionId: input.sessionId,
    games: input.totalGames,
    visible: input.order[0] ?? null,
    priority: null,
    epoch: 0,
    shownSeq: 0,
  };
}

/**
 * A new match per authoritative data: same session (non-null), totalGames grew, and the
 * character of the latest counted match is known and eligible. Several matches arriving in one
 * snapshot (or a late, older match) give ONE signal for the latest counted match's character —
 * the payload doesn't say which character played each intermediate match, so none is invented.
 * First render, a new session, repeated snapshots or a rewind are never a match.
 */
export function detectNewMatch(state: RotationState, input: RotationInput): CharacterKey | null {
  if (input.sessionId === null || input.sessionId !== state.sessionId) return null;
  if (input.totalGames <= state.games) return null;
  const key = input.activeCharacterKey;
  return key !== null && input.order.includes(key) ? key : null;
}

function show(state: RotationState, visible: CharacterKey | null): RotationState {
  return visible === state.visible ? state : { ...state, visible, shownSeq: state.shownSeq + 1 };
}

/**
 * Reconcile the state with a (possibly repeated) snapshot. Returns the SAME object when nothing
 * changed, so the controller can call it on every render without looping or restarting timers.
 *  - new session ⇒ fresh cycle, no priority, the new state is a baseline (not a match);
 *  - new match + priority enabled ⇒ show that character now and (re)start its priority period —
 *    also when it is already visible (the period restarts, no transition) and replacing any
 *    other priority (no queue);
 *  - roster changes ⇒ a visible/prioritized character that is no longer eligible is dropped;
 *    one that still is stays visible (a new character just joins the order).
 */
export function syncRotation(state: RotationState, input: RotationInput): RotationState {
  if (input.sessionId !== state.sessionId) return initRotation(input);
  let next = state;
  const matched = detectNewMatch(state, input);
  if (input.totalGames !== state.games) next = { ...next, games: input.totalGames };
  if (matched !== null && input.prioritizeLatestMatch) {
    next = { ...show(next, matched), priority: matched, epoch: next.epoch + 1 };
  }
  if (next.priority !== null && !input.order.includes(next.priority)) {
    next = { ...next, priority: null, epoch: next.epoch + 1 };
  }
  if (next.visible === null || !input.order.includes(next.visible)) {
    const replacement = input.order[0] ?? null;
    if (replacement !== next.visible) next = { ...show(next, replacement), epoch: next.epoch + 1 };
  }
  return next;
}

/** The pending timer fired: end the priority period (resume) or advance the cycle. */
export function advanceRotation(
  state: RotationState,
  order: readonly CharacterKey[],
): RotationState {
  const target =
    state.priority !== null
      ? resumeAfterPriority(order, state.priority)
      : nextCharacter(order, state.visible);
  return { ...show(state, target), priority: null, epoch: state.epoch + 1 };
}

/**
 * How long until the next step, or null for no timer at all: fewer than two eligible
 * characters never schedules periodic work (a single character just stays visible).
 */
export function rotationDelayMs(
  state: RotationState,
  order: readonly CharacterKey[],
  config: Pick<CharacterRotation, "intervalSeconds" | "prioritySeconds">,
): number | null {
  if (order.length < 2 || state.visible === null) return null;
  return (state.priority !== null ? config.prioritySeconds : config.intervalSeconds) * 1000;
}

/** The transition actually rendered: animations off or reduced motion ⇒ instant. */
export function effectiveTransition(
  transition: RotationTransition,
  opts: { animations: boolean; reducedMotion: boolean },
): RotationTransition {
  return !opts.animations || opts.reducedMotion ? "instant" : transition;
}
