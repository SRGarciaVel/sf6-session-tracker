/**
 * Locale-aware presentation formatters shared by overlay and dashboard. Built on Intl — no
 * hardcoded separators (es: "66,7 %", "18.430"; en: "66.7%", "18,430").
 */

const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let nf = cache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(locale, options);
    cache.set(key, nf);
  }
  return nf;
}

export function formatInteger(n: number | null | undefined, locale: string): string {
  return n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : numberFormat(locale, { maximumFractionDigits: 0 }).format(n);
}

/** A non-integer quantity (e.g. an average), at most `digits` decimals; "—" if not finite. */
export function formatDecimal(n: number | null | undefined, locale: string, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : numberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

/**
 * A signed non-integer quantity, at most `digits` decimals ("+10", "-13,8"); "—" if not finite.
 * Rounded first, so it never shows "-0" or "+0" (that is "±0").
 */
export function formatSignedDecimal(
  n: number | null | undefined,
  locale: string,
  digits = 1,
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const factor = 10 ** digits;
  const rounded = Math.round(n * factor) / factor;
  if (rounded === 0) return "±0";
  return numberFormat(locale, { maximumFractionDigits: digits, signDisplay: "always" }).format(
    rounded,
  );
}

/** `rate` is 0–100. */
export function formatWinRate(rate: number, locale: string): string {
  const safe = Number.isFinite(rate) ? rate : 0;
  return numberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(safe / 100);
}

export function formatDelta(delta: number | null | undefined, locale: string): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  if (delta === 0) return "±0";
  return numberFormat(locale, { maximumFractionDigits: 0, signDisplay: "always" }).format(delta);
}

export type DeltaTone = "positive" | "negative" | "neutral";

export function deltaTone(delta: number | null | undefined): DeltaTone {
  if (delta === null || delta === undefined || delta === 0) return "neutral";
  return delta > 0 ? "positive" : "negative";
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

/**
 * Gameplay duration for analytics: whole minutes, no seconds. "0 min", "42 min", "1 h 24 min"
 * (identical abbreviations in ES/EN; numbers localized). Rounded to the nearest minute.
 */
export function formatMinutes(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const minutes = `${formatInteger(m, locale)} min`;
  return h > 0 ? `${formatInteger(h, locale)} h ${minutes}` : minutes;
}

/** "12 sec. ago" / "hace 12 s" via Intl.RelativeTimeFormat. */
export function formatTimeAgo(
  iso: string,
  now: number,
  locale: string,
): { seconds: number; text: string } {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "short" });
  if (seconds < 60) return { seconds, text: rtf.format(-seconds, "second") };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { seconds, text: rtf.format(-minutes, "minute") };
  return { seconds, text: rtf.format(-Math.floor(minutes / 60), "hour") };
}
