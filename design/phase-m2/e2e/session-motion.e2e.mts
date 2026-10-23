/**
 * M2B — Fight Session motion: the 19 QA scenarios against a LOCAL production build and a LOCAL
 * database (refuses anything else). Fictitious `@test.local` accounts; matches and profiles
 * enter through the real Companion sync endpoint, so every cue is triggered by the real
 * ingestion → NOTIFY → SSE path. Animations are slowed 10× through the DevTools protocol only
 * while frames are captured (timing is read from the real CSSAnimation objects).
 *
 *   E2E_STATE=/tmp/m2b.json pnpm exec tsx design/phase-m2/e2e/session-motion.e2e.mts setup
 *   E2E_STATE=/tmp/m2b.json pnpm exec tsx design/phase-m2/e2e/session-motion.e2e.mts run <before|after>
 *   E2E_STATE=/tmp/m2b.json pnpm exec tsx design/phase-m2/e2e/session-motion.e2e.mts cleanup
 *
 * Server env for run: FIGHT_SESSION_UI_USERS=<A id> (A = Fight Session, B = classic).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const LABEL = process.argv[3] ?? "after";
const AFTER = LABEL === "after";
const OUT = `design/phase-m2/screenshots/full/m2b-${LABEL}`;
const STATE = process.env.E2E_STATE ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
if (!STATE) throw new Error("E2E_STATE (a path outside the repo) is required");
mkdirSync(`${OUT}/frames`, { recursive: true });
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
  tokenA: string;
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
    externalMatchId: `M2B-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() + seq),
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
  if (!AFTER) return;
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function scrub(p: Page) {
  await p
    .evaluate(() => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode())
        if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
    })
    .catch(() => {});
}
async function shot(p: Page, name: string, full = false) {
  await scrub(p);
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
    const email = `m2b-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
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
    await ctx.close();
    return acc;
  };
  const A = await make("A", "9990000810");
  const B = await make("B", "9990000811");
  const tokenA = (
    await sql<{ public_token: string }[]>`select o.public_token from overlay o
      join sf6_player p on p.id = o.player_id where p.user_id = ${A.id} order by o.created_at limit 1`
  )[0]!.public_token;
  writeFileSync(STATE, JSON.stringify({ A, B, tokenA } satisfies Saved, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

/* ───────── helpers for run ───────── */

const INIT = `window.__name = (f) => f; window.__lt = 0; window.__cls = 0;
  window.__es = []; const ES = window.EventSource;
  window.EventSource = class extends ES { constructor(...a) { super(...a); window.__es.push(this); } };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}`;

/** The running CSS animations (real timing as the browser applies it). */
const running = (p: Page) =>
  p.evaluate(() =>
    document.getAnimations().map((a) => {
      const t = (a.effect as KeyframeEffect).getTiming();
      const target = (a.effect as KeyframeEffect).target as Element | null;
      return {
        name: (a as CSSAnimation).animationName ?? "?",
        target: target?.getAttribute("data-testid") ?? target?.className.toString().slice(0, 60),
        duration: t.duration,
        delay: t.delay,
        iterations: t.iterations,
      };
    }),
  );
const cues = (p: Page) =>
  p.evaluate(
    () =>
      document.querySelectorAll(
        ".fs-hit, .fs-side-flash, .fs-round-new, .fs-stamp-in, .fs-rating-confirmed, .fs-stage-reveal, .fs-recap-in",
      ).length,
  );
const overflow = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Frames of the region while animations play at 1/10 speed; returns the files written. */
async function frames(p: Page, ctx: BrowserContext, name: string, selector: string, count = 6) {
  const files: string[] = [];
  const box = await p.locator(selector).first().boundingBox();
  for (let i = 0; i < count; i++) {
    const path = `${OUT}/frames/${name}-${i}.png`;
    await p.screenshot({
      path,
      clip: box
        ? { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, 700) }
        : undefined,
    });
    files.push(path);
    await p.waitForTimeout(450);
  }
  void ctx;
  return files;
}
/** Waits for an M2B-only state; on the `before` build it just lets the event settle. */
async function soft(p: Page, wait: () => Promise<unknown>) {
  if (AFTER) return void (await wait());
  await wait().catch(() => p.waitForTimeout(1_000));
}
async function slow(p: Page, ctx: BrowserContext, rate: number) {
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: rate });
  return cdp;
}

/* ───────── run ───────── */

async function run() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const timing: Record<string, unknown> = {};
  const metrics: Record<string, unknown> = {};
  const ctx = await browser.newContext({
    storageState: s.A.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript({ content: INIT });
  const streamRequests: string[] = [];
  ctx.on("request", (r) => {
    if (r.url().includes("/api/me/stream")) streamRequests.push(new Date().toISOString());
  });
  const p = await ctx.newPage();
  const cookies = await ctx.cookies();

  // 1. PREPARE
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').waitFor({ timeout: 60_000 });
  await p.waitForTimeout(800);
  await shot(p, "01-prepare");
  check("1 PREPARE initial render has no motion cue", (await cues(p)) === 0);
  metrics.prepare = await p.evaluate(() => {
    const w = window as unknown as { __lt: number; __cls: number };
    return { longTaskMs: Math.round(w.__lt), cls: Number(w.__cls.toFixed(4)) };
  });

  // 3. failed start (expired auth session: the real action refuses) — no LIVE, no reveal
  await ctx.clearCookies();
  await p.locator('[data-k="start"]').click();
  await p.getByText("Tu sesión ha caducado").first().waitFor({ timeout: 15_000 });
  check(
    "3 failed start shows the error and no LIVE stage",
    (await p.locator("#fs-active-title").count()) === 0 &&
      (await p.locator(".fs-stage-reveal").count()) === 0,
  );
  await shot(p, "03-start-failed");
  await ctx.addCookies(cookies);
  await p.reload();
  await p.locator('[data-k="start"]').waitFor();
  await p.waitForTimeout(600);

  // 2. successful start — PREPARE → LIVE stage reveal (frames at 1/10 speed)
  let cdp = await slow(p, ctx, 0.1);
  const t0 = Date.now();
  await p.locator('[data-k="start"]').click();
  await p.locator("#fs-active-title").waitFor({ timeout: 30_000 });
  timing.startToLiveMs = Date.now() - t0;
  timing.reveal = await running(p);
  await frames(p, ctx, "start-reveal", "section#session", 6);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await p.waitForTimeout(500);
  check(
    "2 start: one stage reveal, focus on the LIVE heading",
    AFTER &&
      (await p.locator("section#session.fs-stage-reveal").count()) === 1 &&
      (await p.evaluate(() => document.activeElement?.id)) === "fs-active-title",
  );
  await shot(p, "02-live-started");

  // 4. initial LIVE (refresh straight into LIVE) — 10. refresh
  await p.reload();
  await p.locator("#fs-active-title").waitFor();
  await p.waitForTimeout(800);
  check("4/10 refresh into LIVE: no reveal, no cue", (await cues(p)) === 0);
  await shot(p, "04-live-initial");

  // 5. first new match — frames
  cdp = await slow(p, ctx, 0.1);
  await sync(s.A, { matches: [match("win")] });
  await p.locator(".fs-side-flash, .fs-hit").first().waitFor({ timeout: 20_000 });
  timing.firstMatch = await running(p);
  await frames(p, ctx, "match-win", "section#session", 6);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  check(
    "5 first match: win side hit, one new marker, announcement",
    (await p.locator('[data-testid="fs-wins"].fs-hit').count()) === 1 &&
      (await p.locator("li.fs-round-new").count()) === 1 &&
      ((await p.locator("[aria-live='polite']").first().textContent()) ?? "").includes(
        "Partida registrada",
      ),
  );
  await shot(p, "05-first-match");

  // 6. win then loss
  await sync(s.A, { matches: [match("loss")] });
  await p.locator('[data-testid="fs-losses"].fs-hit').waitFor({ timeout: 20_000 });
  check(
    "6 then a loss: loss side hit only, the new marker is match 2",
    (await p.locator('[data-testid="fs-wins"].fs-hit').count()) === 0 &&
      (await p.locator("li.fs-round-new").getAttribute("aria-label"))?.startsWith("Partida 2") ===
        true,
  );
  await shot(p, "06-loss");

  // 7. several matches in one update — frames
  cdp = await slow(p, ctx, 0.1);
  await sync(s.A, { matches: [match("win"), match("win"), match("loss")] });
  await soft(p, () =>
    p.waitForFunction(() => document.querySelectorAll("li.fs-round-new").length === 3, null, {
      timeout: AFTER ? 20_000 : 8_000,
    }),
  );
  timing.batch = await running(p);
  await frames(p, ctx, "match-batch", "section#session", 6);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  check(
    "7 batch of 3: three new markers, both sides, one summarized announcement",
    (await p.locator("li.fs-round-new").count()) === 3 &&
      (await p.locator(".fs-side-flash").count()) === 2 &&
      ((await p.locator("[aria-live='polite']").first().textContent()) ?? "").startsWith(
        "3 partidas registradas",
      ),
  );
  await shot(p, "07-batch");

  // 11a. pending rating (matches arrived, no new profile yet)
  await p.waitForTimeout(4_500); // «new» marks expire
  const pending = await p.getByText("MR pendiente").count();
  check(
    "11 pending rating: held value, no confirmed accent",
    pending > 0 && (await p.locator(".fs-rating-confirmed").count()) === 0,
  );
  await shot(p, "11-rating-pending");

  // 8. SSE disconnect / reconnect: no cue without a new match, one stream at a time
  const before8 = streamRequests.length;
  // A dropped connection: new attempts fail for a while, the open stream errors out.
  await ctx.route("**/api/me/stream", (r) => r.abort());
  await p.evaluate(() => {
    for (const es of (window as unknown as { __es: EventSource[] }).__es) {
      es.close();
      es.onerror?.(new Event("error"));
    }
  });
  await p.getByText("Reconectando…").first().waitFor({ timeout: 20_000 });
  await shot(p, "08-reconnecting");
  await p.waitForTimeout(3_000);
  await ctx.unroute("**/api/me/stream");
  await p.waitForFunction(() => !document.body.textContent?.includes("Reconectando…"), null, {
    timeout: 45_000,
  });
  await p.waitForTimeout(1_000);
  check(
    "8 SSE reconnect: resync without any cue",
    (await cues(p)) === 0,
    `stream requests during outage+reconnect: ${streamRequests.length - before8}`,
  );

  // 11b. confirmed rating — frames
  cdp = await slow(p, ctx, 0.1);
  await sync(s.A, { profile: profile(s.A.cfn, 1418) });
  await soft(p, () =>
    p
      .locator(".fs-rating-confirmed")
      .first()
      .waitFor({ timeout: AFTER ? 20_000 : 8_000 }),
  );
  timing.rating = await running(p);
  await frames(p, ctx, "rating-confirmed", ".fs-rating", 5);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  check(
    "11 confirmed rating: one accent, value shown, no match cue",
    (await p.locator(".fs-rating-confirmed").count()) === 1 &&
      (await p.locator(".fs-hit, li.fs-round-new").count()) === 0 &&
      ((await p.locator(".fs-rating .fs-num").first().textContent()) ?? "").includes("1418"),
  );

  // 9. back / forward
  await p.goto(`${APP}/dashboard/analytics`);
  await p.waitForLoadState("load");
  await p.goBack();
  await p.locator("#fs-active-title").waitFor();
  await p.waitForTimeout(800);
  const back = await cues(p);
  await p.goForward();
  await p.waitForLoadState("load");
  await p.goBack();
  await p.locator("#fs-active-title").waitFor();
  await p.waitForTimeout(800);
  check("9 back/forward: no replayed cue", back === 0 && (await cues(p)) === 0);

  // Idle CPU in LIVE (30 s), SSE open.
  const cpu = await ctx.newCDPSession(p);
  await cpu.send("Performance.enable");
  const task = async () =>
    (
      (await cpu.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      }
    ).metrics.find((x) => x.name === "TaskDuration")!.value;
  const idle0 = await task();
  await p.waitForTimeout(30_000);
  metrics.idleLiveCpuMsPer30s = Math.round(((await task()) - idle0) * 1000);
  metrics.continuousAnimations = (await running(p)).filter((a) => a.iterations === Infinity);

  // CPU + frames during a match arrival under 4× CPU throttling.
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await p.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __lt: number };
    w.__frames = [];
    w.__lt = 0;
    let last = performance.now();
    const tick = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__frames.length < 600) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const busy0 = await task();
  await sync(s.A, { matches: [match("win")] });
  await p.locator(".fs-hit").first().waitFor({ timeout: 20_000 });
  await p.waitForTimeout(1_500);
  metrics.throttled4x = {
    arrivalCpuMs: Math.round(((await task()) - busy0) * 1000),
    ...(await p.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __lt: number };
      const f = w.__frames.slice(1);
      return {
        frames: f.length,
        p95FrameMs: Number([...f].sort((a, b) => a - b)[Math.floor(f.length * 0.95)]?.toFixed(1)),
        over50ms: f.filter((x) => x > 50).length,
        longTaskMs: Math.round(w.__lt),
      };
    })),
  };
  await cpu.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  metrics.liveCls = await p.evaluate(() =>
    Number((window as unknown as { __cls: number }).__cls.toFixed(4)),
  );

  // 13. failed end (expired auth session) — still LIVE
  await ctx.clearCookies();
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.getByText("Tu sesión ha caducado").first().waitFor({ timeout: 15_000 });
  check(
    "13 failed end: error shown, still LIVE, no recap transition",
    (await p.locator("#fs-active-title").count()) === 1 && !p.url().includes("/sessions/"),
  );
  await shot(p, "13-end-failed");
  await ctx.addCookies(cookies);
  await p.reload();
  await p.locator('[data-k="end"]').waitFor();
  await p.waitForTimeout(500);

  // 12. successful end → 14. RECAP entrance (frames)
  cdp = await slow(p, ctx, 0.1);
  await p.locator('[data-k="end"]').click();
  const t1 = Date.now();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/ended=1/, { timeout: 30_000 });
  await p.locator("#fs-recap-title").waitFor();
  timing.endToRecapMs = Date.now() - t1;
  timing.recap = await running(p);
  await frames(p, ctx, "recap-in", "section[aria-labelledby='fs-recap-title']", 5);
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
  await p.waitForTimeout(400);
  check(
    "12/14 end → RECAP: one restrained entrance, focus on the summary heading",
    AFTER &&
      (await p.locator(".fs-recap-in").count()) === 1 &&
      (await p.evaluate(() => document.activeElement?.id)) === "fs-recap-title",
  );
  await shot(p, "14-recap", true);

  // 15. start another session (RECAP → PREPARE → LIVE)
  await p.getByRole("link", { name: /Preparar otra sesión/ }).click();
  await p.locator('[data-k="start"]').waitFor({ timeout: 30_000 });
  await p.waitForTimeout(600);
  check("15 RECAP → PREPARE: no artificial motion or wait", (await cues(p)) === 0);
  await shot(p, "15-prepare-again");
  await p.locator('[data-k="start"]').click();
  await p.locator("#fs-active-title").waitFor({ timeout: 30_000 });
  check("15 start another: the reveal plays again", (await cues(p)) >= 1);
  await p.waitForTimeout(800);

  // 16. reduced motion — cues collapse, content immediately in place
  const rctx = await browser.newContext({
    storageState: s.A.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const rp = await rctx.newPage();
  await rp.goto(`${APP}/dashboard`);
  await rp.locator("#fs-active-title").waitFor();
  await rp.waitForTimeout(600);
  await sync(s.A, { matches: [match("loss"), match("win")] });
  await rp.locator("li.fs-round-new").first().waitFor({ timeout: 20_000 });
  const reduced = await running(rp);
  const sideOpacity = await rp.evaluate(() =>
    Array.from(document.querySelectorAll(".fs-side")).map((e) => getComputedStyle(e).opacity),
  );
  check(
    "16 reduced motion: no animation longer than 1 ms, no delays, content opaque",
    reduced.every((a) => Number(a.duration) <= 1 && Number(a.delay) === 0) &&
      sideOpacity.every((o) => o === "1"),
    `${reduced.length} animations`,
  );
  check(
    "16 reduced motion: the static «new» marks and announcement remain",
    (await rp.locator("li.fs-round-new").count()) === 2 &&
      ((await rp.locator("[aria-live='polite']").first().textContent()) ?? "").length > 0,
  );
  await scrub(rp);
  await rp.screenshot({ path: `${OUT}/16-reduced-motion.png` });
  await rctx.close();

  // 17. mobile 360 / 390 + 200 % text
  for (const w of [360, 390]) {
    const mctx = await browser.newContext({
      storageState: s.A.storage,
      locale: "es-ES",
      viewport: { width: w, height: 800 },
    });
    const mp = await mctx.newPage();
    await mp.goto(`${APP}/dashboard`);
    await mp.locator("#fs-active-title").waitFor();
    await mp.waitForTimeout(600);
    check(`17 mobile ${w}: LIVE without horizontal overflow`, (await overflow(mp)) <= 0);
    await scrub(mp);
    await mp.screenshot({ path: `${OUT}/17-live-${w}.png`, fullPage: true });
    await mp.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await mp.waitForTimeout(300);
    check(`9 200 % text at ${w}: LIVE without horizontal overflow`, (await overflow(mp)) <= 0);
    if (w === 390) await mp.screenshot({ path: `${OUT}/17-live-390-text200.png`, fullPage: true });
    await mctx.close();
  }
  await english(s, browser);

  // End the session (leave the account idle), then 18. classic fallback
  await p.reload();
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/ended=1/, { timeout: 30_000 });

  const bctx = await browser.newContext({
    storageState: s.B.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
  });
  const bp = await bctx.newPage();
  await bp.goto(`${APP}/dashboard`);
  await bp.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
  await bp.getByRole("button", { name: "Finalizar sesión" }).first().waitFor({ timeout: 30_000 });
  await bp.waitForTimeout(1_500);
  await sync(s.B, { matches: [match("win")] });
  await bp.waitForTimeout(3_000);
  check(
    "18 classic fallback: start + match work, no Fight Session stage or cue",
    (await bp.locator(".fs-stage").count()) === 0 && (await cues(bp)) === 0,
  );
  await scrub(bp);
  await bp.screenshot({ path: `${OUT}/18-classic.png` });
  await bp.getByRole("button", { name: "Finalizar sesión" }).first().click();
  await bp.getByRole("button", { name: "Sí, finalizar sesión" }).first().click();
  await bp.waitForURL(/ended=1/, { timeout: 30_000 });
  check(
    "18 classic recap: no Fight Session entrance",
    (await bp.locator(".fs-recap-in").count()) === 0,
  );
  await bctx.close();

  // 19. OBS source isolation
  const octx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const op = await octx.newPage();
  await op.goto(`${APP}/overlay/${s.tokenA}`);
  await op.waitForLoadState("load");
  await op.waitForTimeout(1_500);
  const obs = await op.evaluate(async () => {
    let css = "";
    for (const l of Array.from(document.querySelectorAll('link[rel="stylesheet"]')))
      css += await fetch((l as HTMLLinkElement).href).then((r) => r.text());
    return {
      cueRules: /fs-stage-reveal|fs-side-flash|fs-rating-confirmed|fs-recap-in/.test(css),
      fsElements: document.querySelectorAll("[class*='fs-']").length,
    };
  });
  check(
    "19 OBS overlay: no Fight Session motion rules or elements",
    !obs.cueRules && obs.fsElements === 0,
  );
  await octx.close();

  metrics.sseRequestsMainPage = streamRequests.length;
  writeFileSync(`${OUT}/timing.json`, JSON.stringify(timing, null, 2));
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ timing: Object.keys(timing), metrics }, null, 2));
  await browser.close();
}

/** ES/EN: the account preference decides the locale (test account only, restored after). */
async function english(s: Saved, browser: Browser) {
  await sql`update auth_user set locale = 'en' where id = ${s.A.id} and email like '%@test.local'`;
  try {
    const ectx = await browser.newContext({
      storageState: s.A.storage,
      locale: "en-US",
      viewport: { width: 1440, height: 900 },
    });
    const ep = await ectx.newPage();
    await ep.goto(`${APP}/dashboard`);
    await ep.locator("#fs-active-title, [data-k='start']").first().waitFor();
    if (await ep.locator("[data-k='start']").count()) {
      await ep.locator("[data-k='start']").click();
      await ep.locator("#fs-active-title").waitFor({ timeout: 30_000 });
    }
    await ep.waitForTimeout(800);
    await sync(s.A, { matches: [match("win"), match("loss")] });
    await ep.locator("li.fs-round-new").first().waitFor({ timeout: 20_000 });
    const en = (await ep.locator("[aria-live='polite']").first().textContent()) ?? "";
    check("9 EN: batch announcement in English", en.startsWith("2 matches recorded"), en);
    await scrub(ep);
    await ep.screenshot({ path: `${OUT}/09-live-en.png` });
    await ectx.close();
  } finally {
    await sql`update auth_user set locale = 'es' where id = ${s.A.id} and email like '%@test.local'`;
  }
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id in (${s.A.id}, ${s.B.id}) and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "run") await run();
else if (PHASE === "cleanup") await cleanup();
else if (PHASE === "en") {
  const browser = await chromium.launch();
  await english(JSON.parse(readFileSync(STATE, "utf8")) as Saved, browser);
  await browser.close();
} else throw new Error("phase: setup | run <label> | en | cleanup");
if (results.length) {
  // `en` re-runs one scenario: it replaces that check in the full run's results.
  const file = `${OUT}/checks.json`;
  const all =
    PHASE === "en"
      ? (JSON.parse(readFileSync(file, "utf8")) as { results: typeof results }).results.map(
          (r) => results.find((x) => x.check === r.check) ?? r,
        )
      : results;
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), results: all }, null, 2));
}
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
