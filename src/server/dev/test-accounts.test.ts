import { describe, expect, it } from "vitest";
import { assertLocalDevDatabase, isTestAccountEmail } from "./test-accounts";

describe("dev cleanup: test-account selector", () => {
  it("selects only addresses whose domain is exactly test.local", () => {
    expect(isTestAccountEmail("foo@test.local")).toBe(true);
    // Normalized: Better Auth stores emails lowercased and domains are case-insensitive.
    expect(isTestAccountEmail("bar@TEST.LOCAL")).toBe(true);
    expect(isTestAccountEmail("demo@sf6.local")).toBe(false); // seeded demo: excluded
    expect(isTestAccountEmail("sebastian.rgarciavelasquez@gmail.com")).toBe(false);
    expect(isTestAccountEmail("evil@test.local.example.com")).toBe(false);
    expect(isTestAccountEmail("test.local@example.com")).toBe(false);
    expect(isTestAccountEmail("a@b@test.local")).toBe(false);
    expect(isTestAccountEmail("@test.local")).toBe(false);
  });

  it("refuses production or non-local databases", () => {
    const local = {
      NODE_ENV: "development",
      DATABASE_URL: "postgres://sf6:sf6@localhost:5433/sf6_tracker",
      APP_URL: "http://localhost:3000",
    };
    expect(() => assertLocalDevDatabase(local)).not.toThrow();
    expect(() => assertLocalDevDatabase({ ...local, NODE_ENV: "production" })).toThrow(
      /production/,
    );
    expect(() =>
      assertLocalDevDatabase({
        ...local,
        DATABASE_URL: "postgres://u:p@db.abcd.supabase.co:5432/postgres",
      }),
    ).toThrow(/not local/);
    expect(() =>
      assertLocalDevDatabase({ ...local, APP_URL: "https://tracker.example.com" }),
    ).toThrow(/not local/);
  });
});
