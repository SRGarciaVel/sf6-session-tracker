import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY_FEEDBACK_MS, copyText, createCopyController, type CopyStatus } from "./clipboard";

describe("copyText", () => {
  it("uses navigator.clipboard when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const legacyCopy = vi.fn();
    expect(await copyText("ABCD-EFGH", { writeText, legacyCopy })).toBe(true);
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH");
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it("falls back to the legacy copy when the Clipboard API rejects or is missing", async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    expect(await copyText("x", { writeText, legacyCopy })).toBe(true);
    expect(await copyText("y", { legacyCopy })).toBe(true);
    expect(legacyCopy).toHaveBeenCalledTimes(2);
  });

  it("reports failure when nothing could copy", async () => {
    expect(await copyText("x", {})).toBe(false);
    expect(await copyText("x", { legacyCopy: () => false })).toBe(false);
    expect(
      await copyText("x", {
        legacyCopy: () => {
          throw new Error("no DOM");
        },
      }),
    ).toBe(false);
  });
});

describe("copy controller (feedback timing)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (ok = true) => {
    const states: CopyStatus[] = [];
    const c = createCopyController({
      onChange: (s) => states.push(s),
      deps: { writeText: ok ? async () => undefined : undefined },
    });
    return { c, states };
  };

  it("shows 'copied' then returns to idle after the feedback window", async () => {
    const { c, states } = setup();
    await c.copy("x");
    expect(states).toEqual(["copied"]);
    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS - 1);
    expect(states).toEqual(["copied"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(states).toEqual(["copied", "idle"]);
  });

  it("shows 'failed' when copying is impossible", async () => {
    const { c, states } = setup(false);
    expect(await c.copy("x")).toBe(false);
    expect(states).toEqual(["failed"]);
  });

  it("repeated clicks keep a single reset timer", async () => {
    const { c, states } = setup();
    await c.copy("a");
    await vi.advanceTimersByTimeAsync(1_000);
    await c.copy("b");
    await c.copy("c");
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(COPY_FEEDBACK_MS);
    expect(states.filter((s) => s === "idle")).toHaveLength(1);
  });

  it("dispose (unmount) clears the timer and silences late results", async () => {
    const { c, states } = setup();
    await c.copy("a");
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await c.copy("b");
    expect(states).toEqual(["copied"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
