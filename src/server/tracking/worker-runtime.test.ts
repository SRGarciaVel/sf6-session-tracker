import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db/client";
import { logger } from "@/server/logger";
import type { SF6DataProvider } from "@/server/sf6/provider";
import type { ClaimedPlayer, TrackerConfig } from "./tracker";

const mocks = vi.hoisted(() => ({
  claimDuePlayers: vi.fn(),
  pollPlayer: vi.fn(),
  releaseAllLeases: vi.fn(),
  pruneStaleConnections: vi.fn(),
}));
vi.mock("./tracker", () => ({
  claimDuePlayers: mocks.claimDuePlayers,
  pollPlayer: mocks.pollPlayer,
  releaseAllLeases: mocks.releaseAllLeases,
}));
vi.mock("@/server/overlays/service", () => ({
  pruneStaleConnections: mocks.pruneStaleConnections,
}));

const { TrackerRuntime } = await import("./worker-runtime");

process.env.LOG_LEVEL = "error";

const config: TrackerConfig = {
  polling: { intervalMs: 20_000, jitterMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 120_000 },
  leaseMs: 60_000,
  profileRefreshMs: 300_000,
  startGraceMs: 0,
};
const player = (id: string): ClaimedPlayer => ({
  id,
  userId: `u-${id}`,
  cfnUserId: "1000000000",
  consecutiveFailures: 0,
  lastSuccessAt: null,
  profileUpdatedAt: null,
  profileRefreshUntil: null,
});

function makeRuntime(overrides: { concurrency?: number; provider?: "mock" | "companion" } = {}) {
  return new TrackerRuntime({
    db: {} as Database,
    provider: { name: "fake" } as SF6DataProvider,
    env: {
      WORKER_CONCURRENCY: overrides.concurrency ?? 2,
      WORKER_TICK_MS: 5,
      SF6_PROVIDER: overrides.provider ?? "mock",
    },
    config,
    logger,
    mode: "embedded",
    workerId: "test-worker",
  });
}

describe("TrackerRuntime", () => {
  beforeEach(() => {
    mocks.claimDuePlayers.mockResolvedValue([]);
    mocks.pollPlayer.mockResolvedValue({ status: "ok" });
    mocks.releaseAllLeases.mockResolvedValue(undefined);
    mocks.pruneStaleConnections.mockResolvedValue(0);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing until start() (no side effects on construction)", () => {
    makeRuntime();
    expect(mocks.claimDuePlayers).not.toHaveBeenCalled();
  });

  it("claims up to the free capacity with the companion filter when applicable", async () => {
    let release!: () => void;
    mocks.pollPlayer.mockReturnValue(new Promise((r) => (release = () => r({ status: "ok" }))));
    mocks.claimDuePlayers.mockResolvedValueOnce([player("a")]);
    const rt = makeRuntime({ concurrency: 3, provider: "companion" });
    await rt.tick();
    expect(mocks.claimDuePlayers).toHaveBeenCalledWith(
      expect.anything(),
      "test-worker",
      3,
      60_000,
      {
        requireCompanionData: true,
      },
    );
    expect(rt.inFlightCount).toBe(1);
    await rt.tick();
    expect(mocks.claimDuePlayers).toHaveBeenLastCalledWith(
      expect.anything(),
      "test-worker",
      2,
      60_000,
      { requireCompanionData: true },
    );
    release();
    await rt.stop();
    expect(rt.inFlightCount).toBe(0);
  });

  it("start() is idempotent: one loop, one worker.started", async () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.LOG_LEVEL = "info";
    const rt = makeRuntime();
    rt.start();
    rt.start();
    rt.start();
    await vi.waitFor(() => expect(mocks.claimDuePlayers).toHaveBeenCalled());
    await rt.stop();
    process.env.LOG_LEVEL = "error";
    const started = info.mock.calls.filter(([line]) => String(line).includes('"worker.started"'));
    expect(started).toHaveLength(1);
    info.mockRestore();
  });

  it("stop() is idempotent, waits for in-flight polls, then releases leases exactly once", async () => {
    let finishPoll!: () => void;
    const order: string[] = [];
    mocks.claimDuePlayers.mockResolvedValueOnce([player("a")]);
    mocks.pollPlayer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPoll = () => {
            order.push("poll-done");
            resolve({ status: "ok" });
          };
        }),
    );
    mocks.releaseAllLeases.mockImplementation(async () => {
      order.push("released");
    });
    const rt = makeRuntime();
    rt.start();
    await vi.waitFor(() => expect(rt.inFlightCount).toBe(1));

    const first = rt.stop("SIGTERM");
    const second = rt.stop("SIGINT");
    expect(second).toBe(first);
    expect(rt.running).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.releaseAllLeases).not.toHaveBeenCalled(); // still waiting for the poll

    finishPoll();
    await first;
    expect(order).toEqual(["poll-done", "released"]);
    expect(mocks.releaseAllLeases).toHaveBeenCalledTimes(1);
    expect(mocks.releaseAllLeases).toHaveBeenCalledWith(expect.anything(), "test-worker");

    // No new claims after stop.
    const claims = mocks.claimDuePlayers.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.claimDuePlayers.mock.calls.length).toBe(claims);
    await rt.stop();
    expect(mocks.releaseAllLeases).toHaveBeenCalledTimes(1);
  });

  it("stop() before start() still releases leases and never starts the loop", async () => {
    const rt = makeRuntime();
    await rt.stop();
    rt.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.claimDuePlayers).not.toHaveBeenCalled();
    expect(mocks.releaseAllLeases).toHaveBeenCalledTimes(1);
  });

  it("keeps running after a failed tick (backoff) and survives a failed release", async () => {
    mocks.claimDuePlayers.mockRejectedValueOnce(new Error("db restarting"));
    mocks.releaseAllLeases.mockRejectedValueOnce(new Error("db down"));
    const rt = makeRuntime();
    rt.start();
    await vi.waitFor(() => expect(mocks.claimDuePlayers).toHaveBeenCalledTimes(1));
    // The backoff sleep is interrupted by stop(); release failure is logged, not thrown.
    await expect(rt.stop()).resolves.toBeUndefined();
    expect(rt.running).toBe(false);
  });

  it("a crashing poll is contained and removed from in-flight", async () => {
    mocks.claimDuePlayers.mockResolvedValueOnce([player("a")]);
    mocks.pollPlayer.mockRejectedValueOnce(new Error("boom"));
    const rt = makeRuntime();
    await rt.tick();
    await vi.waitFor(() => expect(rt.inFlightCount).toBe(0));
    await rt.stop();
  });
});
