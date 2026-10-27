/**
 * PROTOTYPE — local portrait pages in REAL Chromium (Playwright) against a LOCAL production
 * build. This is NOT OBS: it shows what holds in a standard Chromium profile, so the real-OBS
 * checklist (design/phase-m2/local-portrait-prototype.md) can focus on what only OBS can answer.
 *
 *   gate     server started WITHOUT SST_PROTOTYPE_PAGES ⇒ both pages 404
 *   run      server started WITH SST_PROTOTYPE_PAGES=1 ⇒ dock/source behaviour (below)
 *
 *   IMAGES=/path/to/synthetic-images pnpm exec tsx design/phase-m2/e2e/local-portrait.e2e.mts <gate|run>
 *
 * IMAGES must contain synthetic test files only (test-a.png, test-b.png, fake.png, too-big.png,
 * too-wide.png); no character artwork.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const APP = "http://localhost:3171";
const DOCK = `${APP}/prototype/obs-portrait/dock`;
const SOURCE = `${APP}/prototype/obs-portrait/source`;
const IMAGES = process.env.IMAGES ?? "";
const OUT = "design/phase-m2/screenshots/full/local-portrait";
const PHASE = process.argv[2] ?? "";
if (!["localhost", "127.0.0.1"].includes(new URL(APP).hostname)) throw new Error("REFUSING");
mkdirSync(OUT, { recursive: true });

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const status = (p: Page) => p.locator('[data-testid="status"]').getAttribute("data-state");
const sourceState = (p: Page) => p.locator(".lp-source").getAttribute("data-state");
const sourceDecoded = (p: Page) =>
  p.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".lp-source img");
    return img ? { w: img.naturalWidth, src: img.src.slice(0, 5) } : null;
  });
/** Center pixel of the rendered image (to tell test-a from test-b). */
const centerColor = (p: Page) =>
  p.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".lp-source img");
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const [r, gr, b] = g.getImageData(64, 200, 1, 1).data;
    return `${r},${gr},${b}`;
  });

async function gate() {
  for (const url of [DOCK, SOURCE]) {
    const res = await fetch(url);
    check(
      `without SST_PROTOTYPE_PAGES: ${new URL(url).pathname} → 404`,
      res.status === 404,
      String(res.status),
    );
  }
}

async function pages(ctx: BrowserContext) {
  const dock = await ctx.newPage();
  const source = await ctx.newPage();
  await source.setViewportSize({ width: 160, height: 160 });
  return { dock, source };
}

async function run() {
  // A persistent profile: closing and relaunching it stands in for restarting the app.
  const profile = mkdtempSync(join(tmpdir(), "sst-lp-profile-"));
  let ctx = await chromium.launchPersistentContext(profile, {
    viewport: { width: 640, height: 900 },
  });
  const requests: Array<{ method: string; url: string; hasBody: boolean }> = [];
  const cspViolations: string[] = [];
  ctx.on("request", (r) =>
    requests.push({ method: r.method(), url: r.url(), hasBody: !!r.postDataBuffer() }),
  );
  let { dock, source } = await pages(ctx);
  for (const p of [dock, source])
    p.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
    });

  const res = await dock.goto(DOCK);
  const csp = res?.headers()["content-security-policy"] ?? "";
  check(
    "dock served (flag on) with the unchanged CSP",
    res?.status() === 200 && csp.includes("img-src 'self' data: blob:"),
    csp.slice(0, 80),
  );
  const sres = await source.goto(SOURCE);
  check(
    "source served with the same img-src policy",
    sres?.status() === 200 &&
      (sres?.headers()["content-security-policy"] ?? "").includes("img-src 'self' data: blob:"),
  );
  await dock.waitForFunction(
    () => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "ready",
  );
  check(
    "dock: empty state",
    (await dock.locator('[data-testid="status"]').textContent()) ===
      "No hay ninguna imagen guardada." ||
      (await dock.locator('[data-testid="status"]').textContent()) === "No image saved.",
  );
  check(
    "source: empty and transparent",
    (await sourceState(source)) === "empty" &&
      (await source.locator(".lp-source").textContent()) === "",
  );
  await source.screenshot({ path: `${OUT}/source-empty-160.png`, omitBackground: true });

  // Invalid inputs.
  for (const [f, expected] of [
    ["fake.png", "invalid"],
    ["too-big.png", "invalid"],
    ["too-wide.png", "invalid"],
  ] as const) {
    await dock.setInputFiles('[data-testid="file"]', join(IMAGES, f));
    await dock.waitForFunction(
      (s) => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === s,
      expected,
    );
    check(
      `dock refuses ${f}`,
      (await status(dock)) === "invalid",
      (await dock.locator('[data-testid="status"]').textContent()) ?? "",
    );
  }
  check("source still empty after refusals", (await sourceState(source)) === "empty");

  // Save: real decode, then the OTHER page updates without reload (BroadcastChannel).
  const before = requests.length;
  await dock.setInputFiles('[data-testid="file"]', join(IMAGES, "test-a.png"));
  await dock.waitForFunction(
    () => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "saved",
  );
  check(
    "dock: real image decoded and previewed",
    (await dock
      .locator('[data-testid="preview"] img')
      .evaluate((i: HTMLImageElement) => i.naturalWidth)) === 256,
    (await dock.locator('[data-testid="meta"]').textContent()) ?? "",
  );
  await source.waitForFunction(
    () => document.querySelector(".lp-source")?.getAttribute("data-state") === "image",
    null,
    { timeout: 5_000 },
  );
  const decoded = await sourceDecoded(source);
  check(
    "source (separate page, same profile) shows it via its own blob: URL, no reload",
    decoded?.w === 256 && decoded.src === "blob:",
    JSON.stringify(decoded),
  );
  const colorA = await centerColor(source);
  await source.screenshot({ path: `${OUT}/source-a-160.png`, omitBackground: true });
  await dock.screenshot({ path: `${OUT}/dock-saved.png`, fullPage: true });
  const during = requests.slice(before);
  check(
    "no request carried the image (no POST/PUT, no body)",
    during.every((r) => r.method === "GET" && !r.hasBody),
    `${during.length} requests: ${[...new Set(during.map((r) => `${r.method} ${new URL(r.url).pathname}`))].join(", ")}`,
  );

  // Replace.
  await dock.setInputFiles('[data-testid="file"]', join(IMAGES, "test-b.png"));
  await dock.waitForFunction(
    () => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "saved",
  );
  await source.waitForFunction(
    (a) => {
      const img = document.querySelector<HTMLImageElement>(".lp-source img");
      if (!img || !img.complete) return false;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      const [r, gr, b] = g.getImageData(64, 200, 1, 1).data;
      return `${r},${gr},${b}` !== a;
    },
    colorA,
    { timeout: 5_000 },
  );
  const colorB = await centerColor(source);
  check("replace: the source shows the new image", colorA !== colorB, `${colorA} → ${colorB}`);

  // Persistence: reload the source; then restart the whole browser profile.
  await source.reload();
  await source.waitForFunction(
    () => document.querySelector(".lp-source")?.getAttribute("data-state") === "image",
  );
  check("persists after reloading the source", (await centerColor(source)) === colorB);
  await ctx.close();
  ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 640, height: 900 } });
  ({ dock, source } = await pages(ctx));
  await source.goto(SOURCE);
  await source.waitForFunction(
    () => document.querySelector(".lp-source")?.getAttribute("data-state") === "image",
  );
  check("persists after restarting the browser profile", (await centerColor(source)) === colorB);

  // Overlay-like dimensions.
  for (const [w, h] of [
    [160, 160],
    [320, 180],
    [96, 96],
  ] as const) {
    await source.setViewportSize({ width: w, height: h });
    await source.waitForTimeout(150);
    const box = await source.locator(".lp-source img").boundingBox();
    const overflow = await source.evaluate(
      () =>
        document.documentElement.scrollWidth -
        innerWidth +
        (document.documentElement.scrollHeight - innerHeight),
    );
    check(
      `fits ${w}×${h}: square of min side, centred, no overflow`,
      !!box && Math.round(box.width) === Math.min(w, h) && overflow <= 0,
      JSON.stringify(box),
    );
    await source.screenshot({ path: `${OUT}/source-b-${w}x${h}.png`, omitBackground: true });
  }

  // Delete.
  await dock.goto(DOCK);
  await dock.waitForFunction(
    () => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "ready",
  );
  await dock.locator('[data-testid="delete"]').click();
  await dock.waitForFunction(
    () =>
      document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "deleted",
  );
  await source.waitForFunction(
    () => document.querySelector(".lp-source")?.getAttribute("data-state") === "empty",
    null,
    { timeout: 5_000 },
  );
  check(
    "delete: the source goes back to empty without reload",
    (await sourceState(source)) === "empty",
  );

  // Another profile (like the user's normal browser vs OBS) does not see this profile's data.
  await dock.setInputFiles('[data-testid="file"]', join(IMAGES, "test-a.png"));
  await dock.waitForFunction(
    () => document.querySelector('[data-testid="status"]')?.getAttribute("data-state") === "saved",
  );
  const other = await chromium.launch();
  const op = await other.newPage();
  await op.goto(SOURCE);
  await op.waitForFunction(() =>
    ["empty", "error"].includes(
      document.querySelector(".lp-source")?.getAttribute("data-state") ?? "",
    ),
  );
  check(
    "a different browser profile does not see it (isolation)",
    (await sourceState(op)) === "empty",
  );
  await other.close();

  check(
    "no CSP violation reported",
    cspViolations.length === 0,
    cspViolations.join(" | ").slice(0, 200),
  );
  await ctx.close();
  writeFileSync(
    `${OUT}/checks.json`,
    JSON.stringify(
      { ranAt: new Date().toISOString(), environment: "Playwright Chromium (NOT OBS)", results },
      null,
      2,
    ),
  );
}

if (PHASE === "gate") await gate();
else if (PHASE === "run") await run();
else throw new Error("phase: gate | run");
if (results.some((r) => !r.pass)) process.exitCode = 1;
