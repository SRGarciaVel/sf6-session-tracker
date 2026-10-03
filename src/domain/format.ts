/** Presentation formatters shared by overlay and dashboard. Pure; locale fixed for stable SSR. */

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatInteger(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : integer.format(n);
}

export function formatWinRate(rate: number): string {
  return `${Number.isFinite(rate) ? rate.toFixed(1).replace(/\.0$/, "") : "0"}%`;
}

export function formatDelta(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "—";
  if (delta === 0) return "±0";
  return `${delta > 0 ? "+" : "−"}${integer.format(Math.abs(delta))}`;
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
