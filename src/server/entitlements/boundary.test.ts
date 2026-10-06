/**
 * Architecture guard: entitlements have ONE source of truth on the server.
 *  - client components never import the entitlements service (no client-side authority);
 *  - nothing outside the entitlements modules compares plan ids ("creator_beta" checks
 *    scattered across features); features read typed entitlements instead.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");
const ALLOWED = new Set([
  "src/domain/entitlements/plans.ts",
  "src/server/entitlements/service.ts",
  "src/server/db/schema.ts", // CHECK constraint values
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = sources(join(ROOT, "src")).map((f) => ({
  path: relative(ROOT, f).split("\\").join("/"),
  text: readFileSync(f, "utf8"),
}));

describe("entitlements boundary", () => {
  it("no client component imports the entitlements service", () => {
    const offenders = files.filter(
      (f) => /^\s*["']use client["']/m.test(f.text) && f.text.includes("@/server/entitlements"),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("plan ids are only interpreted inside the entitlements modules", () => {
    const offenders = files.filter(
      (f) =>
        !ALLOWED.has(f.path) &&
        /["'](creator_beta|free)["']\s*[!=]==|[!=]==\s*["'](creator_beta|free)["']/.test(f.text),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});
