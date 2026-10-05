/**
 * Embedded tracking runtime (TRACKER_RUNTIME_MODE=embedded): the scheduler runs inside the
 * Next.js server process, for the single-service free beta. Started from src/instrumentation.ts.
 *
 * One runtime per process, guaranteed by a globalThis singleton keyed with Symbol.for (survives
 * dev HMR and duplicate module instances); DB leases still protect against other processes.
 * Never starts on import, during `next build`, or in standalone mode.
 */
import type { Env } from "@/server/env";

/** What the embedded host needs from a runtime (TrackerRuntime in production). */
export interface EmbeddedRuntime {
  start(): void;
  stop(reason?: string): Promise<void>;
}

const RUNTIME_KEY = Symbol.for("sf6.tracker.runtime");

interface EmbeddedState {
  runtime: EmbeddedRuntime;
}
type RuntimeGlobal = typeof globalThis & { [RUNTIME_KEY]?: EmbeddedState };

export interface SignalTarget {
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

export interface EmbeddedStartOptions {
  env: Pick<Env, "TRACKER_RUNTIME_MODE">;
  /** Builds the runtime (real deps in production, fakes in tests). Only called when starting. */
  create: () => EmbeddedRuntime;
  /** Defaults to process.env.NEXT_PHASE. */
  phase?: string;
  /** Defaults to process. */
  signals?: SignalTarget;
}

export type EmbeddedStartResult =
  | { started: true; runtime: EmbeddedRuntime }
  | {
      started: false;
      reason: "standalone_mode" | "build_phase" | "already_running";
      runtime?: EmbeddedRuntime;
    };

export function getEmbeddedRuntime(): EmbeddedRuntime | null {
  return (globalThis as RuntimeGlobal)[RUNTIME_KEY]?.runtime ?? null;
}

/**
 * Starts the embedded runtime at most once per process and returns immediately (the loop is
 * never awaited, so it cannot delay the server becoming ready).
 */
export function startEmbeddedTracker(options: EmbeddedStartOptions): EmbeddedStartResult {
  if (options.env.TRACKER_RUNTIME_MODE !== "embedded") {
    return { started: false, reason: "standalone_mode" };
  }
  if ((options.phase ?? process.env.NEXT_PHASE) === "phase-production-build") {
    return { started: false, reason: "build_phase" };
  }
  const g = globalThis as RuntimeGlobal;
  const existing = g[RUNTIME_KEY];
  if (existing) return { started: false, reason: "already_running", runtime: existing.runtime };

  const runtime = options.create();
  g[RUNTIME_KEY] = { runtime };
  runtime.start();

  // Registered once (inside the singleton guard). Next.js keeps its own SIGTERM/SIGINT handler
  // that closes the HTTP server and then exits the process; we only stop claiming and release
  // our leases in parallel. No process.exit here, and the DB pool is left to the process: if
  // Next exits first, the leases simply expire after TRACKER_LEASE_MS.
  const signals = options.signals ?? process;
  const onSignal = (signal: string) => () => void runtime.stop(signal);
  signals.once("SIGTERM", onSignal("SIGTERM"));
  signals.once("SIGINT", onSignal("SIGINT"));
  return { started: true, runtime };
}

/** Stops and forgets the embedded runtime (idempotent). Tests and graceful shutdown. */
export async function stopEmbeddedTracker(reason = "stop"): Promise<void> {
  const g = globalThis as RuntimeGlobal;
  const state = g[RUNTIME_KEY];
  if (!state) return;
  await state.runtime.stop(reason);
  if (g[RUNTIME_KEY] === state) delete g[RUNTIME_KEY];
}
