/** Same tree on the server (build.mts) and in the browser (entry.tsx): hydration is real. */
import { NextIntlClientProvider } from "next-intl";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { Showcase } from "./Showcase";

export type ShowcaseLocale = "es" | "en";

export function Root({ locale }: { locale: ShowcaseLocale }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
      <Showcase />
    </NextIntlClientProvider>
  );
}
