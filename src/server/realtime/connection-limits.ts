/**
 * Concurrent SSE connection caps (SEC-004). Rate limits bound how fast connections are OPENED;
 * these bound how many stay open, so a leaked overlay URL or a looping client cannot pile up
 * long-lived streams (each one holds memory, timers and periodic DB writes).
 *
 * Per process on purpose: what is protected is this instance's own resources.
 */

export const SSE_LIMITS = {
  /** One overlay URL: OBS scenes + previews; more is abuse of a leaked URL. */
  perOverlay: 10,
  /** Open overlay streams from one client IP (all overlays). */
  perIp: 30,
  /** Dashboard streams of one account (tabs/devices). */
  perUser: 5,
} as const;

interface LimitsGlobal {
  __sf6SseSlots?: Map<string, number>;
}
const g = globalThis as LimitsGlobal;
const slots = (g.__sf6SseSlots ??= new Map<string, number>());

/**
 * Take one slot in EVERY bucket, or none. Returns the release function (idempotent), or null
 * when any bucket is full.
 */
export function acquireSseSlots(
  buckets: ReadonlyArray<[key: string, max: number]>,
): (() => void) | null {
  if (buckets.some(([key, max]) => (slots.get(key) ?? 0) >= max)) return null;
  for (const [key] of buckets) slots.set(key, (slots.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const [key] of buckets) {
      const n = (slots.get(key) ?? 1) - 1;
      if (n <= 0) slots.delete(key);
      else slots.set(key, n);
    }
  };
}

export function openSseSlots(key: string): number {
  return slots.get(key) ?? 0;
}

/** Tests only. */
export function resetSseSlots(): void {
  slots.clear();
}
