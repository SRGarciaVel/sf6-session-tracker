/**
 * Overlay clock on the SERVER timeline (shared by Rank Progress freshness and Session rating
 * holds): the snapshot's `generatedAt` plus the time elapsed since that snapshot reached the
 * browser. Elapsed time is MONOTONIC (`performance.now()`, the clock timers run on), so a skewed or
 * adjusted OBS machine clock never matters. The value is re-evaluated exactly at the given server
 * instants (`edges`), and a timer that fires before its edge re-arms; between edges nothing runs.
 * Server render and hydration use `generatedAt` itself (identical markup).
 */
import { useEffect, useState } from "react";

/** setTimeout's maximum delay (≈ 24.8 days); longer waits are clamped. */
const MAX_TIMEOUT_MS = 2_147_483_647;

export function useServerClock(generatedAt: string, edges: readonly number[]): number {
  const base = Date.parse(generatedAt) || 0;
  const [tick, setTick] = useState({ base, now: base });
  // Stable dependency for the edge set (a new array each render must not re-arm timers).
  const key = [...edges].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const list = key ? key.split(",").map(Number) : [];
    const receivedAt = performance.now();
    const serverNow = () => base + (performance.now() - receivedAt);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = serverNow();
      const next = list.find((edge) => edge >= now);
      if (next === undefined) return;
      timer = setTimeout(
        () => {
          setTick({ base, now: serverNow() });
          arm(); // re-arm: an early timer, or the next edge
        },
        Math.min(next - now + 1, MAX_TIMEOUT_MS),
      );
    };
    arm();
    return () => clearTimeout(timer);
  }, [base, key]);
  // A newer snapshot restarts the clock from its own generatedAt.
  return tick.base === base ? tick.now : base;
}
