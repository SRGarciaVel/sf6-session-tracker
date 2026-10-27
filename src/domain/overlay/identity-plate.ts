/**
 * M2D — character identity plate (design/phase-m2/character-portraits-audit.md). An SST-native,
 * TYPOGRAPHIC identifier of the character the overlay already shows: never character artwork,
 * no image, no request. Pure: the label is derived only from the identity the live state already
 * carries (ratingParts → pickRatingCharacter), so the plate can never disagree with the name,
 * rank or rating beside it.
 *
 * Label rules (deterministic, one place):
 *   - `random` (Capcom's Random select) ⇒ "?": never a specific fighter;
 *   - otherwise Capcom's display name, letters and digits only (diacritics folded), uppercase:
 *       · every part a single letter ("A.K.I.")   ⇒ joined ("AKI");
 *       · a leading single-letter initial ("M. Bison", "C. Viper") ⇒ dropped ("BIS", "VIP");
 *       · then the first LABEL_LENGTH characters ("Chun-Li" ⇒ "CHU", "Dee Jay" ⇒ "DEE");
 *   - LABEL_OVERRIDES: the only per-character exceptions, where the rule reads badly;
 *   - no usable name ⇒ the key, same rule; nothing usable ⇒ the neutral SST mark.
 * Unknown / future characters need no change: any name Capcom sends yields a label.
 */
import type { CharacterKey } from "@/domain/sf6/types";

export const IDENTITY_PLATE_MODES = ["auto", "off"] as const;
export type IdentityPlateMode = (typeof IDENTITY_PLATE_MODES)[number];

/** Capcom's key for Random select (profile roster). */
export const RANDOM_CHARACTER_KEY = "random";

/** Glyphs on the plate: fixed, so every plate has the same footprint in a theme. */
export const LABEL_LENGTH = 3;

/** Per-character exceptions to the generic rule (keyed by Capcom key), with the reason. */
export const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  // Capcom's name is "Edmond Honda": the rule would read "EDM"; players know him as Honda.
  honda: "HON",
};

export type IdentityPlate =
  | { kind: "character"; key: CharacterKey; label: string; name: string }
  | { kind: "random"; key: CharacterKey; label: "?"; name: string }
  | { kind: "none" };

function abbreviate(text: string): string {
  const parts = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "";
  const initials = parts.every((p) => p.length === 1);
  const kept = !initials && parts.length > 1 && parts[0]!.length === 1 ? parts.slice(1) : parts;
  return kept.join("").slice(0, LABEL_LENGTH);
}

/**
 * The plate for the overlay's character (`ratingParts().characterKey` / its display name).
 * null key ⇒ no known character ⇒ the neutral mark.
 */
export function identityPlateFor(
  characterKey: CharacterKey | null | undefined,
  characterName: string | null | undefined,
): IdentityPlate {
  if (!characterKey) return { kind: "none" };
  const name = characterName?.trim() || characterKey;
  if (characterKey === RANDOM_CHARACTER_KEY) {
    return { kind: "random", key: characterKey, label: "?", name };
  }
  const label = LABEL_OVERRIDES[characterKey] ?? (abbreviate(name) || abbreviate(characterKey));
  return label ? { kind: "character", key: characterKey, label, name } : { kind: "none" };
}

/** A stored / submitted mode, or null when it is not one (callers decide the fallback). */
export function identityPlateModeOf(value: unknown): IdentityPlateMode | null {
  return typeof value === "string" && (IDENTITY_PLATE_MODES as readonly string[]).includes(value)
    ? (value as IdentityPlateMode)
    : null;
}
