/**
 * Message catalogs. Every locale is merged over the English catalog, so a missing key renders the
 * English text instead of a raw key (tests also enforce identical key sets).
 */
import en from "./messages/en.json";
import es from "./messages/es.json";
import { FALLBACK_LOCALE, mergeMessages, type Locale, type Messages } from "./locale";
import { getOverlayMessages } from "./overlay-messages";

const APP_CATALOGS: Record<Locale, Messages> = { en, es };

export function getAppMessages(locale: Locale): Messages {
  const app =
    locale === FALLBACK_LOCALE
      ? APP_CATALOGS[locale]
      : mergeMessages(APP_CATALOGS[FALLBACK_LOCALE], APP_CATALOGS[locale]);
  return { ...app, ...getOverlayMessages(locale) };
}

export const RAW_APP_CATALOGS = APP_CATALOGS;
