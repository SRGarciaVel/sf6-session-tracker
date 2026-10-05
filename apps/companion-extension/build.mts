/**
 * Build the unpacked MV3 extension into apps/companion-extension/dist (load it via
 * chrome://extensions → Developer mode → Load unpacked). esbuild only — no extra toolchain.
 *
 *   pnpm companion:build                                   dev: localhost/127.0.0.1:3000
 *   pnpm companion:dev                                     dev, rebuild on change
 *   COMPANION_TRACKER_ORIGINS=https://tracker.example.com pnpm companion:build:prod
 *
 * The tracker origins are a closed allowlist: they become exact manifest host_permissions and
 * the only URLs the popup offers (src/lib/tracker-origins.ts).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import {
  DEV_TRACKER_ORIGINS,
  hostPermissionsFor,
  parseTrackerOrigins,
} from "./src/lib/tracker-origins";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");
// Debug popup + exhaustive transport test: dev watch builds, or COMPANION_DEBUG=1 explicitly.
const debug = !production && (watch || process.env.COMPANION_DEBUG === "1");

const extra = parseTrackerOrigins(process.env.COMPANION_TRACKER_ORIGINS);
const trackerOrigins = production ? extra : [...new Set([...DEV_TRACKER_ORIGINS, ...extra])];
if (trackerOrigins.length === 0) {
  throw new Error(
    "Production build needs COMPANION_TRACKER_ORIGINS (e.g. https://tracker.example.com)",
  );
}
if (production && trackerOrigins.some((o) => !o.startsWith("https://"))) {
  throw new Error("Production tracker origins must be https");
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Single source of truth for the version the companion reports to the tracker (client.version). */
const manifestVersion = (
  JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { version: string }
).version;

const copyStatic = () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
  manifest.host_permissions = hostPermissionsFor(trackerOrigins);
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
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
  define: {
    __SF6_TRACKER_ORIGINS__: JSON.stringify(trackerOrigins),
    __SF6_COMPANION_DEBUG__: JSON.stringify(debug),
    __SF6_PRODUCTION__: JSON.stringify(production),
    __SF6_COMPANION_VERSION__: JSON.stringify(manifestVersion),
  },
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
  console.log(`tracker origins (host_permissions): ${trackerOrigins.join(", ")}`);
  console.log(`debug diagnostics: ${debug ? "ON" : "off"}`);
}
