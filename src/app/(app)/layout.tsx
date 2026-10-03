import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { overlayFontVariables } from "@/components/overlay/fonts";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Meta");
  return {
    title: { default: "SF6 Session Tracker", template: "%s · SF6 Session Tracker" },
    description: t("description"),
  };
}

export const viewport: Viewport = {
  themeColor: "#0a0b0e",
  colorScheme: "dark",
};

export default async function AppRootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${overlayFontVariables} h-full`}>
      <body className="min-h-full">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
