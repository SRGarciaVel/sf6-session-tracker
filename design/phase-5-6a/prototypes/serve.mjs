/**
 * Local static server for the Phase 5.6A prototypes. Isolated from the SST app: no Next.js, no
 * database, no API — it only serves files, bound to 127.0.0.1.
 *
 *   node design/phase-5-6a/prototypes/serve.mjs        → http://127.0.0.1:4173/
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "../../..");
const PORT = Number(process.env.PORT ?? 4173);
const ROOTS = [
  ["/fonts/", join(REPO, "src/server/analytics/report/fonts")],
  ["/brand/", join(REPO, "public/brand")],
  ["/shots/", join(REPO, "design/phase-5-6a/screenshots")],
  ["/", HERE],
];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const [prefix, dir] = ROOTS.find(([p]) => path.startsWith(p));
  let file = normalize(join(dir, path.slice(prefix.length)));
  if (!file.startsWith(dir)) return void res.writeHead(403).end();
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
  } catch {
    return void res.writeHead(404).end("not found");
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`SST 5.6A prototypes → http://127.0.0.1:${PORT}/`));
