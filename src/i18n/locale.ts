/**
 * Locale rules (pure, shared by server, client and tests).
 *
 * Resolution order: explicit account preference → explicit cookie preference → default (es).
 * There is intentionally no Accept-Language detection, so an explicit choice is never overridden.
 */

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";
/** Fallback used for missing message keys. */
export const FALLBACK_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function resolveLocale(input: {
  userLocale?: string | null;
  cookieLocale?: string | null;
}): Locale {
  if (isLocale(input.userLocale)) return input.userLocale;
  if (isLocale(input.cookieLocale)) return input.cookieLocale;
  return DEFAULT_LOCALE;
}

export type Messages = { [key: string]: string | Messages };

/** Deep merge: keys missing in `override` fall back to `base`. */
export function mergeMessages(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = base[key];
    out[key] =
      typeof value === "object" && typeof baseValue === "object"
        ? mergeMessages(baseValue, value)
        : value;
  }
  return out;
}
