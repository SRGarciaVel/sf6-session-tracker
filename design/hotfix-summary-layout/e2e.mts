/**
 * Hotfix — «Tu última sesión» summary overlap. Reproduces the reported case on the REAL Fight
 * Session dashboard (local production build, LOCAL database, fictitious @test.local account) and
 * measures it deterministically: text bounding boxes (DOM Range, i.e. the glyphs, not the cell
 * box) of every summary value must stay inside their own cell and never intersect.
 *
 *   E2E_STATE=/tmp/x.json pnpm exec tsx design/hotfix-summary-layout/e2e.mts <phase> [label]
 *     setup    server without FIGHT_SESSION_UI_USERS: account, pairing, profile (Jamie LP)
 *     session  server WITH FIGHT_SESSION_UI_USERS=<id>: one ended session 1W/2L, −24 LP
 *     measure  same server: 7 viewports, ES + EN, screenshots + checks → <label> report
 *     cleanup  delete the account
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const STATE = process.env.E2E_STATE ?? "";
const [PHASE = "", LABEL = "after"] = process.argv.slice(2);
const OUT = `design/hotfix-summary-layout/screenshots/full/${LABEL}`;
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
if (!STATE) throw new Error("E2E_STATE (outside the repo) is required");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

interface Saved {
  id: string;
  cfn: string;
  deviceToken: string;
  storage: string;
}

function profile(cfn: string, jamieLp: number) {
  const raw = JSON.parse(readFileSync("tests/fixtures/capcom/play-1733837998.json", "utf8")) as {
    pageProps: {
      play: {
        character_league_infos: Array<{
          character_tool_name: string;
          league_info: Record<string, number>;
        }>;
      };
    };
  };
  for (const c of raw.pageProps.play.character_league_infos)
    if (c.character_tool_name === "jamie") c.league_info.league_point = jamieLp;
  const n = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: "1733837998",
  }).profile;
  return core.toWireProfile({
    ...n,
    cfnUserId: cfn,
    displayName: "Layout",
    favoriteCharacterKey: "jamie",
  });
}
let seq = 0;
const match = (result: "win" | "loss") =>
  core.toWireMatch({
    externalMatchId: `LAYOUT-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() - 1_000),
    mode: "ranked",
    result,
    characterKey: "jamie",
    characterName: "Jamie",
    opponent: { name: `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
    ratingBefore: null,
    ratingAfter: null,
  });
let lastSync = 0;
async function sync(acc: Saved, body: Record<string, unknown>) {
  const wait = lastSync + 6_200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${APP}/api/companion/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${acc.deviceToken}` },
    body: JSON.stringify({
      cfnUserId: acc.cfn,
      observedAt: new Date().toISOString(),
      profile: null,
      matches: [],
      gapSuspected: false,
      client: { version: "0.4.0", transport: "service_worker" },
      ...body,
    }),
  });
  lastSync = Date.now();
  if (res.status !== 200) throw new Error(`sync ${res.status}`);
}

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../src/server/db/client");
  const ctx = await browser.newContext({ locale: "es-ES" });
  const page = await ctx.newPage();
  const email = `layout-${randomUUID().slice(0, 6)}@test.local`;
  await page.goto(`${APP}/signup`);
  await page.fill("#name", "Layout");
  await page.fill("#email", email);
  await page.fill("#password", `e2e-${randomUUID()}`);
  await page.click('button[type="submit"]');
  await page.waitForURL(/onboarding/);
  const id = (await sql<{ id: string }[]>`select id from auth_user where email = ${email}`)[0]?.id;
  if (!id) throw new Error("account not created");
  const { code } = await createPairingCode(getDb(), id);
  const pair = await fetch(`${APP}/api/companion/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName: "Layout" }),
  });
  const acc: Saved = {
    id,
    cfn: "9990000400",
    deviceToken: ((await pair.json()) as { deviceToken: string }).deviceToken,
    storage: `${STATE}.storage.json`,
  };
  await sync(acc, { profile: profile(acc.cfn, 23006), battlelogObserved: true });
  await page.fill("#cfn", acc.cfn);
  await page.getByRole("button", { name: "Buscar jugador" }).click();
  await page.getByText("Jugador encontrado").waitFor();
  await page.getByRole("button", { name: /Soy yo/ }).click();
  await page.waitForURL(/dashboard/);
  await ctx.storageState({ path: acc.storage });
  writeFileSync(STATE, JSON.stringify(acc));
  console.log(`setup done. Restart with FIGHT_SESSION_UI_USERS=${id}`);
  await browser.close();
  await closeDb();
}

async function session() {
  const acc = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: acc.storage, locale: "es-ES" });
  const p = await ctx.newPage();
  await sync(acc, { profile: profile(acc.cfn, 23006), battlelogObserved: true });
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').click();
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await p.waitForTimeout(3_000);
  // Reported case: 3 matches, 1 W / 2 L, 33,3 %, Jamie 23 006 → 22 982 LP (−24).
  await sync(acc, {
    matches: [match("win")],
    profile: profile(acc.cfn, 23026),
    battlelogObserved: true,
  });
  await sync(acc, {
    matches: [match("loss")],
    profile: profile(acc.cfn, 23004),
    battlelogObserved: true,
  });
  await sync(acc, {
    matches: [match("loss")],
    profile: profile(acc.cfn, 22982),
    battlelogObserved: true,
  });
  await p.waitForFunction(() => (document.body.textContent ?? "").includes("en 3 partidas"), null, {
    timeout: 30_000,
  });
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/ended=1/, { timeout: 30_000 });
  console.log("ended session 1W/2L −24 LP ready");
  await browser.close();
}

/* ───────── measurement ───────── */

type Finding = { where: string; issue: string };
async function measureSummary(p: Page, where: string): Promise<Finding[]> {
  return p.evaluate((where) => {
    const out: { where: string; issue: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1)
      out.push({ where, issue: `page horizontal overflow ${doc.scrollWidth}>${doc.clientWidth}` });
    const dl = document.querySelector<HTMLElement>("#session dl");
    if (!dl) return [{ where, issue: "summary not found" }];
    const cells = Array.from(dl.children) as HTMLElement[];
    const textBox = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    };
    const values = cells.map((cell) => {
      const dds = Array.from(cell.querySelectorAll("dd"));
      return {
        cell,
        label: cell.querySelector("dt")?.textContent ?? "?",
        boxes: dds.map(textBox),
        dts: textBox(cell.querySelector("dt")!),
      };
    });
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    for (const v of values) {
      const c = v.cell.getBoundingClientRect();
      for (const bx of [...v.boxes, v.dts])
        if (bx.left < c.left - 0.5 || bx.right > c.right + 0.5)
          out.push({
            where,
            issue: `«${v.label}» text escapes its cell (${Math.round(bx.left)}–${Math.round(bx.right)} vs ${Math.round(c.left)}–${Math.round(c.right)})`,
          });
    }
    for (let i = 0; i < values.length; i++)
      for (let j = i + 1; j < values.length; j++)
        for (const a of values[i]!.boxes)
          for (const b of values[j]!.boxes)
            if (intersects(a, b))
              out.push({ where, issue: `«${values[i]!.label}» overlaps «${values[j]!.label}»` });
    const dlBox = dl.getBoundingClientRect();
    if (dl.scrollWidth > dl.clientWidth + 1)
      out.push({ where, issue: "summary scrolls horizontally" });
    return out.concat(
      dlBox.right > doc.clientWidth + 0.5
        ? [{ where, issue: "summary wider than the viewport" }]
        : [],
    );
  }, where);
}

async function measure() {
  const acc = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const findings: Finding[] = [];
  const VIEWPORTS: Array<[number, number]> = [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 800],
  ];
  for (const locale of ["es", "en"] as const) {
    const ctx = await browser.newContext({ storageState: acc.storage, locale: "es-ES" });
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: APP }]);
    // tsx/esbuild keeps function names via a `__name` helper that does not exist in the page.
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    await sql`update auth_user set locale = ${locale} where id = ${acc.id}`;
    const p = await ctx.newPage();
    for (const [w, h] of VIEWPORTS) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`${APP}/dashboard`);
      const dl = p.locator("#session dl");
      await dl.waitFor({ timeout: 20_000 });
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(250);
      const where = `${locale} ${w}×${h} (main column ${Math.round((await p.locator("#session").boundingBox())?.width ?? 0)}px)`;
      findings.push(...(await measureSummary(p, where)));
      // Capture only (after measuring): unpin the sticky header and the fixed mobile start bar so
      // they do not cover the element screenshot. The next goto() restores the page.
      await p.addStyleTag({
        content: "header, .max-sm\\:fixed { position: static !important; }",
      });
      await dl.scrollIntoViewIfNeeded();
      await dl.screenshot({ path: `${OUT}/${locale}--${w}x${h}--summary.png` });
      if (locale === "es" && (w === 1440 || w === 390))
        await p.screenshot({ path: `${OUT}/${locale}--${w}x${h}--page.png`, fullPage: true });
    }
    // 200 % text size (browser zoom of the text only).
    await p.setViewportSize({ width: 1440, height: 900 });
    await p.goto(`${APP}/dashboard`);
    await p.locator("#session dl").waitFor();
    await p.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await p.waitForTimeout(300);
    findings.push(...(await measureSummary(p, `${locale} 1440×900 text 200%`)));
    await p
      .locator("#session dl")
      .screenshot({ path: `${OUT}/${locale}--1440--text200--summary.png` });
    await ctx.close();
  }
  await sql`update auth_user set locale = 'es' where id = ${acc.id}`;
  writeFileSync(
    `design/hotfix-summary-layout/screenshots/${LABEL}-report.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), findings }, null, 2),
  );
  console.log(`${LABEL}: ${findings.length} finding(s)`);
  for (const f of findings.slice(0, 40)) console.log(` - ${f.where}: ${f.issue}`);
  await browser.close();
}

async function cleanup() {
  const acc = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const del =
    await sql`delete from auth_user where id = ${acc.id} and email like '%@test.local' returning id`;
  console.log(`deleted ${del.length}`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "session") await session();
else if (PHASE === "measure") await measure();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | session | measure | cleanup");
await sql.end();
