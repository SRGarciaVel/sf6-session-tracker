/**
 * Overlay-only catalogs. Kept separate and tiny so the OBS overlay and the dashboard previews can
 * bundle every overlay language client-side and switch instantly when the overlay config changes.
 */
import en from "./messages/overlay.en.json";
import es from "./messages/overlay.es.json";
import { FALLBACK_LOCALE, mergeMessages, type Locale, type Messages } from "./locale";

export const RAW_OVERLAY_CATALOGS: Record<Locale, Messages> = { en, es };

const merged: Partial<Record<Locale, Messages>> = {};

export function getOverlayMessages(locale: Locale): Messages {
  merged[locale] ??=
    locale === FALLBACK_LOCALE
      ? RAW_OVERLAY_CATALOGS[locale]
      : mergeMessages(RAW_OVERLAY_CATALOGS[FALLBACK_LOCALE], RAW_OVERLAY_CATALOGS[locale]);
  return merged[locale];
}
