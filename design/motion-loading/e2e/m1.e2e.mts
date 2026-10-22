/**
 * M1 — loading baseline / after measurements against a LOCAL production build and a LOCAL
 * database (refuses anything else). Fictitious `@test.local` accounts; Companion data through
 * the real sync endpoint; sessions through the real UI.
 *
 *   E2E_STATE=/tmp/m1.json pnpm exec tsx design/motion-loading/e2e/m1.e2e.mts setup
 *   E2E_STATE=/tmp/m1.json pnpm exec tsx design/motion-loading/e2e/m1.e2e.mts capture <label>
 *   E2E_STATE=/tmp/m1.json pnpm exec tsx design/motion-loading/e2e/m1.e2e.mts cleanup
 *
 * `capture` is run against two server configurations (see design/motion-loading/m1-audit.md):
 *   fast  next start → local Postgres directly;
 *   slow  next start → latency-proxy.mjs (+DB delay per round trip) → local Postgres.
 * Server env: FIGHT_SESSION_UI_USERS=<A id> (A = Fight Session, B = classic).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const LABEL = process.argv[3] ?? "run";
const OUT = `design/motion-loading/screenshots/full/${LABEL}`;
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
    externalMatchId: `M1-${Date.now()}-${++seq}`,
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
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

/* ───────── setup ───────── */

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../../src/server/db/client");
  const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } =
    await import("../../../src/domain/overlay/rank-progress");
  const make = async (key: "A" | "B", cfn: string): Promise<Account> => {
    const ctx = await browser.newContext({ locale: "es-ES" });
    const page = await ctx.newPage();
    const email = `m1-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
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
    // One finished session with matches (history, analytics, recap), through the classic UI.
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
    const playerId = (
      await sql<{ id: string }[]>`select id from sf6_player where user_id = ${id}`
    )[0]!.id;
    const token = Buffer.from(randomUUID() + randomUUID())
      .toString("base64url")
      .slice(0, 32);
    await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${"Progreso de rango"}, ${token}, ${sql.json({ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "es" } as postgres.JSONValue)})`;
    return acc;
  };
  const A = await make("A", "9990000600");
  const B = await make("B", "9990000601");
  const ids = {} as Saved["ids"];
  for (const acc of [A, B]) {
    const s = (
      await sql<
        { id: string }[]
      >`select gs.id from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${acc.id} order by gs.started_at desc limit 1`
    )[0]!;
    const o = (
      await sql<
        { id: string; public_token: string }[]
      >`select o.id, o.public_token from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${acc.id} order by o.created_at limit 1`
    )[0]!;
    ids[acc.key] = { sessionId: s.id, overlayId: o.id, token: o.public_token };
  }
  writeFileSync(STATE, JSON.stringify({ A, B, ids } satisfies Saved, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

/* ───────── capture ───────── */

/**
 * In-page timeline: every animation frame records whether a LOADING marker is visible (old
 * generic card or a new [data-skeleton] region, opacity > 0.05) and whether the route's CONTENT
 * marker exists; plus CLS (layout-shift without input) and long tasks.
 */
const TIMELINE = `
window.__name = (f) => f;
window.__m1 = { frames: [], cls: 0, longTasks: 0, longTaskMs: 0, content: null, loading: null };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m1.cls += e.value; })
    .observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m1.longTasks++; window.__m1.longTaskMs += e.duration; } })
    .observe({ type: "longtask", buffered: true });
} catch {}
const sample = () => {
  const m = window.__m1;
  const sel = window.__contentSel || "";
  const loadingEl = document.querySelector("[data-skeleton], [data-loading-card], main > div[role='status'].hud-panel");
  let loading = false;
  if (loadingEl) {
    const cs = getComputedStyle(loadingEl);
    loading = cs.display !== "none" && Number(cs.opacity) > 0.05;
  }
  const content = !!(sel && document.querySelector(sel));
  const t = performance.now();
  m.frames.push([Math.round(t), loading ? 1 : 0, content ? 1 : 0]);
  if (loading && m.loading === null) m.loading = Math.round(t);
  if (content && m.content === null) m.content = Math.round(t);
  if (m.frames.length < 4000) requestAnimationFrame(sample);
};
requestAnimationFrame(sample);
`;

interface RouteSpec {
  name: string;
  path: string;
  content: string;
}
function routes(s: Saved, key: "A" | "B"): RouteSpec[] {
  const ids = s.ids[key];
  return [
    {
      name: "dashboard",
      path: "/dashboard",
      content: '[data-testid="overlay-kind"], [data-overlay-item]',
    },
    { name: "analytics", path: "/dashboard/analytics", content: '[data-testid="analytics-end"]' },
    {
      name: "recap",
      path: `/dashboard/sessions/${ids.sessionId}`,
      content: '[data-recap-ui], main a[href="/dashboard"].text-sm',
    },
    {
      name: "builder",
      path: `/dashboard/overlays/${ids.overlayId}`,
      content: '[data-testid="editor"]',
    },
  ];
}

async function measureLoad(browser: Browser, acc: Account, r: RouteSpec, tag: string) {
  const ctx = await browser.newContext({
    storageState: acc.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript({ content: `window.__contentSel = ${JSON.stringify(r.content)};` });
  await ctx.addInitScript({ content: TIMELINE });
  const p = await ctx.newPage();
  const requests: string[] = [];
  p.on("request", (q) => requests.push(q.url()));
  await p.goto(`${APP}${r.path}`, { waitUntil: "commit" });
  await p.waitForTimeout(250);
  await shot(p, `${tag}--${r.name}--initial-250ms`);
  await p.locator(r.content).first().waitFor({ timeout: 60_000 });
  await p.waitForLoadState("load");
  await p.waitForTimeout(1_500);
  await shot(p, `${tag}--${r.name}--loaded`);
  const m = await p.evaluate(() => {
    const w = window as unknown as {
      __m1: {
        frames: number[][];
        cls: number;
        longTasks: number;
        longTaskMs: number;
        content: number | null;
        loading: number | null;
      };
    };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const loadingFrames = w.__m1.frames.filter((f) => f[1] === 1).length;
    return {
      ttfb: Math.round(nav.responseStart),
      fcp: fcp === null ? null : Math.round(fcp),
      loadingShownAt: w.__m1.loading,
      contentAt: w.__m1.content,
      loadingFrames,
      cls: Number(w.__m1.cls.toFixed(4)),
      longTasks: w.__m1.longTasks,
      longTaskMs: Math.round(w.__m1.longTaskMs),
      domNodes: document.querySelectorAll("*").length,
    };
  });
  const streams = requests.filter((u) => u.includes("/api/me/stream")).length;
  await ctx.close();
  return { ...m, requests: requests.length, streams };
}

/** Client navigation from /dashboard with the RSC response held back `delayMs`. */
async function measureNav(
  browser: Browser,
  acc: Account,
  r: RouteSpec,
  tag: string,
  delayMs: number,
  viewport = { width: 1440, height: 900 },
) {
  const ctx = await browser.newContext({ storageState: acc.storage, locale: "es-ES", viewport });
  await ctx.addInitScript({ content: `window.__contentSel = ${JSON.stringify(r.content)};` });
  await ctx.addInitScript({ content: TIMELINE });
  const p = await ctx.newPage();
  // Start from another page that links to the target (the nav tab, «Configurar», a history row).
  const from = r.name === "dashboard" ? "/dashboard/analytics" : "/dashboard";
  const fromSel =
    r.name === "dashboard"
      ? '[data-testid="analytics-end"]'
      : '[data-testid="overlay-kind"], [data-overlay-item]';
  await p.goto(`${APP}${from}`);
  await p.locator(fromSel).first().waitFor({ timeout: 60_000 });
  await p.waitForTimeout(800);
  let held = 0;
  await p.route("**/*", async (route) => {
    const h = route.request().headers();
    if (delayMs > 0 && (h["rsc"] === "1" || route.request().url().includes("_rsc="))) {
      held++;
      await new Promise((res) => setTimeout(res, delayMs));
    }
    await route.continue();
  });
  // Restart the frame timeline at the click.
  await p.evaluate((sel) => {
    const w = window as unknown as {
      __contentSel: string;
      __m1: { frames: number[][]; cls: number; content: number | null; loading: number | null };
    };
    w.__contentSel = sel;
    w.__m1.frames = [];
    w.__m1.cls = 0;
    w.__m1.content = null;
    w.__m1.loading = null;
    (window as unknown as { __t0: number }).__t0 = performance.now();
  }, r.content);
  // A real in-app link click (client navigation through the App Router).
  await p.locator(`a[href="${r.path}"]:visible`).first().click();
  await p.waitForTimeout(Math.min(400, delayMs / 2 || 150));
  if (delayMs > 0) await shot(p, `${tag}--${r.name}--nav-pending-${viewport.width}`);
  await p.locator(r.content).first().waitFor({ timeout: 60_000 });
  await p.waitForTimeout(600);
  const m = await p.evaluate(() => {
    const w = window as unknown as {
      __t0: number;
      __m1: { frames: number[][]; cls: number; content: number | null; loading: number | null };
    };
    const rel = (x: number | null) => (x === null ? null : Math.round(x - w.__t0));
    return {
      loadingShownAfter: rel(w.__m1.loading),
      contentAfter: rel(w.__m1.content),
      loadingFrames: w.__m1.frames.filter((f) => f[1] === 1).length,
      cls: Number(w.__m1.cls.toFixed(4)),
    };
  });
  // Back / forward keep content.
  await p.goBack();
  await p.locator(fromSel).first().waitFor({ timeout: 60_000 });
  await p.goForward();
  await p.locator(r.content).first().waitFor({ timeout: 60_000 });
  await ctx.close();
  return { ...m, rscHeld: held };
}

/**
 * AFTER only: the skeleton of each route while a navigation is held back. Viewports, locales,
 * text 200 % (browser default font size), reduced motion, SSE, page errors and CPU.
 */
async function skeletonChecks(browser: Browser, s: Saved) {
  const out: Record<string, unknown> = {};
  const sizes = [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [768, 1024],
    [390, 844],
    [360, 800],
  ] as const;
  for (const key of ["A", "B"] as const) {
    const acc = s[key];
    const ui = key === "A" ? "fight" : "classic";
    for (const locale of ["es", "en"] as const) {
      await sql`update auth_user set locale = ${locale} where id = ${acc.id}`;
      for (const r of routes(s, key)) {
        const ctx = await browser.newContext({
          storageState: acc.storage,
          locale: locale === "es" ? "es-ES" : "en-US",
          viewport: { width: 1440, height: 900 },
        });
        await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: APP }]);
        await ctx.addInitScript({ content: "window.__name = (f) => f;" });
        const p = await ctx.newPage();
        const errors: string[] = [];
        p.on("pageerror", (e) => errors.push(e.message));
        p.on("console", (m) => {
          if (m.type() === "error" && !m.text().includes("Failed to load resource"))
            errors.push(m.text());
        });
        const streams: string[] = [];
        const from = r.name === "dashboard" ? "/dashboard/analytics" : "/dashboard";
        await p.goto(`${APP}${from}`);
        await p.waitForLoadState("load");
        await p.waitForTimeout(800);
        // Bring the link into view first: Next prefetches a route's loading segment when its link
        // is visible, as it would be for a user about to click it.
        await p.locator(`a[href="${r.path}"]:visible`).first().scrollIntoViewIfNeeded();
        await p.waitForTimeout(800);
        let release!: () => void;
        const gate = new Promise<void>((res) => (release = res));
        await p.route("**/*", async (route) => {
          const h = route.request().headers();
          if (h["rsc"] === "1" || route.request().url().includes("_rsc=")) await gate;
          await route.continue();
        });
        p.on("request", (q) => {
          if (q.url().includes("/api/me/stream")) streams.push(q.url());
        });
        await p.locator(`a[href="${r.path}"]:visible`).first().click();
        const shown = await p
          .locator("[data-skeleton]")
          .waitFor({ timeout: 5_000 })
          .then(
            () => true,
            () => false,
          );
        await p.waitForTimeout(450); // past the 150 ms fade-in delay
        const status = await p.locator("[data-skeleton] [role=status]").allTextContents();
        const shapesText = await p
          .locator("[data-skeleton] [aria-hidden]")
          .first()
          .textContent()
          .catch(() => null);
        const focusable = await p
          .locator("[data-skeleton] a, [data-skeleton] button, [data-skeleton] [tabindex]")
          .count();
        const overflow: string[] = [];
        for (const [w, h] of sizes) {
          await p.setViewportSize({ width: w, height: h });
          await p.waitForTimeout(80);
          const ox = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          if (ox > 0) overflow.push(`${w}:${ox}px`);
          if (locale === "es" && (w === 1440 || w === 390))
            await shot(p, `${ui}--${r.name}--skeleton-${w}`, false);
        }
        if (locale === "en") {
          await p.setViewportSize({ width: 390, height: 844 });
          await shot(p, `${ui}--${r.name}--skeleton-en-390`, false);
        }
        check(
          `${ui} ${locale} ${r.name}: skeleton shown while the route renders, labelled once, no data, nothing focusable`,
          shown &&
            status.length === 1 &&
            status[0]!.length > 3 &&
            shapesText === "" &&
            focusable === 0,
          `status=${JSON.stringify(status)}`,
        );
        check(
          `${ui} ${locale} ${r.name}: no horizontal overflow at 1920/1440/1280/768/390/360`,
          overflow.length === 0,
          overflow.join(" "),
        );
        await p.setViewportSize({ width: 1440, height: 900 });
        release();
        await p.locator(r.content).first().waitFor({ timeout: 60_000 });
        await p.waitForTimeout(500);
        check(
          `${ui} ${locale} ${r.name}: content replaces the skeleton (none left), ≤ 1 SSE stream, no page errors`,
          (await p.locator("[data-skeleton]").count()) === 0 &&
            streams.length <= 1 &&
            errors.length === 0,
          `streams=${streams.length} errors=${errors.slice(0, 2).join(" | ")}`,
        );
        await ctx.close();
      }
    }
    await sql`update auth_user set locale = 'es' where id = ${acc.id}`;
  }

  // Text 200 % (Chromium default font size 32 px) and reduced motion, Fight Session dashboard.
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sst-font-"));
  mkdirSync(join(dir, "Default"), { recursive: true });
  writeFileSync(
    join(dir, "Default", "Preferences"),
    JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }),
  );
  for (const [label, opts] of [
    ["text200", { channel: "chromium" as const }],
    ["reducedMotion", { reducedMotion: "reduce" as const }],
  ] as const) {
    const ctx =
      label === "text200"
        ? await chromium.launchPersistentContext(dir, { ...opts, locale: "es-ES" })
        : await browser.newContext({ ...opts, locale: "es-ES", storageState: s.A.storage });
    if (label === "text200")
      await ctx.addCookies(
        (
          JSON.parse(readFileSync(s.A.storage, "utf8")) as {
            cookies: Parameters<typeof ctx.addCookies>[0];
          }
        ).cookies,
      );
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    const p = await ctx.newPage();
    for (const r of routes(s, "A")) {
      const from = r.name === "dashboard" ? "/dashboard/analytics" : "/dashboard";
      for (const w of label === "text200" ? [1440, 390] : [1440]) {
        await p.setViewportSize({ width: w, height: 900 });
        await p.unrouteAll();
        await p.goto(`${APP}${from}`);
        await p.waitForLoadState("load");
        await p.waitForTimeout(600);
        // Bring the link into view first: Next prefetches a route's loading segment when its link
        // is visible, as it would be for a user about to click it.
        await p.locator(`a[href="${r.path}"]:visible`).first().scrollIntoViewIfNeeded();
        await p.waitForTimeout(800);
        let release!: () => void;
        const gate = new Promise<void>((res) => (release = res));
        await p.route("**/*", async (route) => {
          const h = route.request().headers();
          if (h["rsc"] === "1" || route.request().url().includes("_rsc=")) await gate;
          await route.continue();
        });
        await p.locator(`a[href="${r.path}"]:visible`).first().click();
        const shown = await p
          .locator("[data-skeleton]")
          .waitFor({ timeout: 5_000 })
          .then(
            () => true,
            () => false,
          );
        await p.waitForTimeout(500);
        if (!shown) {
          check(`${label} ${r.name} ${w}: skeleton shown while pending`, false, p.url());
          await shot(p, `${label}--${r.name}--missing-${w}`, false);
        } else if (label === "text200") {
          const ox = await p.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          check(
            `text 200 % ${r.name} ${w}: skeleton without horizontal overflow`,
            ox <= 0,
            `${ox}px`,
          );
          await shot(p, `text200--${r.name}--skeleton-${w}`, false);
        } else {
          const running = await p.evaluate(
            () =>
              document
                .getAnimations()
                .filter(
                  (a) =>
                    a.playState === "running" &&
                    Number(a.effect?.getComputedTiming().duration ?? 0) > 5,
                ).length,
          );
          const visible = await p.evaluate(() => {
            const el = document.querySelector("[data-skeleton] .sk-shapes");
            return el ? Number(getComputedStyle(el).opacity) : 0;
          });
          check(
            `reduced motion ${r.name}: no running animation, shapes fully visible (static)`,
            running === 0 && visible === 1,
            `running=${running} opacity=${visible}`,
          );
        }
        release();
        await p.locator(r.content).first().waitFor({ timeout: 60_000 });
      }
    }
    await ctx.close();
  }

  return out;
}

/** CPU: renderer task time while the loading state is shown for 3 s, then 3 s idle after load. */
async function cpuDuringLoading(browser: Browser, s: Saved) {
  const ctx = await browser.newContext({ storageState: s.A.storage, locale: "es-ES" });
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Performance.enable");
  const taskSeconds = async () =>
    (
      (await cdp.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      }
    ).metrics.find((m) => m.name === "TaskDuration")!.value;
  await p.goto(`${APP}/dashboard/analytics`);
  await p.waitForLoadState("load");
  await p.waitForTimeout(1_000);
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  await p.route("**/*", async (route) => {
    const h = route.request().headers();
    if (h["rsc"] === "1" || route.request().url().includes("_rsc=")) await gate;
    await route.continue();
  });
  await p.locator('a[href="/dashboard"]:visible').first().click();
  await p.locator("[data-skeleton], main > div[role='status'].hud-panel").first().waitFor();
  await p.waitForTimeout(400);
  const a0 = await taskSeconds();
  await p.waitForTimeout(3_000);
  const a1 = await taskSeconds();
  release();
  await p.locator('[data-overlay-item], [data-testid="overlay-kind"]').first().waitFor();
  await p.waitForTimeout(1_500);
  const b0 = await taskSeconds();
  await p.waitForTimeout(3_000);
  const b1 = await taskSeconds();
  await ctx.close();
  return {
    skeletonPulse3sTaskMs: Math.round((a1 - a0) * 1000),
    idleAfterLoad3sTaskMs: Math.round((b1 - b0) * 1000),
  };
}

async function capture() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const metrics: Record<string, unknown> = {};
  for (const key of ["A", "B"] as const) {
    const acc = s[key];
    const ui = key === "A" ? "fight" : "classic";
    for (const r of routes(s, key)) {
      metrics[`${ui}.${r.name}.load`] = await measureLoad(browser, acc, r, `${ui}`);
      metrics[`${ui}.${r.name}.navFast`] = await measureNav(browser, acc, r, ui, 0);
      metrics[`${ui}.${r.name}.navSlow`] = await measureNav(browser, acc, r, ui, 1_500);
      if (key === "A")
        metrics[`${ui}.${r.name}.navSlow390`] = await measureNav(browser, acc, r, ui, 1_500, {
          width: 390,
          height: 844,
        });
    }
  }
  // OBS overlay: never a dashboard loading state; transparent document.
  const octx = await browser.newContext({ viewport: { width: 800, height: 180 } });
  await octx.addInitScript({
    content: `window.__contentSel = ".ov-root, [data-overlay-root], body > *";`,
  });
  await octx.addInitScript({ content: TIMELINE });
  const op = await octx.newPage();
  const res = await op.goto(`${APP}/overlay/${s.ids.A.token}`);
  await op.waitForTimeout(1_500);
  metrics["obs.overlay"] = {
    status: res?.status(),
    loadingFrames: await op.evaluate(
      () =>
        (window as unknown as { __m1: { frames: number[][] } }).__m1.frames.filter(
          (f) => f[1] === 1,
        ).length,
    ),
    skeletonNodes: await op.locator("[data-skeleton], [data-loading-card]").count(),
    bodyBackground: await op.evaluate(() => getComputedStyle(document.body).backgroundColor),
    appCss: await op.evaluate(() =>
      Array.from(document.styleSheets).some((ss) =>
        Array.from(ss.cssRules ?? []).some((r) => r.cssText.includes(".hud-panel")),
      ),
    ),
  };
  await octx.close();
  metrics.cpu = await cpuDuringLoading(browser, s);
  if (LABEL.startsWith("after")) metrics.skeleton = await skeletonChecks(browser, s);
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 1));
  await browser.close();
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
