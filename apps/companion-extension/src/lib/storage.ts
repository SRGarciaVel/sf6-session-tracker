/**
 * Extension-local persistent state (chrome.storage.local — never page localStorage).
 * Holds the TRACKER device token; it never holds anything from Capcom (no cookies, no tokens).
 */
import type {
  BucklerFailure,
  BucklerResponseSignature,
  CompanionState,
  CompanionTransportKind,
} from "@sf6/capcom-core";

import { TRACKER_ORIGINS } from "./tracker-origins";

/** First allowed tracker origin of this build (dev: http://localhost:3000). */
export const DEFAULT_TRACKER_URL = TRACKER_ORIGINS[0] ?? "http://localhost:3000";

export type BucklerStatus = "unknown" | "ok" | "no_tab" | BucklerFailure;
export type TrackerStatus = "unpaired" | "connected" | "disconnected" | "revoked" | "error";

export interface TransportTestResult {
  transport: CompanionTransportKind;
  buildId: "PASS" | "FAIL" | "SKIP";
  play: "PASS" | "FAIL" | "SKIP";
  battlelog: "PASS" | "FAIL" | "SKIP";
  failure: string | null;
  status: number | null;
  characters: number | null;
  replays: number | null;
  viewerOwnsProfile: boolean | null;
  /** Locale of the Buckler page (drives _next/data URLs) and the one that actually answered. */
  pageLocale: string | null;
  requestLocale: string | null;
  /** Safe description of the failing answer: status, content type, key NAMES — never values. */
  signature: BucklerResponseSignature | null;
}

export interface ConnectionTestReport {
  at: string;
  cfnUserId: string;
  results: TransportTestResult[];
  preferred: CompanionTransportKind | null;
  verdict: "PASS" | "FAIL";
}

export interface CompanionStore {
  trackerUrl: string;
  deviceId: string | null;
  /** Tracker device token (Authorization: Bearer). Not a Capcom credential. */
  deviceToken: string | null;
  /** Used only when the tracker has no CFN registered yet. */
  manualCfnUserId: string | null;
  transport: CompanionTransportKind | null;
  lastState: CompanionState | null;
  trackerStatus: TrackerStatus;
  bucklerStatus: BucklerStatus;
  bucklerBackoffUntil: string | null;
  lastSyncAt: string | null;
  lastBattlelogAt: string | null;
  lastProfileAt: string | null;
  lastMatchAt: string | null;
  lastError: string | null;
  /** Local cache of replay ids already accepted by the tracker (the DB stays authoritative). */
  seenReplayIds: string[];
  lastTest: ConnectionTestReport | null;
}

export const DEFAULT_STORE: CompanionStore = {
  trackerUrl: DEFAULT_TRACKER_URL,
  deviceId: null,
  deviceToken: null,
  manualCfnUserId: null,
  transport: null,
  lastState: null,
  trackerStatus: "unpaired",
  bucklerStatus: "unknown",
  bucklerBackoffUntil: null,
  lastSyncAt: null,
  lastBattlelogAt: null,
  lastProfileAt: null,
  lastMatchAt: null,
  lastError: null,
  seenReplayIds: [],
  lastTest: null,
};

/** Minimal async key-value area; chrome.storage.local in the extension, a Map in tests. */
export interface KeyValueArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export class CompanionStorage {
  constructor(private readonly area: KeyValueArea) {}

  async load(): Promise<CompanionStore> {
    const raw = await this.area.get(Object.keys(DEFAULT_STORE));
    return { ...DEFAULT_STORE, ...(raw as Partial<CompanionStore>) };
  }

  async patch(patch: Partial<CompanionStore>): Promise<CompanionStore> {
    await this.area.set(patch);
    return this.load();
  }

  /** Forget the pairing and everything derived from it (tracker URL is kept). */
  async resetPairing(): Promise<void> {
    await this.area.remove([
      "deviceId",
      "deviceToken",
      "lastState",
      "seenReplayIds",
      "lastSyncAt",
      "lastBattlelogAt",
      "lastProfileAt",
      "lastMatchAt",
    ]);
    await this.area.set({ trackerStatus: "unpaired" });
  }
}

export function memoryArea(initial: Record<string, unknown> = {}): KeyValueArea & {
  data: Map<string, unknown>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(keys) {
      return Object.fromEntries(keys.filter((k) => data.has(k)).map((k) => [k, data.get(k)]));
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of keys) data.delete(k);
    },
  };
}
