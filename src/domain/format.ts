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
