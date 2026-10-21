/**
 * Phase 5.6A — prototype QA (Chromium/Playwright). Requires the static server:
 *   node design/phase-5-6a/prototypes/serve.mjs
 *   pnpm exec tsx design/phase-5-6a/prototypes/qa.mts
 *
 * 1. Screenshots: every direction × scenario × viewport (1440×900, 1280×720, 390×844).
 * 2. Checks per screenshot: page errors, horizontal overflow, clipped text (scrollWidth > width on
 *    text elements), hit targets < 24 px, images without alt.
 * 3. Interaction flow through the real buttons: start → 3 matches (pending → confirmed) → end
 *    (confirm, Esc cancels) → recap → prepare another; Companion off blocks the start.
 * 4. Keyboard: Tab order of the first stops; reduced motion: no running animations.
 * Writes design/phase-5-6a/screenshots/prototypes/ and qa-report.json next to them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4173";
const OUT = "design/phase-5-6a/screenshots/prototypes";
mkdirSync(OUT, { recursive: true });
const DIRS = ["broadcast-control", "fight-session"] as const;
const SCENARIOS = [
  "prepare-first",
  "prepare",
  "prepare-offline",
  "live-empty",
  "live",
  "live-pending",
  "live-offline",
  "recap",
  "recap-norating",
  "recap-empty",
];
const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["laptop", 1280, 720],
  ["mobile", 390, 844],
] as const;

type Issue = { where: string; kind: string; detail: string };
const issues: Issue[] = [];
const flows: Record<string, string[]> = {};

async function audit(p: Page, where: string) {
  const r = await p.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth)
      out.push({ kind: "overflow-x", detail: `${document.documentElement.scrollWidth}px` });
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("#app *"))) {
      const cs = getComputedStyle(el);
      if (
        cs.visibility === "hidden" ||
        cs.display === "none" ||
        el.closest(".ghost,svg,.lab,.sr-only")
      )
        continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (own && cs.overflow !== "visible" && el.scrollWidth > el.clientWidth + 1)
        out.push({ kind: "clipped-text", detail: el.textContent!.trim().slice(0, 40) });
      if (el.matches("button, a, select, summary")) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && (b.width < 24 || b.height < 24))
          out.push({
            kind: "small-target",
            detail: `${el.textContent!.trim().slice(0, 30)} ${b.width}×${b.height}`,
          });
      }
    }
    for (const img of Array.from(document.images))
      if (!img.hasAttribute("alt")) out.push({ kind: "img-alt", detail: img.src });
    return out;
  });
  r.forEach((i) => issues.push({ where, ...i }));
}

const browser = await chromium.launch();
for (const dir of DIRS) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on("pageerror", (e) => issues.push({ where: dir, kind: "pageerror", detail: e.message }));
  for (const [vp, w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    const shoot = async (hash: string, name: string) => {
      await p.goto(`${BASE}/${dir}/#${hash}&lab=hide`);
      await p.reload();
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(250);
      await audit(p, `${dir}/${name}@${vp}`);
      await p.screenshot({
        path: `${OUT}/${dir}--${name}--${vp}.png`,
        fullPage: true,
        animations: "disabled",
      });
    };
    for (const sc of SCENARIOS) await shoot(`scenario=${sc}`, sc);
    await shoot("scenario=live&view=overlays", "overlays");
    if (vp !== "laptop") {
      await shoot("scenario=live&lang=en", "live-en");
      await shoot("scenario=recap&lang=en", "recap-en");
    }
  }

  /* Interaction flow through real controls (desktop, prototype controls visible). */
  const log: string[] = [];
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${BASE}/${dir}/#scenario=prepare-offline`);
  await p.reload();
  const start = p.locator('[data-k="start"]');
  log.push(`offline: start disabled = ${await start.isDisabled()}`);
  await p.locator('[data-k="retry"]').click();
  log.push(`after reconnection: start disabled = ${await start.isDisabled()}`);
  await start.click();
  await p.locator('[data-k="ask-end"]').waitFor();
  log.push("start → live");
  await p.screenshot({ path: `${OUT}/${dir}--flow-1-started--desktop.png` });
  const ingest = (r: string) => p.locator(`[data-lab="ingest:${r}"]`).click();
  await ingest("win");
  await p.waitForTimeout(250);
  const pendingShown = await p
    .getByText(/MR pendiente/)
    .first()
    .isVisible();
  log.push(`match 1 ingested; rating pending visible = ${pendingShown}`);
  await p.screenshot({ path: `${OUT}/${dir}--flow-2-match-pending--desktop.png` });
  await p.waitForTimeout(2000);
  log.push(
    `after profile: pending visible = ${await p
      .getByText(/MR pendiente/)
      .first()
      .isVisible()
      .catch(() => false)}`,
  );
  await ingest("loss");
  await p.waitForTimeout(2100);
  await ingest("win");
  await p.waitForTimeout(2100);
  const text = await p.locator("#app").innerText();
  log.push(`3 matches: shows 66,7 % = ${text.includes("66,7")}`);
  await p.screenshot({ path: `${OUT}/${dir}--flow-3-three-matches--desktop.png` });
  await p.locator('[data-k="ask-end"]').click();
  log.push(
    `end asked: focus on = ${await p.evaluate(() => document.activeElement?.getAttribute("data-k"))}`,
  );
  await p.keyboard.press("Escape");
  log.push(
    `Esc cancels: confirm visible = ${await p
      .locator('[data-k="confirm-end"]')
      .isVisible()
      .catch(() => false)}`,
  );
  await p.locator('[data-k="ask-end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.locator('[data-k="again"]').waitFor();
  log.push(
    `end → recap; recap shows 3 games = ${(await p.locator("#app").innerText()).includes("66,7")}`,
  );
  await p.screenshot({ path: `${OUT}/${dir}--flow-4-recap--desktop.png` });
  await p.locator('[data-k="again"]').click();
  await p.waitForTimeout(100);
  log.push(
    `prepare another: focus on = ${await p.evaluate(() => document.activeElement?.getAttribute("data-k"))}`,
  );
  await p.locator('[data-k="nav-ov"]').click();
  log.push(`overlays view reached = ${await p.locator('[data-k="back-dash"]').isVisible()}`);

  /* Keyboard: first stops from the top of a fresh prepare page. */
  await p.goto(`${BASE}/${dir}/#scenario=prepare&lab=hide`);
  await p.reload();
  const order: string[] = [];
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press("Tab");
    order.push(
      await p.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return `${el.getAttribute("data-k") ?? el.tagName.toLowerCase()}`;
      }),
    );
    if (i === 4) await p.screenshot({ path: `${OUT}/${dir}--focus--desktop.png` });
  }
  log.push(`tab order: ${order.join(" → ")}`);
  flows[dir] = log;
  await ctx.close();

  /* Reduced motion: an event must not leave animations running. */
  const rm = await browser.newContext({ reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`${BASE}/${dir}/#scenario=live`);
  await rp.reload();
  await rp.locator('[data-lab="ingest:win"]').click();
  const running = await rp.evaluate(
    () =>
      document.getAnimations().filter((a) => (a.effect?.getComputedTiming().duration as number) > 5)
        .length,
  );
  flows[dir].push(`reduced motion: animations longer than 5 ms after a match = ${running}`);
  await rm.close();
}
await browser.close();

const summary = issues.reduce<Record<string, number>>(
  (acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc),
  {},
);
writeFileSync(
  `${OUT}/../qa-report.json`,
  JSON.stringify({ ranAt: new Date().toISOString(), summary, issues, flows }, null, 2),
);
console.log(JSON.stringify({ summary, flows }, null, 2));
