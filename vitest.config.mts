import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@sf6\/capcom-core$/,
        replacement: fileURLToPath(
          new URL("./packages/sf6-capcom-core/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@sf6\/capcom-core\/(.*)$/,
        replacement: fileURLToPath(new URL("./packages/sf6-capcom-core/src/$1", import.meta.url)),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
  },
});
