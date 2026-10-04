/**
 * Rating rules (pure). A rating value is only meaningful together with its character, its
 * system (LP / MR) and its phase. These helpers enforce that.
 */
import type { CharacterKey, CharacterRatingProfile, RatingPoint } from "./types";

/** Rating point of a character profile, using the provider-declared system. */
export function ratingPointOf(profile: CharacterRatingProfile): RatingPoint | null {
  const value =
    profile.ratingSystem === "mr"
      ? profile.masterRate
      : profile.ratingSystem === "lp"
        ? profile.leaguePoints
        : null;
  if (profile.ratingSystem === null || value === null || !Number.isFinite(value)) return null;
  return {
    system: profile.ratingSystem,
    value,
    rank: profile.rank,
    rankTier: profile.rankTier,
    phase: profile.phase ?? null,
  };
}

/**
 * Two points can be subtracted only if they are the same system and the same phase.
 * (Character identity is enforced by the caller, which only ever compares within one key.)
 */
export function areComparable(a: RatingPoint, b: RatingPoint): boolean {
  return a.system === b.system && (a.phase ?? null) === (b.phase ?? null);
}

/** current − initial, or null when unknown or not comparable. Never invents a value. */
export function ratingDelta(
  initial: RatingPoint | null,
  current: RatingPoint | null,
): number | null {
  if (!initial || !current || !areComparable(initial, current)) return null;
  return current.value - initial.value;
}

export function ratingPointEquals(a: RatingPoint | null, b: RatingPoint | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.system === b.system &&
    a.value === b.value &&
    (a.rank ?? null) === (b.rank ?? null) &&
    (a.phase ?? null) === (b.phase ?? null)
  );
}

/** Deterministic key from an (English) display name: "A.K.I." → "aki", "M. Bison" → "m-bison". */
export function toCharacterKey(name: string): CharacterKey {
  return name
    .trim()
    .replace(/\./g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .toLowerCase();
}

export { CHARACTER_KEY_PATTERN } from "./types";
