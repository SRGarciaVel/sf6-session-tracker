import { describe, expect, it } from "vitest";
import { computeNextPollDelay, type PollingConfig } from "./polling";

const config: PollingConfig = {
  intervalMs: 20_000,
  jitterMs: 3_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 120_000,
};
const noJitter = () => 0.5;

describe("computeNextPollDelay", () => {
  it("uses the base interval when healthy", () => {
    expect(computeNextPollDelay(config, { consecutiveFailures: 0 }, noJitter)).toBe(20_000);
  });

  it("backs off exponentially and caps", () => {
    const delays = [1, 2, 3, 4, 5].map((n) =>
      computeNextPollDelay(config, { consecutiveFailures: n }, noJitter),
    );
    expect(delays).toEqual([30_000, 60_000, 120_000, 120_000, 120_000]);
  });

  it("applies bounded jitter", () => {
    const low = computeNextPollDelay(config, { consecutiveFailures: 0 }, () => 0);
    const high = computeNextPollDelay(config, { consecutiveFailures: 0 }, () => 0.999999);
    expect(low).toBe(17_000);
    expect(high).toBeGreaterThan(22_900);
    expect(high).toBeLessThanOrEqual(23_000);
  });

  it("honours Retry-After when it is longer than the backoff", () => {
    expect(
      computeNextPollDelay(config, { consecutiveFailures: 1, retryAfterMs: 90_000 }, noJitter),
    ).toBe(90_000);
  });

  it("never returns less than 1s", () => {
    expect(
      computeNextPollDelay({ ...config, intervalMs: 0, jitterMs: 0 }, { consecutiveFailures: 0 }),
    ).toBe(1_000);
  });
});
