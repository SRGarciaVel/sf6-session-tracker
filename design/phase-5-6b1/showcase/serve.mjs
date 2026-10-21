/** Local static server for the built showcase (127.0.0.1 only, files in ./out only). */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const PORT = Number(process.env.PORT ?? 4174);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".ttf": "font/ttf",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file = normalize(join(OUT, path));
  if (!file.startsWith(OUT)) return void res.writeHead(403).end();
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
}).listen(PORT, "127.0.0.1", () =>
  console.log(`Fight Session showcase → http://127.0.0.1:${PORT}/ (ES) · /en.html (EN)`),
);
