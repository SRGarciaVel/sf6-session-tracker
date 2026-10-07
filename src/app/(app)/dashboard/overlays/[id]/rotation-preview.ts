/**
 * Builder helpers for automatic presentation (Phase 5.2 rotation, Phase 5.3A modes). Display
 * only: the views the overlay would cycle through now, from data the builder already has (the
 * live state, else the preview sample). No queries; characters with 0 games never appear and
 * the sequence comes from the same domain functions the overlay runs.
 */
import { sampleMultiCharacterState } from "@/domain/overlay/sample-session";
import type { LiveSessionState } from "@/domain/overlay/state";
import {
  buildViews,
  modeCharacters,
  rotationOrder,
  type CharacterRotation,
} from "@/domain/overlay/rotation";

const SAMPLE_SESSION = sampleMultiCharacterState().session;

/** One cycle of views: null = the session view, else the character's displayed name. */
function cycle(
  session: LiveSessionState,
  rotation: Pick<CharacterRotation, "mode" | "order">,
): Array<string | null> {
  const byKey = new Map(session.characters.map((c) => [c.characterKey, c.characterName]));
  const order = rotationOrder(session.characters, rotation.order);
  const characters = modeCharacters(rotation.mode, order, session.activeCharacterKey);
  // "characters" with nobody played is the normal overlay: nothing cycles.
  if (rotation.mode === "characters" && characters.length === 0) return [];
  return buildViews(rotation.mode, characters).map((v) =>
    v.kind === "session" ? null : (byKey.get(v.characterKey) ?? v.characterKey),
  );
}

export function rotationViewSequence(
  live: LiveSessionState,
  rotation: Pick<CharacterRotation, "mode" | "order">,
): { views: Array<string | null>; sample: boolean } {
  const played = live.status === "active" && live.characters.some((c) => c.games > 0);
  return played
    ? { views: cycle(live, rotation), sample: false }
    : { views: cycle(SAMPLE_SESSION, rotation), sample: true };
}
