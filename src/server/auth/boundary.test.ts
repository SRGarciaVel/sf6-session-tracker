/**
 * Phase 4.6 structural guarantees: one session gate, one email provider seam, no server email
 * code in client bundles.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const SRC = files("src").filter((f) => !/\.test\.tsx?$/.test(f));
const read = (f: string) => readFileSync(f, "utf8");

describe("auth boundaries", () => {
  it("sessions are only read through getVerifiedSession()", () => {
    const offenders = SRC.filter(
      (f) => read(f).includes("api.getSession(") && !f.endsWith("verified-session.ts"),
    );
    expect(offenders).toEqual([]);
  });

  it("the Resend SDK is only imported by the email sender", () => {
    const offenders = SRC.filter(
      (f) => /from "resend"|import\("resend"\)/.test(read(f)) && !f.endsWith("email/sender.ts"),
    );
    expect(offenders).toEqual([]);
  });

  it("client components never import server email/env/auth modules", () => {
    const offenders = SRC.filter((f) => {
      const s = read(f);
      return /^["']use client["']/.test(s) && /@\/server\/(email|env|auth)/.test(s);
    });
    expect(offenders).toEqual([]);
  });

  it("Creator Key redemption and onboarding authorize through getCurrentUser (verified gate)", () => {
    const dash = read("src/app/(app)/dashboard/actions.ts");
    const redeem = dash.slice(dash.indexOf("export async function redeemCreatorKeyAction"));
    expect(redeem.slice(0, 800)).toMatch(/getCurrentUser\(\)|authorizedPlayer\(\)/);
    expect(read("src/app/(app)/onboarding/actions.ts")).toMatch(
      /getCurrentUser\(\)|requireUser\(\)/,
    );
    expect(read("src/server/auth/session.ts")).toContain("getVerifiedSession(");
  });
});
