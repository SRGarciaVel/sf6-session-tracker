/**
 * PDF building blocks of the SST review report (react-pdf primitives + report-styles). Layout and
 * formatting only: every number comes from the ReviewReport (domain) and every string from the
 * i18n catalogs via review-text.
 */
import {
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import {
  pctOf,
  twoDigits,
  winRateOf,
  type ReviewReportText,
  type ReviewSignalText,
  type Translate,
} from "@/components/analytics/review-text";
import { BRAND_FULL_NAME, BRAND_NAME } from "@/components/brand/names";
import type { MatchRecord } from "@/domain/analytics/record";
import type { ReviewDirection, ReviewSignal } from "@/domain/analytics/review";
import type { ReviewReport } from "@/domain/analytics/review-report";
import { formatInteger } from "@/domain/format";
import { REPORT_FONTS } from "./fonts";
import { ReportBrandLockup, ReportBrandMark } from "./report-brand";
import { C, S } from "./report-styles";

/** A4 portrait in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

const TONE: Record<ReviewDirection, string> = { down: C.loss, up: C.win, neutral: C.cyan };

/* ───────────────────────── Page master ───────────────────────── */

/** Thin magenta → cyan technical line across the top edge (vector). */
export function ReportAccentLine() {
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
      <Svg width={A4.width} height={3} viewBox={`0 0 ${A4.width} 3`}>
        <Defs>
          <LinearGradient id="sstAccent" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.magenta} />
            <Stop offset="0.45" stopColor={C.magenta} stopOpacity={0.85} />
            <Stop offset="1" stopColor={C.cyan} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={A4.width} height={3} fill="url(#sstAccent)" />
      </Svg>
    </View>
  );
}

/** Restrained blue glow in a page corner (vector radial gradient, no raster). */
export function ReportGlow() {
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0 }}>
      <Svg width={A4.width} height={A4.height} viewBox={`0 0 ${A4.width} ${A4.height}`}>
        <Defs>
          <RadialGradient id="sstGlow" cx="0.92" cy="-0.02" r="0.62">
            <Stop offset="0" stopColor={C.blue} stopOpacity={0.2} />
            <Stop offset="1" stopColor={C.blue} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="sstGlowLow" cx="-0.05" cy="1.04" r="0.5">
            <Stop offset="0" stopColor={C.magenta} stopOpacity={0.07} />
            <Stop offset="1" stopColor={C.magenta} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={A4.width} height={A4.height} fill="url(#sstGlow)" />
        <Rect x={0} y={0} width={A4.width} height={A4.height} fill="url(#sstGlowLow)" />
      </Svg>
    </View>
  );
}

export function ReportHeader({ label }: { label: string }) {
  return (
    <View fixed style={S.header}>
      <View style={S.headerLeft}>
        <ReportBrandMark width={30} />
        <Text style={S.headerLabel}>
          {BRAND_NAME} {"//"} {label.toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

/**
 * "02 / 04". ONE dynamic (render-prop) text per page, as a direct, absolutely positioned child of
 * the Page: react-pdf 4.9 drops either a dynamic text or a sibling when they share a container, and
 * a second dynamic text on the same page is not drawn (found in local QA).
 */
export function ReportPageNumber({ at }: { at: "top" | "bottom" }) {
  return (
    <Text
      fixed
      style={[S.pageNumber, at === "top" ? S.pageNumberTop : S.pageNumberBottom]}
      render={({ pageNumber, totalPages }) =>
        `${twoDigits(pageNumber)} / ${twoDigits(totalPages ?? pageNumber)}`
      }
    />
  );
}

export function ReportFooter({ meta }: { meta: string }) {
  return (
    <View fixed style={S.footer}>
      <Text style={S.footerBrand}>{BRAND_FULL_NAME.toUpperCase()}</Text>
      <Text style={S.footerMeta}>{meta}</Text>
    </View>
  );
}

/* ───────────────────────── Primitives ───────────────────────── */

/** Notched (cut) top-right corner over a panel: the HUD geometry of the dashboard panels. */
function Notch({ size = 10, border = C.line }: { size?: number; border?: string }) {
  return (
    <View style={{ position: "absolute", top: -0.75, right: -0.75 }}>
      <Svg width={size + 1} height={size + 1} viewBox={`0 0 ${size + 1} ${size + 1}`}>
        <Path d={`M0 0H${size + 1}V${size + 1}Z`} fill={C.bg} />
        <Path d={`M0.4 0.4L${size + 0.6} ${size + 0.6}`} stroke={border} strokeWidth={0.75} />
      </Svg>
    </View>
  );
}

export function Panel({
  children,
  style,
  accent,
  raised = false,
}: {
  children: ReactNode;
  style?: Record<string, string | number>;
  /** Top accent colour (2 pt). */
  accent?: string;
  raised?: boolean;
}) {
  return (
    <View
      style={[
        raised ? S.raised : S.panel,
        accent ? { borderTopWidth: 2, borderTopColor: accent } : {},
        style ?? {},
      ]}
    >
      {children}
      <Notch border={raised ? C.lineStrong : C.line} />
    </View>
  );
}

function Label({ children, color }: { children: string; color?: string }) {
  return <Text style={[S.label, color ? { color } : {}]}>{children}</Text>;
}

function Eyebrow({ children, color }: { children: string; color?: string }) {
  return <Text style={[S.eyebrow, color ? { color } : {}]}>{children}</Text>;
}

/** Decided-only wins / losses bar; nothing at all without a decided match (never 0 / NaN). */
export function RatioBar({ record, height = 5 }: { record: MatchRecord; height?: number }) {
  if (record.decided <= 0) return null;
  return (
    <View style={{ flexDirection: "row", height, backgroundColor: C.raised }}>
      {record.wins > 0 && <View style={{ flexGrow: record.wins, backgroundColor: C.win }} />}
      {record.losses > 0 && <View style={{ flexGrow: record.losses, backgroundColor: C.loss }} />}
    </View>
  );
}

/** A 0–100 value drawn as a proportional bar (presentation of an existing percentage). */
function ValueBar({ value, color }: { value: number | null; color: string }) {
  const pct = value === null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  return (
    <View style={{ height: 4, backgroundColor: C.raised, flexDirection: "row" }}>
      {pct > 0 && <View style={{ width: `${pct}%`, backgroundColor: color }} />}
    </View>
  );
}

/* ───────────────────────── Cover ───────────────────────── */

export function ReportCover({
  report,
  x,
  t,
  reportDate,
}: {
  report: ReviewReport;
  x: ReviewReportText;
  t: Translate;
  /** "2026.10.16" */
  reportDate: string;
}) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <ReportBrandLockup height={34} />
        <Text style={[S.monoSmall, { color: C.muted, letterSpacing: 1.4 }]}>
          {r("reportLabel").toUpperCase()} {"//"} {reportDate}
        </Text>
      </View>

      <View style={{ marginTop: 46 }}>
        <Eyebrow color={C.magenta}>{`${BRAND_NAME} // ${r("reportLabel")}`}</Eyebrow>
        <Text style={[S.h1, { marginTop: 8 }]}>{r("title")}</Text>
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <View style={{ width: 54, height: 3, backgroundColor: C.magenta }} />
          <View style={{ width: 18, height: 3, backgroundColor: C.cyan, marginLeft: 4 }} />
        </View>
      </View>

      <ReportDatasetIdentity x={x} />
      <ReportDatasetContext x={x} t={t} />
      <ReportSnapshot report={report} x={x} t={t} />
      <ReportOverview x={x} t={t} />
    </View>
  );
}

function ReportDatasetIdentity({ x }: { x: ReviewReportText }) {
  return (
    <View style={{ marginTop: 28 }}>
      <Text
        style={{
          fontFamily: REPORT_FONTS.display,
          fontWeight: 800,
          fontSize: 30,
          lineHeight: 1,
          color: C.cyan,
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {x.identity}
      </Text>
      <Text
        style={{
          marginTop: 6,
          fontFamily: REPORT_FONTS.display,
          fontWeight: 600,
          fontSize: 12,
          letterSpacing: 2,
          color: C.muted,
          textTransform: "uppercase",
        }}
      >
        {[x.identityNote, `${x.mode} // ${x.range}`].filter(Boolean).join("  ·  ")}
      </Text>
    </View>
  );
}

export function ReportDatasetContext({ x, t }: { x: ReviewReportText; t: Translate }) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const items: Array<[string, string]> = [
    [r("context.period"), x.range],
    [r("context.mode"), x.mode],
    [r("context.character"), x.characterLabel],
    [r("context.coverage"), x.coverage],
  ];
  return (
    <View style={{ marginTop: 22 }}>
      <View style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: C.lineStrong }}>
        {items.map(([label, value], i) => (
          <View
            key={label}
            style={{
              flex: i === 3 ? 1.6 : 1,
              paddingTop: 8,
              paddingRight: 8,
              paddingLeft: i === 0 ? 0 : 10,
              borderLeftWidth: i === 0 ? 0 : 0.75,
              borderLeftColor: C.line,
            }}
          >
            <Text style={[S.monoSmall, { letterSpacing: 1.2 }]}>{label.toUpperCase()}</Text>
            <Text
              style={{
                marginTop: 3,
                fontFamily: REPORT_FONTS.display,
                fontWeight: 700,
                fontSize: 11.5,
                color: C.text,
                textTransform: "uppercase",
              }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[S.bodyText, { fontSize: 8, marginTop: 6, color: C.faint }]}>
        {r("coverageNote")}
      </Text>
    </View>
  );
}

/** One cohesive telemetry panel: four metrics with internal separators + the decided-only bar. */
export function ReportSnapshot({
  report,
  x,
  t,
}: {
  report: ReviewReport;
  x: ReviewReportText;
  t: Translate;
}) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const metrics: Array<{ label: string; value: string; note?: string | null }> = [
    { label: r("snapshot.matches"), value: x.matches },
    { label: r("snapshot.record"), value: x.record, note: x.draws },
    { label: r("snapshot.winRate"), value: x.winRate },
    { label: r("snapshot.sessions"), value: x.sessions },
  ];
  return (
    <View style={{ marginTop: 20 }} wrap={false}>
      <Eyebrow>{r("snapshot.title")}</Eyebrow>
      <Panel style={{ marginTop: 6 }} accent={C.cyan}>
        <View style={{ flexDirection: "row" }}>
          {metrics.map((m, i) => (
            <View
              key={m.label}
              style={{
                flex: 1,
                paddingVertical: 12,
                paddingHorizontal: 12,
                borderLeftWidth: i === 0 ? 0 : 0.75,
                borderLeftColor: C.line,
              }}
            >
              <Label>{m.label}</Label>
              <Text
                style={{
                  marginTop: 4,
                  fontFamily: REPORT_FONTS.display,
                  fontWeight: 800,
                  fontSize: 24,
                  lineHeight: 1,
                  color: C.text,
                }}
              >
                {m.value}
              </Text>
              {m.note ? <Text style={[S.monoSmall, { marginTop: 3 }]}>{m.note}</Text> : null}
            </View>
          ))}
        </View>
        {report.snapshot.record.decided > 0 && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            <RatioBar record={report.snapshot.record} />
            <Text style={[S.monoSmall, { marginTop: 4 }]}>{r("snapshot.ratioLabel")}</Text>
          </View>
        )}
      </Panel>
    </View>
  );
}

function ReportOverview({ x, t }: { x: ReviewReportText; t: Translate }) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  return (
    <View style={{ marginTop: 20 }} wrap={false}>
      <Eyebrow>{r("overview.title")}</Eyebrow>
      <View style={{ marginTop: 6 }}>
        {x.priorities.map((p) => (
          <View
            key={p.index}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 7,
              borderBottomWidth: 0.75,
              borderBottomColor: C.line,
            }}
          >
            <Text
              style={{
                width: 34,
                fontFamily: REPORT_FONTS.display,
                fontWeight: 800,
                fontSize: 18,
                color: C.magenta,
              }}
            >
              {twoDigits(p.index)}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[S.monoSmall, { color: C.muted, letterSpacing: 1.2 }]}>
                {p.text.kind.toUpperCase()}
              </Text>
              <Text
                style={{
                  fontFamily: REPORT_FONTS.display,
                  fontWeight: 700,
                  fontSize: 12.5,
                  color: C.text,
                }}
              >
                {p.text.title}
              </Text>
            </View>
            <View style={{ width: 200, paddingLeft: 12, alignItems: "flex-end" }}>
              <DeltaText text={p.text} size={9} />
            </View>
          </View>
        ))}
      </View>
      <View
        style={{
          marginTop: 10,
          borderLeftWidth: 2,
          borderLeftColor: C.magenta,
          paddingLeft: 10,
          paddingVertical: 2,
        }}
      >
        <Text style={[S.bodyText, { color: C.text }]}>
          {x.found} {x.included}
        </Text>
        {x.omitted ? <Text style={[S.bodyText, { marginTop: 2 }]}>{x.omitted}</Text> : null}
        <Text style={[S.bodyText, { marginTop: 2 }]}>{x.limitation}</Text>
      </View>
    </View>
  );
}

/** Arrow glyph (JetBrains Mono has it; Barlow does not) + the signed, worded comparison. */
function DeltaText({
  text,
  size = 11,
  direction,
}: {
  text: ReviewSignalText;
  size?: number;
  direction?: ReviewDirection;
}) {
  const color = direction ? TONE[direction] : C.muted;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", maxWidth: 230 }}>
      <Text style={{ fontFamily: REPORT_FONTS.mono, fontWeight: 500, fontSize: size, color }}>
        {text.arrow}
      </Text>
      <Text
        style={{
          flexShrink: 1,
          marginLeft: 5,
          fontFamily: REPORT_FONTS.body,
          fontWeight: 600,
          fontSize: size,
          color: C.text,
        }}
      >
        {text.comparison}
      </Text>
    </View>
  );
}

/* ───────────────────────── Priority ───────────────────────── */

interface ComparisonRow {
  label: string;
  value: string;
  pct: number | null;
  detail: string;
  focus: boolean;
}

/** The two sides of each signal's comparison, read from its evidence (formatting only). */
function comparisonRows(signal: ReviewSignal, t: Translate, locale: string): ComparisonRow[] {
  const r: Translate = (key, values) => t(`reviewReport.compare.${key}`, values);
  const n = (v: number) => formatInteger(v, locale);
  const decided = (rec: MatchRecord) => r("decided", { count: n(rec.decided) });
  const side = (label: string, rec: MatchRecord, focus: boolean): ComparisonRow => ({
    label,
    value: winRateOf(rec, locale),
    pct: rec.winRate,
    detail: `${n(rec.wins)}–${n(rec.losses)} · ${decided(rec)}`,
    focus,
  });
  switch (signal.type) {
    case "matchup-underperformance":
      return [
        side(`${signal.characterName} vs ${signal.opponentName}`, signal.matchup, true),
        side(r("baseline", { own: signal.characterName }), signal.baseline, false),
      ];
    case "recent-form-shift":
      return [
        side(r("recent", { n: signal.window }), signal.recent, true),
        side(r("previous", { n: signal.window }), signal.previous, false),
      ];
    case "session-half-shift":
      return [
        side(r("firstHalf"), signal.first, false),
        side(r("secondHalf"), signal.second, true),
      ];
    case "post-loss-transition":
      return [
        {
          label: r("afterLoss"),
          value: pctOf(signal.postLoss.rate, locale),
          pct: signal.postLoss.rate,
          detail: r("nextWins", {
            wins: n(signal.postLoss.nextWins),
            total: n(signal.postLoss.total),
          }),
          focus: true,
        },
        {
          label: r("afterWin"),
          value: pctOf(signal.postWin.rate, locale),
          pct: signal.postWin.rate,
          detail: r("nextWins", {
            wins: n(signal.postWin.nextWins),
            total: n(signal.postWin.total),
          }),
          focus: false,
        },
      ];
    case "high-exposure-opponent":
      return [
        {
          label: r("share"),
          value: pctOf(signal.share, locale),
          pct: signal.share,
          detail: `${r("matches", { count: n(signal.record.matches) })} · ${n(signal.record.wins)}–${n(signal.record.losses)}`,
          focus: true,
        },
      ];
  }
}

function signalNote(signal: ReviewSignal, t: Translate): string | null {
  const r: Translate = (key, values) => t(`reviewReport.compare.${key}`, values);
  if (signal.type === "session-half-shift") {
    return r("segments", { count: signal.eligibleSegments });
  }
  if (signal.type === "post-loss-transition") return r("segmentNote");
  return null;
}

export function ReportComparison({
  signal,
  t,
  locale,
}: {
  signal: ReviewSignal;
  t: Translate;
  locale: string;
}) {
  const tone = TONE[signal.direction];
  const note = signalNote(signal, t);
  return (
    <View>
      {comparisonRows(signal, t, locale).map((row) => (
        <View key={row.label} style={{ marginBottom: 7 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <Text
              style={{
                fontFamily: REPORT_FONTS.display,
                fontWeight: 600,
                fontSize: 8.5,
                letterSpacing: 1,
                color: row.focus ? C.text : C.muted,
                textTransform: "uppercase",
                maxWidth: 150,
              }}
            >
              {row.label}
            </Text>
            <Text
              style={{
                fontFamily: REPORT_FONTS.display,
                fontWeight: 700,
                fontSize: 11,
                color: row.focus ? C.text : C.muted,
              }}
            >
              {row.value}
            </Text>
          </View>
          <View style={{ marginTop: 3 }}>
            <ValueBar value={row.pct} color={row.focus ? tone : C.lineStrong} />
          </View>
          <Text style={[S.monoSmall, { marginTop: 2 }]}>{row.detail}</Text>
        </View>
      ))}
      {note ? <Text style={[S.monoSmall, { color: C.muted }]}>{note}</Text> : null}
    </View>
  );
}

/** A visual checklist of the predefined replay-review questions (prompts, not findings). */
export function ReportReplayFocus({
  questions,
  title,
  compact = false,
}: {
  questions: string[];
  title?: string;
  compact?: boolean;
}) {
  return (
    <View>
      {title ? <Eyebrow color={C.magenta}>{title}</Eyebrow> : null}
      <View
        style={[
          { marginTop: title ? 5 : 0 },
          compact ? { flexDirection: "row", flexWrap: "wrap" } : {},
        ]}
      >
        {questions.map((q) => (
          <View
            key={q}
            style={[
              { flexDirection: "row", marginTop: compact ? 4 : 4 },
              compact ? { width: "50%", paddingRight: 10 } : {},
            ]}
            wrap={false}
          >
            <View
              style={{
                width: 7.5,
                height: 7.5,
                marginTop: compact ? 2.2 : 2.5,
                borderWidth: 0.9,
                borderColor: C.cyan,
              }}
            />
            <Text
              style={[
                S.bodyText,
                { flex: 1, marginLeft: 7, color: C.text, fontSize: compact ? 8.5 : 9 },
              ]}
            >
              {q}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ReportPriority({
  priority,
  signal,
  t,
  locale,
}: {
  priority: ReviewReportText["priorities"][number];
  signal: ReviewSignal;
  t: Translate;
  locale: string;
}) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  const s = priority.text;
  const tone = TONE[signal.direction];
  return (
    <View wrap={false} style={{ marginBottom: 18 }}>
      {/* Number + identity */}
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        <Text
          style={{
            fontFamily: REPORT_FONTS.display,
            fontWeight: 800,
            fontSize: 46,
            lineHeight: 0.9,
            color: C.magenta,
          }}
        >
          {twoDigits(priority.index)}
        </Text>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={[S.monoSmall, { color: C.muted, letterSpacing: 1.4 }]}>
            {`${r("priority").toUpperCase()} ${twoDigits(priority.index)} / ${twoDigits(priority.total)}  ·  ${s.kind.toUpperCase()}`}
          </Text>
          <Text style={[S.h2, { marginTop: 3 }]}>{s.title}</Text>
        </View>
      </View>

      <Panel style={{ marginTop: 10 }} accent={tone}>
        <View style={{ flexDirection: "row" }}>
          {/* Headline metric */}
          <View
            style={{ width: 190, padding: 12, borderRightWidth: 0.75, borderRightColor: C.line }}
          >
            <Text
              style={{
                fontFamily: REPORT_FONTS.display,
                fontWeight: 800,
                fontSize: 32,
                lineHeight: 1,
                color: C.text,
              }}
            >
              {s.value}
            </Text>
            <View style={{ marginTop: 5 }}>
              <Label>{s.valueLabel}</Label>
            </View>
            <View style={{ marginTop: 9 }}>
              <DeltaText text={s} size={10} direction={signal.direction} />
            </View>
            <Text style={[S.monoSmall, { marginTop: 6, lineHeight: 1.35 }]}>{s.evidence}</Text>
          </View>
          {/* Comparison */}
          <View style={{ flex: 1, padding: 12 }}>
            <ReportComparison signal={signal} t={t} locale={locale} />
          </View>
        </View>
      </Panel>

      <View style={{ flexDirection: "row", marginTop: 10 }}>
        <View style={{ width: 190, paddingRight: 14 }}>
          <Eyebrow>{r("why")}</Eyebrow>
          <Text style={[S.bodyText, { marginTop: 5 }]}>{s.statement}</Text>
        </View>
        <View
          style={{
            flex: 1,
            paddingLeft: 12,
            borderLeftWidth: 2,
            borderLeftColor: C.magenta,
          }}
        >
          <ReportReplayFocus title={r("replayFocus")} questions={s.questions} />
        </View>
      </View>
    </View>
  );
}

/* ───────────────────────── Closing blocks ───────────────────────── */

export function ReportWorksheet({ x, t }: { x: ReviewReportText; t: Translate }) {
  const r: Translate = (key, values) => t(`reviewReport.${key}`, values);
  return (
    <View style={{ marginBottom: 16 }}>
      <SectionTitle eyebrow={`${BRAND_NAME} // ${r("replayFocus")}`} title={r("worksheet.title")} />
      <Text style={[S.bodyText, { marginTop: 4 }]}>
        {r("worksheet.note")} {t("review.disclaimer")}
      </Text>
      {x.priorities.map((p) => (
        <View key={p.index} wrap={false} style={{ marginTop: 10 }}>
          <Panel raised style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
            <Text
              style={{
                fontFamily: REPORT_FONTS.display,
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: 1.2,
                color: C.text,
                textTransform: "uppercase",
              }}
            >
              <Text style={{ color: C.magenta }}>{twoDigits(p.index)}</Text>
              {`  //  ${p.text.kind}  ·  ${p.text.title}`}
            </Text>
            <View style={{ marginTop: 2 }}>
              <ReportReplayFocus questions={p.text.questions} compact />
            </View>
          </Panel>
        </View>
      ))}
    </View>
  );
}

export function ReportNotes({ title, lines }: { title: string; lines: number }) {
  return (
    <View wrap={false} style={{ marginBottom: 16 }}>
      <SectionTitle title={title} />
      <Panel style={{ marginTop: 8, paddingHorizontal: 12, paddingBottom: 6 }}>
        {Array.from({ length: lines }, (_, i) => (
          <View
            key={i}
            style={{ height: 22, borderBottomWidth: 0.75, borderBottomColor: C.lineStrong }}
          />
        ))}
      </Panel>
    </View>
  );
}

export function ReportMethodology({ t }: { t: Translate }) {
  const r: Translate = (key, values) => t(`reviewReport.methodology.${key}`, values);
  const items = ["recorded", "deterministic", "gates", "causes", "telemetry", "rating"];
  const rules = ["matchup", "recent", "halves", "postLoss", "exposure", "top"];
  return (
    <View wrap={false}>
      <SectionTitle title={r("title")} />
      <View style={{ flexDirection: "row", marginTop: 8 }}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          {items.map((k) => (
            <View key={k} style={{ flexDirection: "row", marginBottom: 4 }}>
              <Text
                style={{ fontFamily: REPORT_FONTS.mono, fontSize: 7, color: C.cyan, width: 10 }}
              >
                {"/"}
              </Text>
              <Text style={[S.bodyText, { flex: 1, fontSize: 8.5 }]}>{r(k)}</Text>
            </View>
          ))}
        </View>
        <Panel style={{ flex: 1, padding: 10 }}>
          <Label>{r("rulesTitle")}</Label>
          {rules.map((k) => (
            <Text key={k} style={[S.monoSmall, { marginTop: 4, color: C.muted, lineHeight: 1.35 }]}>
              {r(`rules.${k}`)}
            </Text>
          ))}
        </Panel>
      </View>
    </View>
  );
}

function SectionTitle({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <View>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: eyebrow ? 3 : 0 }}>
        <View style={{ width: 3, height: 14, backgroundColor: C.magenta, marginRight: 8 }} />
        <Text style={S.h2}>{title}</Text>
      </View>
    </View>
  );
}
