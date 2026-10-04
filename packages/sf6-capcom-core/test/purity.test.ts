import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url);

/** The shared core must stay runnable in a browser extension AND on the server. */
describe("@sf6/capcom-core purity", () => {
  it("imports nothing but zod and its own modules (no node:, @/, next, db, env, chrome)", () => {
    for (const file of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
      // Comments may mention chrome.alarms etc.; only code is checked.
      const text = readFileSync(new URL(file, SRC), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const specifiers = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        expect(spec === "zod" || spec?.startsWith("./"), `${file} imports ${spec}`).toBe(true);
      }
      expect(text, file).not.toMatch(/\bchrome\.|process\.env|document\.cookie|require\(/);
    }
  });
});
