import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist/**",
    "drizzle/**",
    "scripts/research/.venv/**",
    "debug_output/**",
    "apps/*/dist/**",
    // Generated, git-ignored builds of local design tooling (e.g. the 5.6B1 showcase bundle).
    "design/**/out/**",
  ]),
]);

export default eslintConfig;
