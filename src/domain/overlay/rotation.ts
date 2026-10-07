/**
 * Creator character rotation & latest-match priority (Phase 5.2) evolved into presentation modes
 * (Phase 5.3A, docs/creator-overlays.md): the overlay cycles through VIEWS — the session view
 * (global statistics) and character views (one character's own statistics and rating).
 *
 *   mode "characters"      character views only (Phase 5.2, the default for old configs)
 *   mode "session-active"  session ↔ the active character (character of the latest match)
 *   mode "session-all"     session before each played character
 *
 * PRESENTATION state only: rotation decides which view the overlay represents for a
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
export const ROTATION_TRANSITIONS = ["fade", "slide", "wipe", "instant"] as const;
export const ROTATION_ORDERS = ["recent", "mostPlayed", "alphabetical"] as const;
export const PRESENTATION_MODES = ["characters", "session-active", "session-all"] as const;
/** Side the NEW view enters from (slide / wipe only). "left" is the Phase 5.2 slide. */
export const TRANSITION_DIRECTIONS = ["left", "right", "up", "down"] as const;

export type RotationInterval = (typeof ROTATION_INTERVALS)[number];
export type PriorityDuration = (typeof PRIORITY_DURATIONS)[number];
export type RotationTransition = (typeof ROTATION_TRANSITIONS)[number];
export type RotationOrder = (typeof ROTATION_ORDERS)[number];
export type PresentationMode = (typeof PRESENTATION_MODES)[number];
export type TransitionDirection = (typeof TRANSITION_DIRECTIONS)[number];

/** Transitions that move along a direction (fade and instant have none). */
export function transitionHasDirection(t: RotationTransition): boolean {
  return t === "slide" || t === "wipe";
}

export const characterRotationSchema = z.strictObject({
  enabled: z.boolean(),
  intervalSeconds: z.literal([...ROTATION_INTERVALS]),
  transition: z.enum(ROTATION_TRANSITIONS),
  prioritizeLatestMatch: z.boolean(),
  prioritySeconds: z.literal([...PRIORITY_DURATIONS]),
  order: z.enum(ROTATION_ORDERS),
  // Phase 5.3A. Missing on blocks written before it ⇒ the Phase 5.2 behaviour (also on writes,
  // so an older builder can still save); invalid values are rejected.
  mode: z.enum(PRESENTATION_MODES).default("characters"),
  direction: z.enum(TRANSITION_DIRECTIONS).default("left"),
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
  mode: "characters",
  direction: "left",
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
    mode: pick("mode"),
    direction: pick("direction"),
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

/* ───────── presentation views ───────── */

/**
 * What the overlay represents: the session (global statistics) or one character (its own
 * statistics and rating). Explicitly discriminated — the session view is never a fake key.
 */
export type PresentationView =
  { kind: "session" } | { kind: "character"; characterKey: CharacterKey };

export const SESSION_VIEW: PresentationView = { kind: "session" };
export const characterView = (characterKey: CharacterKey): PresentationView => ({
  kind: "character",
  characterKey,
});

/** Stable identity of a view (render keys, motion summaries) — never serialized JSON. */
export function viewKey(view: PresentationView): string {
  return view.kind === "session" ? "session" : `character:${view.characterKey}`;
}

export function sameView(a: PresentationView | null, b: PresentationView | null): boolean {
  return a === b || (a !== null && b !== null && viewKey(a) === viewKey(b));
}

/**
 * Characters that get a view in this mode, in order. "session-active" has at most one: the
 * character of the latest counted match (authoritative `activeCharacterKey`; it is NOT the
 * character currently selected in the game, which SST doesn't know), else the first eligible.
 */
export function modeCharacters(
  mode: PresentationMode,
  order: readonly CharacterKey[],
  activeCharacterKey: CharacterKey | null,
): CharacterKey[] {
  if (mode !== "session-active") return [...order];
  if (activeCharacterKey !== null && order.includes(activeCharacterKey))
    return [activeCharacterKey];
  return order.slice(0, 1);
}

/**
 * The cycle a mode produces (docs/tests; the state machine navigates it without a flat index
 * because "session-all" repeats the session view):
 *   characters      C1 → C2 → C3
 *   session-active  S → A
 *   session-all     S → C1 → S → C2 → S → C3
 * No played characters: characters ⇒ [] (the normal overlay), mixed modes ⇒ [S].
 */
export function buildViews(
  mode: PresentationMode,
  characters: readonly CharacterKey[],
): PresentationView[] {
  if (mode === "characters") return characters.map(characterView);
  if (characters.length === 0) return [SESSION_VIEW];
  if (mode === "session-active") return [SESSION_VIEW, characterView(characters[0] ?? "")];
  return characters.flatMap((k) => [SESSION_VIEW, characterView(k)]);
}

/** Number of DIFFERENT views (session + one character = 2, so it rotates). */
export function distinctViewCount(mode: PresentationMode, characters: readonly CharacterKey[]) {
  return mode === "characters" ? characters.length : 1 + characters.length;
}

export function isViewValid(
  view: PresentationView,
  mode: PresentationMode,
  characters: readonly CharacterKey[],
): boolean {
  return view.kind === "session" ? mode !== "characters" : characters.includes(view.characterKey);
}

/** First view of a fresh cycle (also the deterministic fallback). */
export function initialView(
  mode: PresentationMode,
  characters: readonly CharacterKey[],
): PresentationView | null {
  if (mode !== "characters") return SESSION_VIEW;
  const first = characters[0];
  return first === undefined ? null : characterView(first);
}

/**
 * The view after `current`. `lastCharacter` is the cycle's cursor (the last character view
 * shown), needed because the session view repeats in "session-all".
 */
export function nextView(
  mode: PresentationMode,
  characters: readonly CharacterKey[],
  current: PresentationView | null,
  lastCharacter: CharacterKey | null,
): PresentationView | null {
  if (mode === "characters") {
    const from = current?.kind === "character" ? current.characterKey : lastCharacter;
    const k = nextCharacter(characters, from);
    return k === null ? null : characterView(k);
  }
  if (characters.length === 0) return SESSION_VIEW;
  if (current?.kind === "character") return SESSION_VIEW;
  const k = mode === "session-active" ? characters[0] : nextCharacter(characters, lastCharacter);
  return k === undefined || k === null ? SESSION_VIEW : characterView(k);
}

/* ───────── state machine ───────── */

/** Authoritative inputs from the live state (plus the presentation config). */
export interface RotationInput {
  sessionId: string | null;
  totalGames: number;
  /** Character of the latest counted match (authoritative). */
  activeCharacterKey: CharacterKey | null;
  /** Eligible characters (games > 0) in the configured order. */
  order: readonly CharacterKey[];
  prioritizeLatestMatch: boolean;
  /** Presentation mode (default: Phase 5.2 "characters"). */
  mode?: PresentationMode;
}

export interface RotationState {
  /**
   * Match-signal baseline: the session and the HIGHEST game count seen in it. Monotonic within
   * a session (a stale snapshot never lowers it), reset only when the session changes.
   */
  sessionId: string | null;
  games: number;
  /** View currently represented (null = nothing to show: "characters" with no played one). */
  visible: PresentationView | null;
  /** Cursor of the cycle: the last character view shown. */
  lastCharacter: CharacterKey | null;
  /** Character whose view is shown because of a new match, until its priority period ends. */
  priority: CharacterKey | null;
  /** Bumps whenever the pending timer must restart (new visible view or new priority). */
  epoch: number;
  /** Bumps whenever `visible` changes to another view (drives the visual transition). */
  shownSeq: number;
}

const modeOf = (input: Pick<RotationInput, "mode">): PresentationMode => input.mode ?? "characters";
const charactersOf = (input: RotationInput) =>
  modeCharacters(modeOf(input), input.order, input.activeCharacterKey);

export function initRotation(input: RotationInput): RotationState {
  const visible = initialView(modeOf(input), charactersOf(input));
  return {
    sessionId: input.sessionId,
    games: input.totalGames,
    visible,
    lastCharacter: visible?.kind === "character" ? visible.characterKey : null,
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
 * First render, a new session, repeated snapshots or a stale (older) snapshot are never a
 * match — and because the baseline is monotonic, neither is the current snapshot arriving again
 * after a stale one.
 */
export function detectNewMatch(state: RotationState, input: RotationInput): CharacterKey | null {
  if (input.sessionId === null || input.sessionId !== state.sessionId) return null;
  if (input.totalGames <= state.games) return null;
  const key = input.activeCharacterKey;
  return key !== null && input.order.includes(key) ? key : null;
}

function show(state: RotationState, visible: PresentationView | null): RotationState {
  const lastCharacter = visible?.kind === "character" ? visible.characterKey : state.lastCharacter;
  if (sameView(visible, state.visible)) {
    return lastCharacter === state.lastCharacter ? state : { ...state, lastCharacter };
  }
  return { ...state, visible, lastCharacter, shownSeq: state.shownSeq + 1 };
}

/**
 * Reconcile the state with a (possibly repeated) snapshot. Returns the SAME object when nothing
 * changed, so the controller can call it on every render without looping or restarting timers.
 *  - new session ⇒ fresh cycle, no priority, the new state is a baseline (not a match);
 *  - stale snapshot (fewer games in the same session) ⇒ no change at all (monotonic baseline);
 *  - new match + priority enabled ⇒ show that character's view now and (re)start its priority
 *    period — also when it is already visible (the period restarts, no transition) and
 *    replacing any other priority (no queue);
 *  - roster / active-character changes ⇒ a visible view that is no longer valid falls back to
 *    the mode's first view; a still valid one stays (new characters just join the cycle).
 */
export function syncRotation(state: RotationState, input: RotationInput): RotationState {
  if (input.sessionId !== state.sessionId) return initRotation(input);
  // Stale snapshot (fewer games than already seen in this session): ignored entirely. The
  // baseline is not lowered (so the current snapshot arriving again is not a "new" match) and
  // its possibly outdated roster can't cancel a priority or replace the visible view.
  if (input.totalGames < state.games) return state;
  const mode = modeOf(input);
  const characters = charactersOf(input);
  let next = state;
  const matched = detectNewMatch(state, input);
  if (input.totalGames > state.games) next = { ...next, games: input.totalGames };
  if (matched !== null && input.prioritizeLatestMatch) {
    next = { ...show(next, characterView(matched)), priority: matched, epoch: next.epoch + 1 };
  }
  if (next.priority !== null && !characters.includes(next.priority)) {
    next = { ...next, priority: null, epoch: next.epoch + 1 };
  }
  if (next.visible === null || !isViewValid(next.visible, mode, characters)) {
    const fallback = initialView(mode, characters);
    if (!sameView(fallback, next.visible))
      next = { ...show(next, fallback), epoch: next.epoch + 1 };
  }
  return next;
}

/**
 * The pending timer fired: end the priority period (resume) or advance the cycle. Resuming is
 * advancing from the prioritized view: in "characters" the character after it; in mixed modes
 * the session view, then (session-all) the character after it.
 */
export function advanceRotation(state: RotationState, input: RotationInput): RotationState {
  const target = nextView(modeOf(input), charactersOf(input), state.visible, state.lastCharacter);
  return { ...show(state, target), priority: null, epoch: state.epoch + 1 };
}

/**
 * How long until the next step, or null for no timer at all: fewer than two DISTINCT views
 * never schedules periodic work (one character in "characters", or a session with no played
 * character). Session + one character is two views, so it rotates.
 */
export function rotationDelayMs(
  state: RotationState,
  input: RotationInput,
  config: Pick<CharacterRotation, "intervalSeconds" | "prioritySeconds">,
): number | null {
  if (state.visible === null) return null;
  if (distinctViewCount(modeOf(input), charactersOf(input)) < 2) return null;
  return (state.priority !== null ? config.prioritySeconds : config.intervalSeconds) * 1000;
}

/** The transition actually rendered: animations off or reduced motion ⇒ instant. */
export function effectiveTransition(
  transition: RotationTransition,
  opts: { animations: boolean; reducedMotion: boolean },
): RotationTransition {
  return !opts.animations || opts.reducedMotion ? "instant" : transition;
}
