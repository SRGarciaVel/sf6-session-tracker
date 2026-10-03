import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one JSON line and redacts secrets at any depth", () => {
    process.env.LOG_LEVEL = "info";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.child({ component: "test" }).info("sse.connect", {
      overlayToken: "abc",
      nested: { password: "hunter2", authorization: "Bearer x", ok: 1 },
      error: new Error("boom"),
    });
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      level: "info",
      event: "sse.connect",
      component: "test",
      overlayToken: "[redacted]",
      nested: { password: "[redacted]", authorization: "[redacted]", ok: 1 },
      error: { name: "Error", message: "boom" },
    });
    expect(line).not.toContain("hunter2");
  });

  it("respects LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("ignored");
    expect(spy).not.toHaveBeenCalled();
    process.env.LOG_LEVEL = "info";
  });
});
