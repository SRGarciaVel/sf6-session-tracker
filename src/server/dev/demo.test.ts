import { describe, expect, it } from "vitest";
import { DEMO_CFN, demoDataReason } from "./demo";

describe("demo data flag", () => {
  it("flags the mock provider and the seeded fake CFN, never a real setup", () => {
    expect(demoDataReason("mock", "1733837998")).toBe("mock_provider");
    expect(demoDataReason("companion", DEMO_CFN)).toBe("demo_cfn");
    expect(demoDataReason("companion", "1733837998")).toBeNull();
    expect(demoDataReason("capcom", "1733837998")).toBeNull();
  });
});
