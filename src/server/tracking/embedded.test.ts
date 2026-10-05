import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEmbeddedRuntime,
  startEmbeddedTracker,
  stopEmbeddedTracker,
  type EmbeddedRuntime,
  type SignalTarget,
} from "./embedded";

function fakeRuntime() {
  const runtime = {
    start: vi.fn<() => void>(),
    stop: vi.fn<(reason?: string) => Promise<void>>().mockResolvedValue(undefined),
  } satisfies EmbeddedRuntime;
  return runtime;
}

function fakeSignals() {
  const listeners: Array<[string, () => void]> = [];
  const target: SignalTarget = {
    once: (signal, listener) => listeners.push([signal, listener]),
  };
  return { target, listeners };
}

const embedded = { TRACKER_RUNTIME_MODE: "embedded" as const };

describe("embedded tracking runtime", () => {
  afterEach(async () => {
    await stopEmbeddedTracker("test-cleanup");
  });

  it("importing the module starts nothing", () => {
    expect(getEmbeddedRuntime()).toBeNull();
  });

  it("does not start in standalone mode", () => {
    const create = vi.fn(fakeRuntime);
    const result = startEmbeddedTracker({
      env: { TRACKER_RUNTIME_MODE: "standalone" },
      create,
      phase: "phase-production-server",
      signals: fakeSignals().target,
    });
    expect(result).toEqual({ started: false, reason: "standalone_mode" });
    expect(create).not.toHaveBeenCalled();
    expect(getEmbeddedRuntime()).toBeNull();
  });

  it("does not start during next build", () => {
    const create = vi.fn(fakeRuntime);
    const result = startEmbeddedTracker({
      env: embedded,
      create,
      phase: "phase-production-build",
      signals: fakeSignals().target,
    });
    expect(result).toEqual({ started: false, reason: "build_phase" });
    expect(create).not.toHaveBeenCalled();
  });

  it("starts exactly once per process and registers signal handlers once", () => {
    const create = vi.fn(fakeRuntime);
    const signals = fakeSignals();
    const opts = {
      env: embedded,
      create,
      phase: "phase-production-server",
      signals: signals.target,
    };

    const first = startEmbeddedTracker(opts);
    const second = startEmbeddedTracker(opts);
    const third = startEmbeddedTracker(opts);

    expect(first.started).toBe(true);
    expect(second).toMatchObject({ started: false, reason: "already_running" });
    expect(third).toMatchObject({ started: false, reason: "already_running" });
    expect(create).toHaveBeenCalledTimes(1);
    const runtime = create.mock.results[0]?.value as ReturnType<typeof fakeRuntime>;
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(getEmbeddedRuntime()).toBe(runtime);
    expect(signals.listeners.map(([s]) => s).sort()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("the singleton lives on globalThis (shared by duplicate module instances)", () => {
    const create = vi.fn(fakeRuntime);
    startEmbeddedTracker({ env: embedded, create, phase: "x", signals: fakeSignals().target });
    const slot = (globalThis as Record<symbol, unknown>)[Symbol.for("sf6.tracker.runtime")];
    expect(slot).toBeDefined();
  });

  it("SIGTERM stops the runtime (no process.exit) and stop is idempotent", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const create = vi.fn(fakeRuntime);
    const signals = fakeSignals();
    startEmbeddedTracker({ env: embedded, create, phase: "x", signals: signals.target });
    const runtime = create.mock.results[0]?.value as ReturnType<typeof fakeRuntime>;

    signals.listeners.find(([s]) => s === "SIGTERM")?.[1]();
    expect(runtime.stop).toHaveBeenCalledWith("SIGTERM");
    expect(exit).not.toHaveBeenCalled();

    await stopEmbeddedTracker();
    await stopEmbeddedTracker();
    expect(getEmbeddedRuntime()).toBeNull();
    exit.mockRestore();
  });
});
