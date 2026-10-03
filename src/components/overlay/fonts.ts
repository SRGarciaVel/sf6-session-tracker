/**
 * Self-hosted fonts (next/font downloads them at build time; no runtime Google requests from
 * OBS). Each exposes a CSS variable; overlays pick one through `var(--ovf-<id>)`.
 */
import {
  Barlow,
  Barlow_Condensed,
  Bebas_Neue,
  Chakra_Petch,
  Inter,
  JetBrains_Mono,
  Oswald,
  Rajdhani,
} from "next/font/google";

// Primary UI + HUD families: condensed display numerals and a matching body face.
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--ovf-barlow-condensed",
  display: "swap",
});
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--ovf-barlow",
  display: "swap",
});
const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--ovf-chakra-petch",
  display: "swap",
});
const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--ovf-rajdhani",
  display: "swap",
});
const oswald = Oswald({ subsets: ["latin"], variable: "--ovf-oswald", display: "swap" });
const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--ovf-bebas-neue",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--ovf-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--ovf-jetbrains-mono",
  display: "swap",
});

/** Put on <html> so every overlay font variable is defined. */
export const overlayFontVariables = [
  barlowCondensed.variable,
  barlow.variable,
  chakraPetch.variable,
  rajdhani.variable,
  oswald.variable,
  bebasNeue.variable,
  inter.variable,
  jetbrainsMono.variable,
].join(" ");
