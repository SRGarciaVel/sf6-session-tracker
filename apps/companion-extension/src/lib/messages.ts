/** popup ⇄ service worker messages. The popup never sees the device token. */
import type { CompanionStore, ConnectionTestReport } from "./storage";

export type CompanionRequest =
  | { type: "status" }
  | { type: "pair"; trackerUrl: string; code: string; deviceName: string }
  | { type: "syncNow" }
  | { type: "testBuckler" }
  | { type: "setCfn"; cfnUserId: string }
  | { type: "disconnect" };

export type PublicStatus = Omit<CompanionStore, "deviceToken"> & { paired: boolean };

export type CompanionResponse =
  | { ok: true; status: PublicStatus; test?: ConnectionTestReport; outcome?: string }
  | { ok: false; error: string; status?: PublicStatus };

export function toPublicStatus(store: CompanionStore): PublicStatus {
  const { deviceToken, ...rest } = store;
  return { ...rest, paired: deviceToken !== null };
}
