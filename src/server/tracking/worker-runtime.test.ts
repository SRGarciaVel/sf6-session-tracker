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
  autoEndIdleSessions: vi.fn(),
}));
vi.mock("./tracker", () => ({
  claimDuePlayers: mocks.claimDuePlayers,
  pollPlayer: mocks.pollPlayer,
  releaseAllLeases: mocks.releaseAllLeases,
}));
vi.mock("@/server/overlays/service", () => ({
  pruneStaleConnections: mocks.pruneStaleConnections,
}));
vi.mock("@/server/sessions/lifecycle", () => ({
  autoEndIdleSessions: mocks.autoEndIdleSessions,
  observationSourceFor: (p: string) => (p === "companion" ? "companion" : "provider"),
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
    mocks.autoEndIdleSessions.mockResolvedValue({ evaluated: 0, ended: [], aborted: 0, failed: 0 });
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

  it("maintenance ends idle sessions on its cadence (first run immediately, then every interval)", async () => {
    const rt = makeRuntime({ provider: "companion" });
    await rt.maintenance();
    expect(mocks.autoEndIdleSessions).toHaveBeenCalledTimes(1);
    expect(mocks.autoEndIdleSessions.mock.calls[0]?.[2]).toMatchObject({
      source: "companion",
      policy: { idleTimeoutMs: 45 * 60_000, absoluteCeilingMs: 12 * 3_600_000 },
    });
    await rt.maintenance(); // within the 60 s cadence: no second lifecycle pass
    expect(mocks.autoEndIdleSessions).toHaveBeenCalledTimes(1);
    const direct = makeRuntime({ provider: "mock" });
    await direct.maintenance();
    expect(mocks.autoEndIdleSessions.mock.calls[1]?.[2]).toMatchObject({ source: "provider" });
  });

  it("a failing lifecycle pass is contained: maintenance resolves, polling is unaffected", async () => {
    mocks.autoEndIdleSessions.mockRejectedValueOnce(new Error("db hiccup"));
    const rt = makeRuntime();
    await expect(rt.maintenance()).resolves.toBeUndefined();
    expect(mocks.pruneStaleConnections).toHaveBeenCalledTimes(1);
  });

  it("provider mode: successful polls feed the in-memory observation run used by maintenance", async () => {
    mocks.claimDuePlayers.mockResolvedValueOnce([player("a"), player("b")]);
    mocks.pollPlayer.mockImplementation(
      async (_db: unknown, _p: unknown, claimed: ClaimedPlayer) =>
        claimed.id === "a" ? { status: "ok" } : { status: "error", code: "unavailable" },
    );
    const rt = makeRuntime();
    await rt.tick();
    await vi.waitFor(() => expect(rt.inFlightCount).toBe(0));
    await rt.maintenance();
    const lookup = mocks.autoEndIdleSessions.mock.calls[0]?.[2]?.observationFor as (
      id: string,
    ) => { since: string; observations: number } | null;
    expect(lookup("a")).toMatchObject({ observations: 1 });
    expect(lookup("b")).toBeNull(); // a failed read is not an observation
    // A gap longer than the continuity window restarts the run.
    rt.recordObservation("c", new Date(Date.now() - 20 * 60_000));
    rt.recordObservation("c", new Date());
    expect(lookup("c")).toMatchObject({ observations: 1 });
    await rt.stop();
  });
});
