import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => vi.fn());
vi.mock("@/server/tracking/embedded-boot", () => ({ bootEmbeddedTracker: boot }));

const saved = {
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
  NEXT_PHASE: process.env.NEXT_PHASE,
  TRACKER_RUNTIME_MODE: process.env.TRACKER_RUNTIME_MODE,
};
function setEnv(vars: Partial<Record<keyof typeof saved, string | undefined>>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("instrumentation register()", () => {
  afterEach(() => {
    setEnv(saved);
    boot.mockClear();
  });

  it("importing the module has no side effects", async () => {
    await import("./instrumentation");
    expect(boot).not.toHaveBeenCalled();
  });

  it("boots the embedded tracker only on Node, outside build, in embedded mode", async () => {
    const { register } = await import("./instrumentation");

    setEnv({ NEXT_RUNTIME: "edge", NEXT_PHASE: undefined, TRACKER_RUNTIME_MODE: "embedded" });
    await register();
    setEnv({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" });
    await register();
    setEnv({ NEXT_PHASE: undefined, TRACKER_RUNTIME_MODE: "standalone" });
    await register();
    setEnv({ TRACKER_RUNTIME_MODE: undefined });
    await register();
    expect(boot).not.toHaveBeenCalled();

    setEnv({ TRACKER_RUNTIME_MODE: "embedded" });
    await register();
    expect(boot).toHaveBeenCalledTimes(1);
  });
});
