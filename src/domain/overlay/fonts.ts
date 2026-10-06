/** Bundled overlay fonts (self-hosted via next/font; no uploads or external URLs). */
export const OVERLAY_FONTS = {
  "barlow-condensed": "Barlow Condensed",
  barlow: "Barlow",
  "chakra-petch": "Chakra Petch",
  rajdhani: "Rajdhani",
  oswald: "Oswald",
  "bebas-neue": "Bebas Neue",
  inter: "Inter",
  "jetbrains-mono": "JetBrains Mono",
} as const;
export type OverlayFontId = keyof typeof OVERLAY_FONTS;
export const FONT_IDS = Object.keys(OVERLAY_FONTS) as [OverlayFontId, ...OverlayFontId[]];
