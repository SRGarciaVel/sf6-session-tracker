/**
 * M2A — interactive controls: before/after captures, measurements and (after) behaviour checks
 * against a LOCAL production build and a LOCAL database (refuses anything else). Fictitious
 * `@test.local` accounts; Companion data through the real sync endpoint.
 *
 *   E2E_STATE=/tmp/m2.json pnpm exec tsx design/phase-m2/e2e/controls.e2e.mts setup
 *   E2E_STATE=/tmp/m2.json pnpm exec tsx design/phase-m2/e2e/controls.e2e.mts capture <before|after>
 *   E2E_STATE=/tmp/m2.json pnpm exec tsx design/phase-m2/e2e/controls.e2e.mts cleanup
 *
 * Server env for capture: FIGHT_SESSION_UI_USERS=<A id> (A = Fight Session, B = classic).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const LABEL = process.argv[3] ?? "after";
const OUT = `design/phase-m2/screenshots/full/${LABEL}`;
const STATE = process.env.E2E_STATE ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
if (!STATE) throw new Error("E2E_STATE (a path outside the repo) is required");
mkdirSync(OUT, { recursive: true });
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

interface Account {
  key: "A" | "B";
  id: string;
  cfn: string;
  deviceToken: string;
  storage: string;
}
interface Saved {
  A: Account;
  B: Account;
  ids: Record<"A" | "B", { sessionId: string; overlayId: string; token: string }>;
}

function profile(cfn: string, mr: number) {
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
    if (c.character_tool_name === "ryu") c.league_info.master_rating = mr;
  const n = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: "1733837998",
  }).profile;
  return core.toWireProfile({
    ...n,
    cfnUserId: cfn,
    displayName: "Yasmine",
    favoriteCharacterKey: "ryu",
  });
}
let seq = 0;
const match = (result: "win" | "loss") =>
  core.toWireMatch({
    externalMatchId: `M2-${Date.now()}-${++seq}`,
    playedAt: new Date(),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponent: { name: `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
    ratingBefore: null,
    ratingAfter: null,
  });
const lastSync = new Map<string, number>();
async function sync(acc: Account, body: Record<string, unknown>) {
  const wait = (lastSync.get(acc.cfn) ?? 0) + 6_200 - Date.now();
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
      battlelogObserved: true,
      client: { version: "0.4.0", transport: "service_worker" },
      ...body,
    }),
  });
  lastSync.set(acc.cfn, Date.now());
  if (res.status !== 200) throw new Error(`sync ${res.status}`);
}

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function shot(p: Page, name: string, full = false) {
  await p
    .evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode())
        if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
      for (const i of Array.from(document.querySelectorAll("input")))
        if (i.value.includes("/overlay/"))
          i.value = i.value.replace(/overlay\/.*/, "overlay/••••••");
    })
    .catch(() => {});
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
}

/* ───────── setup ───────── */

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../../src/server/db/client");
  const make = async (key: "A" | "B", cfn: string): Promise<Account> => {
    const ctx = await browser.newContext({ locale: "es-ES" });
    const page = await ctx.newPage();
    const email = `m2-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
    await page.goto(`${APP}/signup`);
    await page.fill("#name", `Tester ${key}`);
    await page.fill("#email", email);
    await page.fill("#password", `e2e-${randomUUID()}`);
    await page.click('button[type="submit"]');
    await page.waitForURL(/onboarding/);
    const id = (await sql<{ id: string }[]>`select id from auth_user where email = ${email}`)[0]!
      .id;
    const { code } = await createPairingCode(getDb(), id);
    const pair = await fetch(`${APP}/api/companion/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: `E2E ${key}` }),
    });
    const deviceToken = ((await pair.json()) as { deviceToken: string }).deviceToken; // never printed
    const acc = { key, id, cfn, deviceToken, storage: `${STATE}.${key}.storage.json` };
    await sync(acc, { profile: profile(cfn, 1402) });
    await page.fill("#cfn", cfn);
    await page.getByRole("button", { name: "Buscar jugador" }).click();
    await page.getByText("Jugador encontrado").waitFor();
    await page.getByRole("button", { name: /Soy yo/ }).click();
    await page.waitForURL(/dashboard/);
    await ctx.storageState({ path: acc.storage });
    await page.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
    await page.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1_500));
    await sync(acc, { matches: [match("win"), match("loss"), match("win")] });
    await sync(acc, { profile: profile(cfn, 1414) });
    await new Promise((r) => setTimeout(r, 6_000));
    await page.getByRole("button", { name: "Finalizar sesión" }).click();
    await page.getByRole("button", { name: "Sí, finalizar sesión" }).click();
    await page.waitForURL(/ended=1/, { timeout: 30_000 });
    await ctx.close();
    return acc;
  };
  const A = await make("A", "9990000800");
  const B = await make("B", "9990000801");
  const ids = {} as Saved["ids"];
  for (const acc of [A, B]) {
    const s = (
      await sql<
        { id: string }[]
      >`select gs.id from game_session gs join sf6_player p on p.id = gs.player_id
        where p.user_id = ${acc.id} order by gs.started_at desc limit 1`
    )[0]!;
    const o = (
      await sql<{ id: string; public_token: string }[]>`select o.id, o.public_token from overlay o
        join sf6_player p on p.id = o.player_id where p.user_id = ${acc.id} order by o.created_at limit 1`
    )[0]!;
    ids[acc.key] = { sessionId: s.id, overlayId: o.id, token: o.public_token };
  }
  writeFileSync(STATE, JSON.stringify({ A, B, ids } satisfies Saved, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

/* ───────── capture ───────── */

async function ctxFor(browser: Browser, acc: Account | null, width = 1440, height = 900) {
  const ctx = await browser.newContext({
    ...(acc ? { storageState: acc.storage } : {}),
    locale: "es-ES",
    viewport: { width, height },
  });
  await ctx.addInitScript({
    content: `window.__name = (f) => f; window.__lt = 0; window.__cls = 0;
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: "longtask", buffered: true });
            new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}`,
  });
  return ctx;
}

async function metrics(p: Page) {
  return p.evaluate(() => {
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const sum = (f: (r: PerformanceResourceTiming) => boolean) =>
      Math.round(res.filter(f).reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 102.4) / 10;
    const w = window as unknown as { __lt: number; __cls: number };
    return {
      jsKB: sum((r) => r.name.endsWith(".js")),
      cssKB: sum((r) => r.name.endsWith(".css")),
      longTaskMs: Math.round(w.__lt),
      cls: Number(w.__cls.toFixed(4)),
      domNodes: document.querySelectorAll("*").length,
    };
  });
}

async function capture() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const m: Record<string, unknown> = {};
  const pages: Array<[string, string, Account | null, string]> = [
    ["fight-prepare", "/dashboard", s.A, '[data-k="start"]'],
    ["classic-dashboard", "/dashboard", s.B, "aside"],
    ["fight-recap", `/dashboard/sessions/${s.ids.A.sessionId}`, s.A, "[data-recap-ui]"],
    ["classic-recap", `/dashboard/sessions/${s.ids.B.sessionId}`, s.B, "[data-recap-ui]"],
    ["analytics", "/dashboard/analytics", s.A, '[data-testid="analytics-end"]'],
    ["builder", `/dashboard/overlays/${s.ids.A.overlayId}`, s.A, '[data-testid="editor"]'],
    ["onboarding", "/onboarding", s.A, "main"],
    ["help-companion", "/help/companion", s.A, "main"],
  ];
  for (const [name, path, acc, ready] of pages) {
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      const ctx = await ctxFor(browser, acc, w, h);
      const p = await ctx.newPage();
      await p.goto(`${APP}${path}`);
      await p.locator(ready).first().waitFor({ timeout: 60_000 });
      await p.waitForLoadState("load");
      await p.waitForTimeout(800);
      if (w === 1440) m[name] = await metrics(p);
      await shot(p, `${name}--${w}`, true);
      await ctx.close();
    }
  }
  // CPU: idle PREPARE (30 s), and a hover sweep over the action controls under 4× CPU throttling.
  const ctx = await ctxFor(browser, s.A);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  const task = async () =>
    (
      (await cdp.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      }
    ).metrics.find((x) => x.name === "TaskDuration")!.value;
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').waitFor();
  await p.waitForTimeout(1_500);
  const i0 = await task();
  await p.waitForTimeout(30_000);
  const i1 = await task();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const targets = p.locator("main a:visible, main button:visible");
  const n = Math.min(await targets.count(), 25);
  const h0 = await task();
  for (let i = 0; i < n; i++)
    await targets
      .nth(i)
      .hover({ force: true })
      .catch(() => {});
  const h1 = await task();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  m.cpu = {
    idleTaskMsPer30s: Math.round((i1 - i0) * 1000),
    hoverSweepTaskMs4xThrottle: Math.round((h1 - h0) * 1000),
    hoveredControls: n,
  };
  await ctx.close();
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(m, null, 2));
  console.log(JSON.stringify(m, null, 1));
  if (LABEL === "after") await checks(browser, s);
  await browser.close();
}

/* ───────── after: behaviour checks ───────── */

async function checks(browser: Browser, s: Saved) {
  // 1. Real clicks land on the same destinations as before.
  const ctx = await ctxFor(browser, s.A);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const p = await ctx.newPage();
  const go = async (path: string) => {
    await p.goto(`${APP}${path}`);
    await p.waitForLoadState("load");
  };
  await go("/dashboard");
  await p.locator('[data-k="start"]').waitFor();
  check(
    "PREPARE CTA: SVG arrow (no text glyph), still a <button>",
    (await p.locator('[data-k="start"] svg[data-icon="arrow-right"]').count()) === 1 &&
      !(await p.locator('[data-k="start"]').innerText()).includes("→") &&
      (await p.locator('[data-k="start"]').evaluate((e) => e.tagName)) === "BUTTON",
  );
  await p.getByRole("link", { name: /Ver resumen/ }).click();
  await p.waitForURL(new RegExp(`/dashboard/sessions/${s.ids.A.sessionId}$`));
  await p.locator("[data-recap-ui]").waitFor();
  check("«Ver resumen» → the same recap route (client navigation)", true);
  const prepare = p.getByRole("link", { name: /Preparar otra sesión/ });
  check(
    "RECAP: primary «Preparar otra sesión» (angular CTA + arrow), secondary «Volver al panel» (back arrow)",
    (await prepare.locator('svg[data-icon="arrow-right"]').count()) === 1 &&
      (await p
        .getByRole("link", { name: "Volver al panel" })
        .locator('svg[data-icon="arrow-left"]')
        .count()) === 1 &&
      (await prepare.evaluate((e) => e.className)).includes("fs-cta"),
  );
  await p.getByRole("link", { name: /Gestionar overlays/ }).click();
  await p.waitForURL(/\/dashboard#overlays$/);
  check("RECAP «Gestionar overlays» → /dashboard#overlays", true);
  await go(`/dashboard/sessions/${s.ids.A.sessionId}`);
  await prepare.click();
  await p.waitForURL(/\/dashboard#session$/);
  await p.locator('[data-k="start"]').waitFor();
  check("RECAP «Preparar otra sesión» → /dashboard#session (PREPARE)", true);

  // 2. Console: copy URL (exact), details chevron, configure route.
  const row = p.locator("[data-overlay-item]").first();
  await row.getByRole("button", { name: /Copiar URL para OBS/ }).click();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check(
    "Copy OBS URL: exact URL copied; copy icon → check icon",
    clip === `${APP}/overlay/${s.ids.A.token}` &&
      (await row.locator('button[data-copy-status="copied"] svg[data-icon="check"]').count()) === 1,
  );
  const summary = row.locator("summary");
  const before = await summary.locator("svg").evaluate((e) => getComputedStyle(e).transform);
  await summary.click();
  await p.waitForTimeout(400);
  const after = await summary.locator("svg").evaluate((e) => getComputedStyle(e).transform);
  check(
    "Details chevron (SVG) rotates when open",
    before !== after && after !== "none",
    `${before} → ${after}`,
  );
  await row.getByRole("link", { name: /Configurar/ }).click();
  await p.waitForURL(new RegExp(`/dashboard/overlays/${s.ids.A.overlayId}$`));
  check("«Configurar» → same builder route", true);
  const back = p.locator("main").getByRole("link", { name: "Volver al panel" });
  await back.waitFor({ timeout: 30_000 });
  check(
    "Builder back link: arrow-left SVG, link semantics",
    (await back.locator('svg[data-icon="arrow-left"]').count()) === 1 &&
      (await back.evaluate((e) => e.tagName)) === "A",
  );

  // 3. Keyboard: Tab reaches ActionLinks with a visible focus ring; hover nudges the icon.
  await go("/dashboard/analytics");
  await go("/dashboard");
  await p.locator('[data-k="start"]').waitFor();
  const installLink = p.getByRole("link", { name: /Ver instalación/ });
  await installLink.focus();
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Tab");
  const ring = await p.evaluate(() => {
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(a);
    return { text: a.textContent, outline: `${cs.outlineStyle} ${cs.outlineWidth}` };
  });
  const iconTransform = await installLink
    .locator("svg")
    .evaluate((e) => getComputedStyle(e).transform);
  check(
    "keyboard: ActionLink focus ring visible; focus also nudges the arrow",
    /Ver instalación/.test(ring.text ?? "") &&
      !ring.outline.startsWith("none") &&
      iconTransform !== "none",
    `${ring.outline} · ${iconTransform}`,
  );
  const tiny = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".sst-link, .fs-btn, .btn, .fs-cta"))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.width < 24 || r.height < 24);
      })
      .map((e) => e.textContent?.trim()),
  );
  check("touch targets: every action control ≥ 24×24 px", tiny.length === 0, tiny.join(","));
  await ctx.close();

  // 4. Reduced motion: hover/focus never moves the icon.
  const rctx = await browser.newContext({ storageState: s.A.storage, reducedMotion: "reduce" });
  await rctx.addInitScript({ content: "window.__name = (f) => f;" });
  const rp = await rctx.newPage();
  await rp.goto(`${APP}/dashboard`);
  await rp.locator('[data-k="start"]').waitFor();
  const link = rp.getByRole("link", { name: /Ver instalación/ });
  await link.hover();
  await rp.waitForTimeout(200);
  const t = await link.locator("svg").evaluate((e) => getComputedStyle(e).transform);
  check(
    "reduced motion: hovered ActionLink icon does not move",
    t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)",
    t,
  );
  await rctx.close();

  // 5. Responsive + text 200 % (CSS root size) on the pages with new controls.
  const pages: Array<[string, Account]> = [
    ["/dashboard", s.A],
    [`/dashboard/sessions/${s.ids.A.sessionId}`, s.A],
    [`/dashboard/sessions/${s.ids.B.sessionId}`, s.B],
    ["/dashboard", s.B],
    ["/help/companion", s.A],
  ];
  for (const [path, acc] of pages) {
    const over: string[] = [];
    for (const [w, h] of [
      [1920, 1080],
      [1440, 900],
      [1280, 720],
      [768, 1024],
      [390, 844],
      [360, 800],
    ] as const) {
      const c = await ctxFor(browser, acc, w, h);
      const pg = await c.newPage();
      await pg.goto(`${APP}${path}`);
      await pg.waitForLoadState("load");
      await pg.waitForTimeout(300);
      const ox = await pg.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (ox > 0) over.push(`${w}:${ox}`);
      await c.close();
    }
    check(
      `no horizontal overflow ${path} (${acc.key}) at 1920…360`,
      over.length === 0,
      over.join(" "),
    );
  }
  // 5b. Text 200 % through Chromium's own default font size (as a user setting would do).
  {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "sst-font-"));
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(
      join(dir, "Default", "Preferences"),
      JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }),
    );
    const fctx = await chromium.launchPersistentContext(dir, {
      channel: "chromium",
      locale: "es-ES",
    });
    await fctx.addCookies(
      (
        JSON.parse(readFileSync(s.A.storage, "utf8")) as {
          cookies: Parameters<typeof fctx.addCookies>[0];
        }
      ).cookies,
    );
    const fp = await fctx.newPage();
    for (const path of ["/dashboard", `/dashboard/sessions/${s.ids.A.sessionId}`]) {
      for (const w of [1440, 390]) {
        await fp.setViewportSize({ width: w, height: 900 });
        await fp.goto(`${APP}${path}`);
        await fp.waitForLoadState("load");
        await fp.waitForTimeout(300);
        const ox = await fp.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        check(`text 200 % ${path} at ${w}: no horizontal overflow`, ox <= 0, `${ox}px`);
        if (w === 390)
          await fp.screenshot({
            path: `${OUT}/text200--${path.includes("sessions") ? "recap" : "prepare"}--390.png`,
          });
      }
    }
    await fctx.close();
  }

  // 6. OBS isolation: the overlay never ships the control icons or the app stylesheet.
  const octx = await browser.newContext({ viewport: { width: 800, height: 180 } });
  const op = await octx.newPage();
  await op.goto(`${APP}/overlay/${s.ids.A.token}`);
  await op.waitForTimeout(800);
  check(
    "OBS overlay: no SST control icons, no app CSS (motion tokens absent)",
    (await op.locator(".sst-icon, .sst-link").count()) === 0 &&
      !(await op.evaluate(() =>
        Array.from(document.styleSheets).some((ss) =>
          Array.from(ss.cssRules ?? []).some((r) => r.cssText.includes("--motion-nudge")),
        ),
      )),
  );
  await octx.close();
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id in (${s.A.id}, ${s.B.id}) and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "capture") await capture();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | capture <label> | cleanup");
if (results.length)
  writeFileSync(
    `${OUT}/checks.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
  );
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
