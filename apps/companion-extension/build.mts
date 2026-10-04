/**
 * Build the unpacked MV3 extension into apps/companion-extension/dist (load it via
 * chrome://extensions → Developer mode → Load unpacked). esbuild only — no extra toolchain.
 *
 *   pnpm companion:build
 *   pnpm companion:dev      (rebuild on change)
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const copyStatic = () => {
  cpSync(join(root, "manifest.json"), join(out, "manifest.json"));
  cpSync(join(root, "_locales"), join(out, "_locales"), { recursive: true });
  cpSync(join(root, "src/popup/popup.html"), join(out, "popup.html"));
  cpSync(join(root, "src/popup/popup.css"), join(out, "popup.css"));
};

const options: esbuild.BuildOptions = {
  entryPoints: {
    background: join(root, "src/background.ts"),
    popup: join(root, "src/popup/popup.ts"),
  },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome120",
  platform: "browser",
  tsconfig: join(root, "tsconfig.json"),
  // MV3: everything is bundled locally; no remote code, no eval.
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
  plugins: [{ name: "static", setup: (b) => b.onEnd(copyStatic) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching apps/companion-extension …");
} else {
  await esbuild.build(options);
  console.log(`built → ${out}`);
}
