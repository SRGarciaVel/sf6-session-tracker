/**
 * Builder helpers for character rotation (Phase 5.2). Display only: which characters would
 * rotate, from data the builder already has (the live state, else the preview sample). No
 * queries, and characters with 0 games never appear (same rule as the overlay).
 */
import { sampleMultiCharacterState } from "@/domain/overlay/sample-session";
import type { LiveSessionState } from "@/domain/overlay/state";
import { rotationOrder, type RotationOrder } from "@/domain/overlay/rotation";

const SAMPLE_SESSION = sampleMultiCharacterState().session;

function names(session: LiveSessionState, order: RotationOrder): string[] {
  const byKey = new Map(session.characters.map((c) => [c.characterKey, c.characterName]));
  return rotationOrder(session.characters, order).map((k) => byKey.get(k) ?? k);
}

export function rotationCharacterNames(
  live: LiveSessionState,
  order: RotationOrder,
): { names: string[]; sample: boolean } {
  const fromLive = live.status === "active" ? names(live, order) : [];
  return fromLive.length > 0
    ? { names: fromLive, sample: false }
    : { names: names(SAMPLE_SESSION, order), sample: true };
}
