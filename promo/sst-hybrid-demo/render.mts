/**
 * Renders the composition frame by frame (headless Chromium) straight into ffmpeg.
 *
 *   tsx promo/sst-hybrid-demo/render.mts h            → out/sst-demo-hybrid-16x9.mp4
 *   tsx promo/sst-hybrid-demo/render.mts v            → out/sst-demo-hybrid-9x16.mp4
 *   tsx promo/sst-hybrid-demo/render.mts h --stills 3,10,23   → out/stills/h-003.0s.png …
 *
 * H.264 (libx264, High, yuv420p, CRF 18), 30 fps CFR, +faststart. The audio track is generated
 * silence (anullsrc) as a slot for licensed music; see README.md.
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = "promo/sst-hybrid-demo";
const layout = process.argv[2] === "v" ? "v" : "h";
const stillsArg = process.argv.indexOf("--stills");
const stills = stillsArg > 0 ? process.argv[stillsArg + 1]!.split(",").map(Number) : null;
const [W, H] = layout === "v" ? [1080, 1920] : [1920, 1080];
const name = layout === "v" ? "9x16" : "16x9";
const out = `${ROOT}/out/sst-demo-hybrid-${name}.mp4`;
mkdirSync(`${ROOT}/out/stills`, { recursive: true });

const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("requestfailed", (r) => errors.push(`failed: ${r.url()}`));
await page.goto(
  `${pathToFileURL(resolve(`${ROOT}/composition/index.html`)).href}?layout=${layout}`,
);
await page.waitForFunction(
  () => (window as unknown as { ready?: Promise<boolean> }).ready !== undefined,
);
await page.evaluate("window.ready");
if (errors.length) throw new Error(errors.join("\n"));
const total = (await page.evaluate("window.TOTAL_FRAMES")) as number;
const draw = (f: number) => page.evaluate(`window.render(${f})`);

if (stills) {
  for (const s of stills) {
    await draw(Math.round(s * 30));
    const path = `${ROOT}/out/stills/${layout}-${s.toFixed(1).padStart(4, "0")}s.png`;
    await page.screenshot({ path });
    console.log(path);
  }
  await browser.close();
  process.exit(0);
}

const ffArgs = [
  "-y -loglevel error",
  "-f image2pipe -framerate 30 -c:v png -i -",
  "-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000",
  "-map 0:v -map 1:a -shortest",
  "-c:v libx264 -preset slow -crf 18 -profile:v high -pix_fmt yuv420p -r 30 -g 60",
  "-colorspace bt709 -color_primaries bt709 -color_trc bt709",
  "-c:a aac -b:a 128k -movflags +faststart",
].flatMap((a) => a.split(" "));
const ff = spawn("ffmpeg", [...ffArgs, out], { stdio: ["pipe", "inherit", "inherit"] });
const done = new Promise<number>((r) => ff.on("close", (c) => r(c ?? 1)));
const started = Date.now();
for (let f = 0; f < total; f++) {
  await draw(f);
  const png = await page.screenshot({ type: "png" });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 150 === 0)
    console.log(`frame ${f}/${total} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
ff.stdin.end();
await browser.close();
const code = await done;
if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
console.log(`wrote ${out}`);
