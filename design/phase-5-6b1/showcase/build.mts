/**
 * Builds the isolated Fight Session showcase into ./out (git-ignored): server-rendered HTML per
 * locale (the components' SSR path), a browser bundle that HYDRATES that markup, and the app's
 * real stylesheet compiled with Tailwind. No Next.js route, no database, no network.
 *
 *   pnpm exec tsx design/phase-5-6b1/showcase/build.mts
 *   node design/phase-5-6b1/showcase/serve.mjs      → http://127.0.0.1:4174/
 */
// Deterministic server render of times (the browser QA runs in UTC too).
process.env.TZ = "UTC";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Root, type ShowcaseLocale } from "./Root";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const OUT = join(HERE, "out");
mkdirSync(join(OUT, "fonts"), { recursive: true });

// 1. Fonts (the same OFL files the PDF report uses).
const FONTS = join(REPO, "src/server/analytics/report/fonts");
for (const f of readdirSync(FONTS).filter((f) => f.endsWith(".ttf")))
  copyFileSync(join(FONTS, f), join(OUT, "fonts", f));

// 2. CSS: globals.css + fs-* through the app's own Tailwind plugin.
const tailwindRequire = createRequire(
  createRequire(import.meta.url).resolve("@tailwindcss/postcss"),
);
// postcss is a dependency of @tailwindcss/postcss (not a direct one): typed minimally here.
type Processor = { process(css: string, opts: { from: string }): Promise<{ css: string }> };
const postcss = tailwindRequire("postcss") as (plugins: unknown[]) => Processor;
const tailwind = tailwindRequire("@tailwindcss/postcss") as () => unknown;
const cssIn = join(HERE, "showcase.css");
const css = await postcss([tailwind()]).process(readFileSync(cssIn, "utf8"), { from: cssIn });
writeFileSync(join(OUT, "app.css"), css.css);

// 3. Browser bundle (hydrates the server markup).
await build({
  entryPoints: [join(HERE, "entry.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  outfile: join(OUT, "app.js"),
  tsconfig: join(REPO, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

// 4. Server-rendered HTML per locale.
for (const locale of ["es", "en"] as ShowcaseLocale[]) {
  const html = renderToString(createElement(Root, { locale }));
  writeFileSync(
    join(OUT, locale === "es" ? "index.html" : "en.html"),
    `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Fight Session foundation — SST 5.6B1 showcase</title>
    <link rel="stylesheet" href="./app.css" />
  </head>
  <body>
    <div id="root">${html}</div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`,
  );
}
// 5. Phase 5.6C: static recap gallery (server-rendered only; no script needed).
const { RECAPS, RecapPage } = await import("./RecapGallery");
for (const locale of ["es", "en"] as ShowcaseLocale[])
  for (const which of Object.keys(RECAPS) as Array<keyof typeof RECAPS>)
    writeFileSync(
      join(OUT, `recap-${which}-${locale}.html`),
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Recap ${which}</title><link rel="stylesheet" href="./app.css" /></head><body>${renderToString(createElement(RecapPage, { locale, which }))}</body></html>\n`,
    );
console.log(`showcase built → ${OUT}`);
