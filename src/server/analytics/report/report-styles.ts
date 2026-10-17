/**
 * PDF-only design system (react-pdf StyleSheet). The SAME SST palette as the dashboard
 * (globals.css) and the brand geometry, as explicit values: the PDF never depends on Tailwind,
 * CSS variables or the DOM. Units are PDF points (A4 = 595.28 × 841.89 pt).
 */
import { StyleSheet } from "@react-pdf/renderer";
import { BRAND_COLORS } from "@/components/brand/geometry";
import { REPORT_FONTS } from "./fonts";

export const C = {
  bg: BRAND_COLORS.ink, // #05070f
  surface: "#0c1021",
  raised: "#11172d",
  line: "#1d2544",
  lineStrong: "#2d3863",
  text: BRAND_COLORS.body, // #eef1fb
  muted: "#97a1c6",
  faint: "#6b76a3",
  cyan: BRAND_COLORS.cyan, // #2fe0ff
  blue: "#3b6cff",
  magenta: BRAND_COLORS.magenta, // #ff2e93
  win: "#29f0a8",
  loss: "#ff3b72",
} as const;

/** Page margins (pt). The header / footer live inside them. */
export const PAGE = { padX: 44, padTop: 70, padBottom: 64 } as const;

const display = REPORT_FONTS.display;
const body = REPORT_FONTS.body;
const mono = REPORT_FONTS.mono;

export const S = StyleSheet.create({
  page: {
    backgroundColor: C.bg,
    color: C.text,
    fontFamily: body,
    fontWeight: 400,
    fontSize: 9.5,
    lineHeight: 1.4,
    paddingHorizontal: PAGE.padX,
    paddingTop: PAGE.padTop,
    paddingBottom: PAGE.padBottom,
  },

  /* ── Page master ── */
  accentLine: { position: "absolute", top: 0, left: 0, right: 0, height: 3, flexDirection: "row" },
  header: {
    position: "absolute",
    top: 22,
    left: PAGE.padX,
    right: PAGE.padX,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 0.75,
    borderBottomColor: C.line,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", flexGrow: 1 },
  headerLabel: {
    fontFamily: mono,
    fontWeight: 500,
    fontSize: 7.5,
    color: C.muted,
    letterSpacing: 1.2,
    marginLeft: 8,
  },
  // Dynamic (render prop) text is measured before its content exists: a fixed box keeps it visible.
  pageNumber: {
    width: 60,
    textAlign: "right",
    fontFamily: mono,
    fontWeight: 500,
    fontSize: 7.5,
    color: C.text,
    letterSpacing: 1,
  },
  pageNumberTop: { position: "absolute", top: 27, right: PAGE.padX },
  // `bottom` offsets are not honoured for dynamic text (it was not drawn): place it from the top.
  pageNumberBottom: { position: "absolute", top: 841.89 - 36, right: PAGE.padX },
  footer: {
    position: "absolute",
    bottom: 22,
    left: PAGE.padX,
    right: PAGE.padX,
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: C.line,
  },
  footerBrand: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 2.4,
    color: C.text,
  },
  footerMeta: {
    fontFamily: mono,
    fontWeight: 500,
    fontSize: 6.5,
    color: C.faint,
    letterSpacing: 0.6,
    marginTop: 2,
  },

  /* ── Typography ── */
  eyebrow: {
    fontFamily: mono,
    fontWeight: 500,
    fontSize: 7,
    letterSpacing: 1.6,
    color: C.cyan,
    textTransform: "uppercase",
  },
  label: {
    fontFamily: display,
    fontWeight: 600,
    fontSize: 7.5,
    letterSpacing: 1.4,
    color: C.muted,
    textTransform: "uppercase",
  },
  h1: {
    fontFamily: display,
    fontWeight: 800,
    fontSize: 38,
    lineHeight: 1,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  h2: {
    fontFamily: display,
    fontWeight: 800,
    fontSize: 18,
    lineHeight: 1.05,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  h3: {
    fontFamily: display,
    fontWeight: 700,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  bodyText: { fontFamily: body, fontWeight: 400, fontSize: 9.5, lineHeight: 1.45, color: C.muted },
  strong: { fontFamily: body, fontWeight: 600, color: C.text },
  monoSmall: { fontFamily: mono, fontWeight: 500, fontSize: 7, color: C.faint, letterSpacing: 0.6 },

  /* ── Surfaces ── */
  panel: { backgroundColor: C.surface, borderWidth: 0.75, borderColor: C.line },
  raised: { backgroundColor: C.raised, borderWidth: 0.75, borderColor: C.lineStrong },
  rule: { height: 0.75, backgroundColor: C.line },
});
