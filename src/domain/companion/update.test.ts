import { describe, expect, it } from "vitest";
import { companionUpdateStatus } from "./update";

describe("companionUpdateStatus", () => {
  it("installed == latest ⇒ up to date", () => {
    expect(companionUpdateStatus("0.1.1", "0.1.1")).toEqual({
      state: "upToDate",
      installed: "0.1.1",
    });
  });
  it("installed < latest ⇒ update available (numeric, not lexicographic)", () => {
    expect(companionUpdateStatus("0.1.9", "0.1.10")).toEqual({
      state: "updateAvailable",
      installed: "0.1.9",
      latest: "0.1.10",
    });
  });
  it("installed > latest ⇒ no update notice", () => {
    expect(companionUpdateStatus("0.2.0", "0.1.9")).toEqual({ state: "ahead", installed: "0.2.0" });
  });
  it("unknown installed version ⇒ nothing alarming", () => {
    expect(companionUpdateStatus(null, "0.1.1")).toEqual({ state: "unknown" });
    expect(companionUpdateStatus("0.1.0-beta", "0.1.1")).toEqual({ state: "unknown" });
  });
  it("missing or invalid latest ⇒ show the installed version only", () => {
    expect(companionUpdateStatus("0.1.0", null)).toEqual({
      state: "installedOnly",
      installed: "0.1.0",
    });
    expect(companionUpdateStatus("0.1.0", "v0.1.1")).toEqual({
      state: "installedOnly",
      installed: "0.1.0",
    });
  });
});
