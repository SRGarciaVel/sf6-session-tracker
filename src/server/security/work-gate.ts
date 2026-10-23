/**
 * Bounded admission for CPU-heavy, on-demand work in this process (e.g. rendering a document).
 * Non-blocking: a job either gets a slot now or is refused with a retry hint, so callers never
 * build an unbounded queue and the event loop stays available to everyone else.
 *
 *   - maxInFlight   accepted jobs at once (running + waiting behind a serialising renderer);
 *   - maxPerWindow  jobs started per fixed window (bounds the CPU share over time);
 *   - one job in flight per subject (an account cannot hold every slot).
 *
 * Per process by design: the limit protects this process's CPU. Cross-instance fairness per
 * account is the job of the shared rate limiter (security/rate-limit.ts), applied by callers.
 */

export type WorkGateRefusal = {
  ok: false;
  /** `subject_busy`: this subject already has a job in flight; `capacity`: the process is full. */
  reason: "subject_busy" | "capacity";
  retryAfterSeconds: number;
};
export type WorkGateEntry = { ok: true; release: () => void } | WorkGateRefusal;

export interface WorkGate {
  tryEnter(subject: string): WorkGateEntry;
  /** Introspection for tests / logs. */
  stats(): { inFlight: number; startedInWindow: number };
}

export function createWorkGate(options: {
  maxInFlight: number;
  maxPerWindow: number;
  windowMs: number;
  /** Seconds suggested when the process is full (jobs typically take less than this). */
  busyRetrySeconds: number;
  now?: () => number;
}): WorkGate {
  const now = options.now ?? Date.now;
  const subjects = new Set<string>();
  let inFlight = 0;
  let windowStart = now();
  let started = 0;

  return {
    tryEnter(subject) {
      const t = now();
      if (t - windowStart >= options.windowMs) {
        windowStart = t;
        started = 0;
      }
      if (subjects.has(subject)) {
        return { ok: false, reason: "subject_busy", retryAfterSeconds: options.busyRetrySeconds };
      }
      if (inFlight >= options.maxInFlight) {
        return { ok: false, reason: "capacity", retryAfterSeconds: options.busyRetrySeconds };
      }
      if (started >= options.maxPerWindow) {
        const retry = Math.max(1, Math.ceil((windowStart + options.windowMs - t) / 1000));
        return { ok: false, reason: "capacity", retryAfterSeconds: retry };
      }
      subjects.add(subject);
      inFlight++;
      started++;
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          subjects.delete(subject);
          inFlight--;
        },
      };
    },
    stats: () => ({ inFlight, startedInWindow: started }),
  };
}
