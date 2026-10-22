/**
 * Phase 5.6C visual QA of the real FightSessionRecap variants (winning, losing, rating
 * unavailable, empty) from the B1 showcase's static recap gallery: 6 viewports × ES/EN plus 200 %
 * text and reduced motion. Checks: horizontal overflow and results-bar glyph collisions.
 *   pnpm exec tsx design/phase-5-6b1/showcase/build.mts && node design/phase-5-6b1/showcase/serve.mjs
 *   pnpm exec tsx design/phase-5-6c/gallery.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const OUT = "design/phase-5-6c/screenshots/full/gallery";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS: Array<[number, number]> = [
  [1920, 1080],
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [390, 844],
  [360, 800],
];
const findings: string[] = [];
let checks = 0;

async function inspect(p: Page, where: string) {
  checks++;
  const r = await p.evaluate(() => {
    const out: string[] = [];
    const d = document.documentElement;
    if (d.scrollWidth > d.clientWidth + 1) out.push(`horizontal overflow ${d.scrollWidth}`);
    const dl = document.querySelector("[data-testid='fs-session-results']");
    if (dl) {
      const box = (el: Element) => {
        const rg = document.createRange();
        rg.selectNodeContents(el);
        return rg.getBoundingClientRect();
      };
      const cells = Array.from(dl.children).map((c) => ({
        c: c.getBoundingClientRect(),
        b: Array.from(c.querySelectorAll("dt, dd")).map(box),
      }));
      cells.forEach((x, i) => {
        if (x.b.some((b) => b.left < x.c.left - 0.5 || b.right > x.c.right + 0.5))
          out.push(`cell ${i + 1} escapes`);
        cells.slice(i + 1).forEach((y) => {
          for (const a of x.b)
            for (const b of y.b)
              if (
                a.left < b.right - 0.5 &&
                b.left < a.right - 0.5 &&
                a.top < b.bottom - 0.5 &&
                b.top < a.bottom - 0.5
              )
                out.push(`cells overlap`);
        });
      });
    }
    return out;
  });
  r.forEach((f) => findings.push(`${where}: ${f}`));
}

const browser = await chromium.launch();
for (const which of ["winning", "losing", "unavailable", "empty"]) {
  for (const locale of ["es", "en"]) {
    const p = await browser.newPage();
    await p.addInitScript({ content: "window.__name = (f) => f;" });
    for (const [w, h] of locale === "es"
      ? VIEWPORTS
      : VIEWPORTS.filter(([w]) => w === 1440 || w === 390)) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`http://127.0.0.1:4174/recap-${which}-${locale}.html`);
      await p.evaluate(() => document.fonts.ready);
      await inspect(p, `${which} ${locale} ${w}×${h}`);
      await p.screenshot({ path: `${OUT}/${which}--${locale}--${w}x${h}.png`, fullPage: true });
    }
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`http://127.0.0.1:4174/recap-${which}-${locale}.html`);
    await p.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await inspect(p, `${which} ${locale} text 200%`);
    if (locale === "es")
      await p.screenshot({ path: `${OUT}/${which}--es--text200.png`, fullPage: true });
    await p.close();
  }
}
const rm = await browser.newContext({ reducedMotion: "reduce" });
const rp = await rm.newPage();
await rp.goto("http://127.0.0.1:4174/recap-winning-es.html");
const running = await rp.evaluate(
  () =>
    document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 5)
      .length,
);
if (running) findings.push(`reduced motion: ${running} running animations`);
await browser.close();
writeFileSync(
  "design/phase-5-6c/screenshots/gallery-report.json",
  JSON.stringify({ ranAt: new Date().toISOString(), checks, findings }, null, 2),
);
console.log(`${checks} checks, ${findings.length} findings`, findings.slice(0, 10));
