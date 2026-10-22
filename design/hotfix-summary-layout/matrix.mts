/**
 * Hotfix QA — measures every SessionResults case of the showcase's stress matrix (real component,
 * real globals.css) at 10 container widths, ES and EN: each value's TEXT box (DOM Range) must stay
 * inside its own cell and never intersect another value. Needs the B1 showcase built and served:
 *   pnpm exec tsx design/phase-5-6b1/showcase/build.mts && node design/phase-5-6b1/showcase/serve.mjs
 *   pnpm exec tsx design/hotfix-summary-layout/matrix.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = "design/hotfix-summary-layout/screenshots/full/matrix";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const report: Record<string, { cases: number; findings: string[] }> = {};
for (const [locale, path] of [
  ["es", "/"],
  ["en", "/en.html"],
] as const) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript({ content: "window.__name = (f) => f;" });
  await page.goto(`http://127.0.0.1:4174${path}`);
  await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(() => {
    const findings: string[] = [];
    const boxes = Array.from(document.querySelectorAll<HTMLElement>("[data-matrix]"));
    const textBox = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    };
    for (const box of boxes) {
      const id = box.dataset.matrix!;
      const dl = box.querySelector("dl")!;
      if (dl.scrollWidth > dl.clientWidth + 1) findings.push(`${id}: scrolls horizontally`);
      const cells = Array.from(dl.children) as HTMLElement[];
      const values = cells.map((cell) => ({
        cell,
        boxes: Array.from(cell.querySelectorAll("dd, dt")).map(textBox),
      }));
      for (const v of values) {
        const c = v.cell.getBoundingClientRect();
        if (v.boxes.some((b) => b.left < c.left - 0.5 || b.right > c.right + 0.5))
          findings.push(`${id}: text escapes «${v.cell.querySelector("dt")?.textContent}»`);
      }
      for (let i = 0; i < values.length; i++)
        for (let j = i + 1; j < values.length; j++)
          for (const a of values[i]!.boxes)
            for (const b of values[j]!.boxes)
              if (
                a.left < b.right - 0.5 &&
                b.left < a.right - 0.5 &&
                a.top < b.bottom - 0.5 &&
                b.top < a.bottom - 0.5
              )
                findings.push(`${id}: cells ${i + 1} and ${j + 1} overlap`);
    }
    return { cases: boxes.length, findings };
  });
  report[locale] = result;
  for (const id of [
    "reported-33-3--24lp",
    "five-digit-lp-large-positive",
    "long-name-mr",
    "missing-rating",
    "zero-games",
  ])
    await page
      .locator(`[data-matrix^="${id}@"]`)
      .first()
      .locator("xpath=../..")
      .screenshot({ path: `${OUT}/${locale}--${id}.png` });
  await page.close();
}
await browser.close();
writeFileSync(
  "design/hotfix-summary-layout/screenshots/matrix-report.json",
  JSON.stringify({ ranAt: new Date().toISOString(), report }, null, 2),
);
for (const [k, v] of Object.entries(report))
  console.log(`${k}: ${v.cases} cases, ${v.findings.length} findings`, v.findings.slice(0, 10));
