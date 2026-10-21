/**
 * Visual / interaction QA of the Fight Session showcase (Chromium). Requires a built showcase
 * and its server:
 *   pnpm exec tsx design/phase-5-6b1/showcase/build.mts
 *   node design/phase-5-6b1/showcase/serve.mjs
 *   pnpm exec tsx design/phase-5-6b1/showcase/qa.mts
 *
 * Per locale × viewport (1440×900, 1280×720, 390×844): page + hydration errors, horizontal
 * overflow, clipped text, touch targets < 24 px, per-section screenshots. Then: keyboard flow of
 * the interactive section (Tab → Enter start → simulate → End → Esc → End → confirm), visible
 * focus on clipped controls, mobile reachability of the primary action, reduced motion.
 * Output: design/phase-5-6b1/screenshots/full/ (git-ignored) + qa-report.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const BASE = "http://127.0.0.1:4174";
const OUT = "design/phase-5-6b1/screenshots/full";
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["laptop", 1280, 720],
  ["mobile", 390, 844],
] as const;
const SECTIONS = [
  "prepare",
  "prepare-off",
  "live",
  "live-pending",
  "live-empty",
  "recap",
  "recap-norating",
  "recap-empty",
  "lp",
  "controls",
  "overlays",
];

type Issue = { where: string; kind: string; detail: string };
const issues: Issue[] = [];
const flow: string[] = [];

async function open(p: Page, path: string) {
  await p.goto(`${BASE}${path}`);
  await p.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const hydration = await p.evaluate(() => window.__fsHydrationErrors);
  hydration.forEach((h) => issues.push({ where: path, kind: "hydration", detail: h }));
}

async function audit(p: Page, where: string) {
  const found = await p.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth)
      out.push({ kind: "overflow-x", detail: `${doc.scrollWidth}px` });
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("#root *"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.closest(".sr-only")) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
      // `truncate` is an intended ellipsis (full text stays in the DOM / accessible name).
      if (
        own &&
        !el.classList.contains("truncate") &&
        el.scrollWidth > el.clientWidth + 1 &&
        cs.overflow !== "visible"
      )
        out.push({ kind: "clipped-text", detail: el.textContent!.trim().slice(0, 50) });
      if (el.matches("button, a, summary, input, select")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.width < 24 || r.height < 24))
          out.push({
            kind: "small-target",
            detail: `${el.textContent!.trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`,
          });
      }
    }
    return out;
  });
  found.forEach((f) => issues.push({ where, ...f }));
}

const browser = await chromium.launch();
for (const locale of ["es", "en"] as const) {
  for (const [vp, w, h] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, timezoneId: "UTC" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) =>
      issues.push({ where: `${locale}@${vp}`, kind: "pageerror", detail: e.message }),
    );
    p.on("console", (m) => {
      if (m.type() === "error")
        issues.push({ where: `${locale}@${vp}`, kind: "console", detail: m.text() });
    });
    await open(p, locale === "es" ? "/" : "/en.html");
    await audit(p, `${locale}@${vp}`);
    await p.screenshot({
      path: `${OUT}/${locale}--${vp}--page.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (locale === "es" || vp !== "laptop")
      for (const id of SECTIONS)
        await p
          .locator(`#${id}`)
          .screenshot({ path: `${OUT}/${locale}--${vp}--${id}.png`, animations: "disabled" });

    if (vp === "mobile") {
      // The primary action stays reachable: the bar is fixed to the bottom of the viewport.
      const start = p.locator('[data-testid="lifecycle"] [data-k="start"]');
      const box = await start.boundingBox();
      flow.push(
        `${locale} mobile: lifecycle start inside the viewport without scrolling = ${!!box && box.y + box.height <= h && box.y >= 0}`,
      );
    }
    await ctx.close();
  }
}

/* Keyboard flow (desktop, ES) through the interactive section. */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: "UTC",
  });
  const p = await ctx.newPage();
  await open(p, "/");
  const life = p.locator('[data-testid="lifecycle"]');
  await life.locator('[data-k="start"]').focus();
  const focusShadow = await p.evaluate(
    () => getComputedStyle(document.activeElement as Element).boxShadow,
  );
  flow.push(`focus on clipped CTA draws an inset ring = ${focusShadow.includes("inset")}`);
  await life.locator('[data-k="start"]').scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/focus-cta--desktop.png`, clip: (await life.boundingBox())! });
  await p.keyboard.press("Enter");
  await life.locator('[data-k="end"]').waitFor();
  flow.push("Enter on start → live (local state)");
  for (let i = 0; i < 3; i++) await life.locator('[data-k="simulate"]').click();
  flow.push(
    `3 simulated matches → scoreboard shows 66,7 % = ${(await life.innerText()).includes("66,7")}`,
  );
  await life.locator('[data-k="end"]').focus();
  await p.keyboard.press("Enter");
  flow.push(
    `End → focus on = ${await p.evaluate(() => document.activeElement?.getAttribute("data-k"))}`,
  );
  await p.keyboard.press("Escape");
  flow.push(
    `Esc → focus back on = ${await p.evaluate(() => document.activeElement?.getAttribute("data-k"))}`,
  );
  await p.keyboard.press("Enter");
  await p.keyboard.press("Tab");
  flow.push(
    `Tab from «Seguir jugando» → ${await p.evaluate(() => document.activeElement?.getAttribute("data-k"))}`,
  );
  await p.keyboard.press("Enter");
  await life.locator('[data-k="again"]').waitFor();
  flow.push(
    `confirm → recap; win rate still 66,7 % = ${(await life.innerText()).includes("66,7")}`,
  );
  await life.screenshot({ path: `${OUT}/flow-recap--desktop.png` });
  await ctx.close();
}

/* Reduced motion: feedback classes must not leave running animations. */
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const p = await ctx.newPage();
  await open(p, "/");
  const life = p.locator('[data-testid="lifecycle"]');
  await life.locator('[data-k="start"]').click();
  await life.locator('[data-k="simulate"]').click();
  const long = await p.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 5).length,
  );
  flow.push(`reduced motion: animations longer than 5 ms after a match = ${long}`);
  await ctx.close();
}
await browser.close();

const summary = issues.reduce<Record<string, number>>(
  (a, i) => ((a[i.kind] = (a[i.kind] ?? 0) + 1), a),
  {},
);
writeFileSync(
  "design/phase-5-6b1/screenshots/qa-report.json",
  JSON.stringify({ ranAt: new Date().toISOString(), summary, issues, flow }, null, 2),
);
console.log(JSON.stringify({ summary, flow, sample: issues.slice(0, 12) }, null, 2));
