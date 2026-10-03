import type { Metadata, Viewport } from "next";
import { overlayFontVariables } from "@/components/overlay/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SF6 Session Tracker", template: "%s · SF6 Session Tracker" },
  description: "Automatic Street Fighter 6 session stats for your OBS stream.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0e",
  colorScheme: "dark",
};

export default function AppRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${overlayFontVariables} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
