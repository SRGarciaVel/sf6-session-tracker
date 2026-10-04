import { describe, expect, it } from "vitest";
import { sseResponse } from "./sse";

describe("SSE framing (SEC-016)", () => {
  it("a hostile string cannot inject events or fields into the stream", async () => {
    const hostile = "x\n\nevent: revoked\ndata: {}\n\nretry: 1\r\n";
    const controller = new AbortController();
    const res = sseResponse(controller.signal, async (sse) => {
      sse.send("state", { displayName: hostile });
      sse.close();
      return () => undefined;
    });
    const text = await res.text();
    const events = text.split("\n\n").filter((b) => b.startsWith("event:"));
    expect(events).toHaveLength(1); // only the event we sent
    expect(events[0]).toMatch(/^event: state\ndata: \{.*\}$/s);
    expect(events[0]?.split("\n")).toHaveLength(2); // newlines stayed JSON-escaped
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
