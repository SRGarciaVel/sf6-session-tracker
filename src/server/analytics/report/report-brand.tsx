/**
 * SST brand for the PDF (react-pdf primitives). Draws the SAME vectors as the web BrandMark from
 * the single source of truth (components/brand/geometry.ts): never rasterised, never re-typed.
 */
import { G, Path, Svg, Text, View } from "@react-pdf/renderer";
import {
  ACCENTS,
  BRAND_COLORS,
  LETTERS,
  LOCKUP_LAYOUT,
  SLANT_TRANSFORM,
  VIEWBOX,
  VIEWBOX_ATTR,
} from "@/components/brand/geometry";
import { BRAND_FULL_NAME } from "@/components/brand/names";
import { REPORT_FONTS } from "./fonts";
import { C } from "./report-styles";

/** The monogram (S S T + cyan / magenta slashes) at `width` points; height follows the viewBox. */
export function ReportBrandMark({ width }: { width: number }) {
  const height = (width * VIEWBOX.height) / VIEWBOX.width;
  return (
    <Svg viewBox={VIEWBOX_ATTR} width={width} height={height}>
      <G transform={SLANT_TRANSFORM}>
        <Path fill={BRAND_COLORS.cyan} d={ACCENTS.cyan} />
        <Path fill={BRAND_COLORS.magenta} d={ACCENTS.magenta} />
        <Path fill={BRAND_COLORS.body} d={LETTERS.s1} />
        <Path fill={BRAND_COLORS.body} d={LETTERS.s2} />
        <Path fill={BRAND_COLORS.body} d={LETTERS.t} />
      </G>
    </Svg>
  );
}

/**
 * Official lockup composition (LOCKUP_LAYOUT): monogram · divider · "SESSION / STATS / TRACKER",
 * scaled from the 760 × 124 canvas to `height` points.
 */
export function ReportBrandLockup({ height }: { height: number }) {
  const k = height / LOCKUP_LAYOUT.height;
  const { mark, divider, words } = LOCKUP_LAYOUT;
  const markWidth = (mark.height * k * VIEWBOX.width) / VIEWBOX.height;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", height }}>
      <ReportBrandMark width={markWidth} />
      <View
        style={{
          width: Math.max(0.75, divider.width * k),
          height: divider.height * k,
          backgroundColor: C.lineStrong,
          marginLeft: (divider.x - mark.width) * k,
          marginRight: (words.x - divider.x - divider.width) * k,
        }}
      />
      <View>
        {BRAND_FULL_NAME.split(" ").map((word) => (
          <Text
            key={word}
            style={{
              fontFamily: REPORT_FONTS.display,
              fontWeight: words.fontWeight,
              fontSize: words.fontSize * k,
              letterSpacing: words.letterSpacing * k,
              lineHeight: 1.12,
              color: C.text,
              textTransform: "uppercase",
            }}
          >
            {word}
          </Text>
        ))}
      </View>
    </View>
  );
}
