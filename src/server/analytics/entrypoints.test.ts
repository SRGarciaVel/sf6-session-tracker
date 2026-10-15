/**
 * Architectural guard for analytics ownership (no DB needed): analytics is reachable ONLY through
 * the dashboard page, which reads range/mode from the URL and the owner from the session.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("analytics entry points", () => {
  const app = files("src/app").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

  it("no API route exposes analytics", () => {
    const apiUsers = app.filter(
      (f) =>
        f.startsWith(join("src", "app", "api")) && readFileSync(f, "utf8").includes("analytics"),
    );
    expect(apiUsers).toEqual([]);
  });

  it("only the analytics page uses the service, with the session user and URL range/mode only", () => {
    // Runtime imports only (`import type { PlayerAnalytics }` in the view carries no code).
    const runtimeImport = /^import (?!type )[^;]*from "@\/server\/analytics\/service";/m;
    const users = app.filter((f) => runtimeImport.test(readFileSync(f, "utf8")));
    expect(users).toEqual([join("src", "app", "(app)", "dashboard", "analytics", "page.tsx")]);
    const page = readFileSync(users[0]!, "utf8");
    expect(page).toContain("parseAnalyticsSearchParams(await searchParams)");
    expect(page).toContain("getPlayerAnalyticsForUser(getDb(), user.id, query)");
    expect(page).not.toMatch(/playerId|params\.(player|user)/);
  });
});
