import type { Metadata, Viewport } from "next";
import { BRAND_NAME } from "@/components/brand/names";
import { overlayFontVariables } from "@/components/overlay/fonts";
import "./overlay-root.css";

export const metadata: Metadata = {
  title: `Overlay | ${BRAND_NAME}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  colorScheme: "only light",
};

/** Separate root layout for OBS: transparent, no app chrome, no dashboard CSS. */
export default function OverlayRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={overlayFontVariables}>
      <body>{children}</body>
    </html>
  );
}
