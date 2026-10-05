import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeatController, type HeartbeatOutcome } from "./session-heartbeat";

describe("session heartbeat controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = (outcome: HeartbeatOutcome = "ok") => {
    const send = vi.fn<() => Promise<HeartbeatOutcome>>().mockResolvedValue(outcome);
    const c = createHeartbeatController({ send, intervalMs: 1_000 });
    return { send, c };
  };

  it("sends nothing while no session is active", async () => {
    const { send, c } = make();
    c.update(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();
    expect(c.running).toBe(false);
  });

  it("one interval only, however often update(true) is called", async () => {
    const { send, c } = make();
    c.update(true);
    c.update(true);
    c.update(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(3);
    c.dispose();
  });

  it("stops when the session ends and on dispose (unmount)", async () => {
    const { send, c } = make();
    c.update(true);
    await vi.advanceTimersByTimeAsync(1_000);
    c.update(false);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(1);

    c.update(true);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    c.update(true); // after unmount: ignored
    expect(vi.getTimerCount()).toBe(0);
  });

  it("server says no active session → stops itself", async () => {
    const { send, c } = make("stop");
    c.update(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(c.running).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("failures are silent and do not stop the interval", async () => {
    const send = vi.fn<() => Promise<HeartbeatOutcome>>().mockRejectedValue(new Error("offline"));
    const c = createHeartbeatController({ send, intervalMs: 1_000 });
    c.update(true);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(c.running).toBe(true);
    c.dispose();
  });

  it("never overlaps requests when one is slow", async () => {
    const send = vi.fn<() => Promise<HeartbeatOutcome>>(() => new Promise(() => {}));
    const c = createHeartbeatController({ send, intervalMs: 1_000 });
    c.update(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(1);
    c.dispose();
  });
});
