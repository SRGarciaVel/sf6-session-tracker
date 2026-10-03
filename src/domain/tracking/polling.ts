/**
 * Adaptive polling policy (pure). The worker asks this module "when should I poll this player
 * next?"; the frequency is never hardcoded anywhere else.
 */

export interface PollingConfig {
  /** Base interval while a session is active and the provider is healthy. */
  intervalMs: number;
  /** Max random +/- jitter applied to every delay, so players don't poll in lockstep. */
  jitterMs: number;
  /** First backoff delay after an error; doubles per consecutive failure. */
  backoffBaseMs: number;
  backoffMaxMs: number;
}

export interface PollOutcome {
  consecutiveFailures: number;
  /** Provider-specified delay (e.g. HTTP Retry-After), if any. */
  retryAfterMs?: number | null;
}

/** `random` returns [0, 1); injectable for tests. */
export function computeNextPollDelay(
  config: PollingConfig,
  outcome: PollOutcome,
  random: () => number = Math.random,
): number {
  let base: number;
  if (outcome.consecutiveFailures <= 0) {
    base = config.intervalMs;
  } else {
    const exp = config.backoffBaseMs * 2 ** (outcome.consecutiveFailures - 1);
    base = Math.min(exp, config.backoffMaxMs);
  }
  if (outcome.retryAfterMs != null && outcome.retryAfterMs > base) {
    base = Math.min(outcome.retryAfterMs, Math.max(config.backoffMaxMs, config.intervalMs));
  }
  const jitter = (random() * 2 - 1) * config.jitterMs;
  return Math.max(1_000, Math.round(base + jitter));
}
