/**
 * Phase 5.6D — browser E2E and measurements of the polished Fight Session dashboard against a
 * LOCAL production build and a LOCAL database (refuses anything else). Fictitious `@test.local`
 * accounts; Companion data goes through the real sync endpoint; sessions start/end through the
 * real UI and server actions.
 *
 *   E2E_STATE=/some/tmp/file.json pnpm exec tsx design/phase-5-6d/e2e/ux.e2e.mts <phase>
 *
 * Phases (the server env differs between them, see design/phase-5-6d/README.md):
 *   setup     server WITHOUT FIGHT_SESSION_UI_USERS: accounts A (tester) and B, pair, sync, overlays.
 *   baseline  server WITH FIGHT_SESSION_UI_USERS=<A id>, built from main: «before» captures.
 *   run       same env, built from this branch: the full lifecycle, console, a11y, perf checks.
 *   rollback  server WITHOUT the variable again: A is back on the classic dashboard.
 *   cleanup   delete both accounts.
 * The state file (ids, local device tokens, browser storage) never goes into the repository.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const OUT = `design/phase-5-6d/screenshots/full/${PHASE}`;
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
  email: string;
  cfn: string;
  deviceToken: string;
  storage: string;
}
type Saved = { A: Account; B: Account };

/* ───────── Companion data through the real sync endpoint ───────── */

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
const match = (
  result: "win" | "loss",
  playedAt = new Date(Date.now() - 1_000),
  opponent?: string,
) =>
  core.toWireMatch({
    externalMatchId: `E2E-${Date.now()}-${++seq}`,
    playedAt,
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponent: { name: opponent ?? `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
    ratingBefore: null,
    ratingAfter: null,
  });
const lastSync = new Map<string, number>();
async function sync(acc: Pick<Account, "cfn" | "deviceToken">, body: Record<string, unknown>) {
  const wait = (lastSync.get(acc.cfn) ?? 0) + 6_200 - Date.now(); // 1 sync / 5 s per device
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
  lastSync.set(acc.cfn, Date.now());
  if (res.status !== 200) throw new Error(`sync ${res.status}`);
}

/* ───────── checks & helpers ───────── */

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
const metrics: Record<string, unknown> = {};
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function shot(p: Page, name: string, full = true) {
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
    for (const i of Array.from(document.querySelectorAll("input")))
      if (i.value.includes("/overlay/")) i.value = i.value.replace(/overlay\/.*/, "overlay/••••••");
  });
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
}
async function overflowX(p: Page) {
  return p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
/** Elements whose box leaves the viewport horizontally (the cause of an overflow). */
async function escapers(p: Page) {
  return p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll("header *, main *"))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.right > vw + 1;
      })
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}.${(e.getAttribute("class") ?? "").split(" ")[0]}`);
  });
}
/** Text clipped inside its own box (scrollWidth > clientWidth with hidden overflow). */
async function clippedHeaderLabels(p: Page) {
  return p.evaluate(() =>
    Array.from(document.querySelectorAll("body > div > header a, body > div > header button"))
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => (e.textContent ?? "").trim()),
  );
}
async function ctxFor(
  browser: Browser,
  acc: Account,
  opts: Parameters<Browser["newContext"]>[0] = {},
) {
  const ctx = await browser.newContext({
    storageState: acc.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    ...opts,
  });
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  return ctx;
}
async function setLocale(ctx: BrowserContext, acc: Account, locale: "es" | "en") {
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: APP }]);
  await sql`update auth_user set locale = ${locale} where id = ${acc.id}`;
}
const latestSession = async (userId: string) =>
  (
    await sql<
      { id: string; status: string }[]
    >`select gs.id, gs.status from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${userId} order by gs.started_at desc limit 1`
  )[0];
const playerOf = async (userId: string) =>
  (await sql<{ id: string }[]>`select id from sf6_player where user_id = ${userId}`)[0]!.id;
const tokensOf = async (userId: string) =>
  (
    await sql<
      { t: string }[]
    >`select o.public_token t from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${userId} order by 1`
  ).map((r) => r.t);
async function endActive(...ids: string[]) {
  await sql`update game_session set status = 'ended', ended_at = now()
    where status = 'active' and player_id in (select id from sf6_player where user_id in ${sql(ids)})`;
}

/** Height of the right-hand console and of its overlay module (the 5.6D priority one). */
async function consoleMetrics(p: Page) {
  return p.evaluate(() => {
    const aside = document.querySelector("aside#overlays, aside");
    const items = Array.from(document.querySelectorAll("[data-overlay-item], aside ul > li"));
    const first = items[0]?.getBoundingClientRect();
    const actions = Array.from(document.querySelectorAll("aside a, aside button"))
      .map((e) => e.textContent?.trim() ?? "")
      .filter(Boolean);
    return {
      consoleHeight: Math.round(aside?.getBoundingClientRect().height ?? 0),
      firstOverlayHeight: Math.round(first?.height ?? 0),
      overlayItems: items.length,
      // Distance from the top of the console to the first «Copy OBS URL» button.
      firstCopyOffset: (() => {
        const btn = Array.from(document.querySelectorAll("aside button")).find((b) =>
          /copiar url|copy url|copiar url de obs|copy obs url/i.test(b.textContent ?? ""),
        );
        const a = aside?.getBoundingClientRect();
        return btn && a ? Math.round(btn.getBoundingClientRect().top - a.top) : null;
      })(),
      actions: actions.length,
    };
  });
}

/** Header at 200 % text (CSS root size, like Chrome's font-size setting) and at 200 % zoom. */
async function headerScaling(p: Page, label: string, path: string) {
  const out: Record<string, unknown> = {};
  for (const w of [1440, 1024, 768, 430, 390, 360]) {
    await p.setViewportSize({ width: w, height: 900 });
    await p.goto(`${APP}${path}`);
    await p.locator("body > div > header").waitFor();
    await p.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await p.waitForTimeout(250);
    const ox = await overflowX(p);
    const clipped = await clippedHeaderLabels(p);
    const signOut = await p
      .getByRole("button", { name: /cerrar sesión|log out|sign out/i })
      .first()
      .boundingBox();
    const vw = w;
    out[`text200@${w}`] = { overflowPx: ox, clipped, escapers: ox > 0 ? await escapers(p) : [] };
    if (PHASE !== "baseline")
      check(
        `${label}: text 200 % at ${w}px — no horizontal overflow, sign-out reachable, no clipped labels`,
        ox <= 0 && signOut !== null && signOut.x + signOut.width <= vw + 1 && clipped.length === 0,
        `overflow ${ox}px; clipped=${clipped.join(",")}`,
      );
    if (w === 390 || w === 1024) await shot(p, `${label}--header-text200--${w}`, false);
  }
  // Browser zoom 200 % on a 1440×900 window ≈ a 720×450 CSS viewport at DPR 2.
  await p.setViewportSize({ width: 720, height: 450 });
  await p.goto(`${APP}${path}`);
  await p.locator("body > div > header").waitFor();
  const oz = await overflowX(p);
  out["zoom200@1440"] = { overflowPx: oz };
  if (PHASE !== "baseline")
    check(`${label}: browser zoom 200 % (720 CSS px) — no horizontal overflow`, oz <= 0, `${oz}px`);
  await shot(p, `${label}--zoom200`, false);
  await p.setViewportSize({ width: 1440, height: 900 });
  return out;
}

/* ───────── phases ───────── */

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../../src/server/db/client");
  const make = async (key: "A" | "B", cfn: string): Promise<Account> => {
    const ctx = await browser.newContext({ locale: "es-ES" });
    const page = await ctx.newPage();
    const email = `fs-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
    await page.goto(`${APP}/signup`);
    await page.fill("#name", `Tester ${key}`);
    await page.fill("#email", email);
    await page.fill("#password", `e2e-${randomUUID()}`);
    await page.click('button[type="submit"]');
    await page.waitForURL(/onboarding/);
    const id = (await sql<{ id: string }[]>`select id from auth_user where email = ${email}`)[0]
      ?.id;
    if (!id) throw new Error("account not created");
    const { code } = await createPairingCode(getDb(), id);
    const pair = await fetch(`${APP}/api/companion/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, deviceName: `E2E ${key}` }),
    });
    const deviceToken = ((await pair.json()) as { deviceToken: string }).deviceToken; // never printed
    const acc = { key, id, email, cfn, deviceToken, storage: `${STATE}.${key}.storage.json` };
    await sync(acc, { profile: profile(cfn, 1402), battlelogObserved: true });
    await page.fill("#cfn", cfn);
    await page.getByRole("button", { name: "Buscar jugador" }).click();
    await page.getByText("Jugador encontrado").waitFor();
    await page.getByRole("button", { name: /Soy yo/ }).click();
    await page.waitForURL(/dashboard/);
    await ctx.storageState({ path: acc.storage });
    await ctx.close();
    return acc;
  };
  const A = await make("A", "9990000400");
  const B = await make("B", "9990000401");
  // Overlays as the builder saves them: a session overlay and a rank progress overlay, for both.
  const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } =
    await import("../../../src/domain/overlay/rank-progress");
  const { DEFAULT_SESSION_OVERLAY_CONFIG } = await import("../../../src/domain/overlay/config");
  const token = () =>
    Buffer.from(randomUUID() + randomUUID())
      .toString("base64url")
      .slice(0, 32);
  for (const acc of [A, B]) {
    const playerId = await playerOf(acc.id);
    await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${"Marcador de sesión"}, ${token()}, ${sql.json({ ...DEFAULT_SESSION_OVERLAY_CONFIG, locale: "es" } as postgres.JSONValue)})`;
    await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${"Progreso de rango"}, ${token()}, ${sql.json({ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "es" } as postgres.JSONValue)})`;
  }
  writeFileSync(STATE, JSON.stringify({ A, B } satisfies Saved, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

/** «Before» captures on the main build (no assertions on the new behaviour). */
async function baseline() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  await endActive(A.id, B.id);
  const browser = await chromium.launch();
  const ctx = await ctxFor(browser, A);
  const p = await ctx.newPage();
  await sync(A, { profile: profile(A.cfn, 1402), battlelogObserved: true });
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').waitFor();
  metrics.prepareConsole1440 = await consoleMetrics(p);
  await shot(p, "prepare--first--1440");
  for (const [w, h] of [
    [390, 844],
    [1280, 720],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`${APP}/dashboard`);
    await p.locator('[data-k="start"]').waitFor();
    metrics[`prepareConsole${w}`] = await consoleMetrics(p);
    metrics[`prepareDoc${w}`] = await p.evaluate(() => document.documentElement.scrollHeight);
    await shot(p, `prepare--first--${w}`);
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  metrics.headerFight = await headerScaling(p, "fight", "/dashboard");
  metrics.headerClassic = await headerScaling(p, "classic", "/dashboard?ui=classic");

  // LIVE with one match, then RECAP and PREPARE-after-session.
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').click();
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await p.waitForTimeout(3_000);
  await sync(A, {
    matches: [match("win")],
    profile: profile(A.cfn, 1414),
    battlelogObserved: true,
  });
  await p.waitForFunction(() => (document.body.textContent ?? "").includes("en 1 partida"), null, {
    timeout: 30_000,
  });
  await shot(p, "live--1match--1440");
  await p.setViewportSize({ width: 390, height: 844 });
  await shot(p, "live--1match--390");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/ended=1/, { timeout: 30_000 });
  await shot(p, "recap--1match--1440");
  await p.goto(`${APP}/dashboard`);
  await p.locator('[data-k="start"]').waitFor();
  await shot(p, "prepare--after--1440");
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
  await browser.close();
}

/* ───────── run helpers ───────── */

/** Chromium with the browser's own default font size at 32 px (= «text 200 %» in settings). */
async function textScaledContext(acc: Account) {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "sst-font-"));
  mkdirSync(join(dir, "Default"), { recursive: true });
  writeFileSync(
    join(dir, "Default", "Preferences"),
    JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }),
  );
  const ctx = await chromium.launchPersistentContext(dir, { channel: "chromium", locale: "es-ES" });
  await ctx.addCookies(
    (
      JSON.parse(readFileSync(acc.storage, "utf8")) as {
        cookies: Parameters<BrowserContext["addCookies"]>[0];
      }
    ).cookies,
  );
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  return ctx;
}
/** The fixed mobile action bar must never hide the end of the page. */
async function fixedBarHidesEnd(p: Page) {
  return p.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 100));
    const bar = Array.from(document.querySelectorAll("main *")).find(
      (e) => getComputedStyle(e).position === "fixed",
    );
    if (!bar) return false;
    const top = bar.getBoundingClientRect().top;
    const main = document.querySelector("main")!;
    const blocks = Array.from(
      main.querySelectorAll("section, aside, nav, li, p, a, button"),
    ).filter((e) => !bar.contains(e) && e.getBoundingClientRect().height > 0);
    const lastBottom = Math.max(...blocks.map((e) => e.getBoundingClientRect().bottom));
    return lastBottom > top + 1;
  });
}
/** Visible tap targets smaller than 24×24 CSS px (WCAG 2.2 SC 2.5.8), inline text links excluded. */
async function tinyTargets(p: Page) {
  return p.evaluate(() =>
    Array.from(
      document.querySelectorAll("main a, main button, main summary, header a, header button"),
    )
      .filter((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const inlineText = e.tagName === "A" && getComputedStyle(e).display === "inline";
        return !inlineText && (r.width < 24 || r.height < 24);
      })
      .map((e) => (e.textContent ?? "").trim().slice(0, 24) || e.tagName),
  );
}
async function median(fn: () => Promise<number>, n = 5) {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(await fn());
  xs.sort((a, b) => a - b);
  return Math.round(xs[Math.floor(n / 2)]!);
}
async function cookieHeader(acc: Account) {
  const { cookies } = JSON.parse(readFileSync(acc.storage, "utf8")) as {
    cookies: Array<{ name: string; value: string }>;
  };
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}
/** Server render time of a full authenticated page (first byte → end of the streamed body). */
async function ssrMs(acc: Account, path: string) {
  const cookie = await cookieHeader(acc);
  return median(async () => {
    const t0 = performance.now();
    const res = await fetch(`${APP}${path}`, { headers: { cookie } });
    await res.text();
    return performance.now() - t0;
  });
}

async function run() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  await endActive(A.id, B.id);
  const browser = await chromium.launch();
  const tokensBefore = await tokensOf(A.id);
  const overlaysA = await sql<
    { id: string; name: string; public_token: string }[]
  >`select o.id, o.name, o.public_token from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${A.id} order by o.created_at`;

  const ctx = await ctxFor(browser, A, { permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (
      m.type() === "error" &&
      !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|EventSource/.test(m.text())
    )
      errors.push(m.text());
  });
  const start = p.locator('[data-k="start"]');

  /* 1. Gate */
  await sync(A, { profile: profile(A.cfn, 1402), battlelogObserved: true });
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  check(
    "gate: allowlisted A gets Fight Session",
    (await p.locator('[data-dashboard-ui="fight-session"]').count()) === 1,
  );
  const bctx = await ctxFor(browser, B, { extraHTTPHeaders: { "x-ui": "fight-session" } });
  await bctx.addCookies([{ name: "ui", value: "fight-session", url: APP }]);
  await bctx.addInitScript({ content: "localStorage.setItem('ui','fight-session');" });
  const bp = await bctx.newPage();
  await bp.goto(`${APP}/dashboard?ui=fight-session`);
  await bp.locator("body > div > header").waitFor();
  check(
    "gate: B cannot force Fight Session (query + cookie + header + localStorage)",
    (await bp.locator('[data-dashboard-ui="fight-session"]').count()) === 0 &&
      (await bp.locator("[data-overlay-item]").count()) === 0 &&
      (await bp.locator("aside input[readonly]").count()) === (await tokensOf(B.id)).length,
    "classic console keeps the detailed rows (one URL field per overlay)",
  );
  const leakA = await bp.goto(`${APP}/dashboard/overlays/${overlaysA[0]!.id}`);
  const bText = ((await bp.locator("body").innerText()) ?? "").toLowerCase();
  check(
    "privacy: B cannot open A's overlay configuration (no token, no name)",
    !bText.includes(overlaysA[0]!.public_token.toLowerCase()) &&
      (await bp.locator("input[readonly]").count()) === 0,
    `HTTP ${leakA?.status()}`,
  );
  await bctx.close();

  /* 2. SSE: exactly one stream per dashboard, Fight Session and classic alike */
  for (const path of ["/dashboard", "/dashboard?ui=classic"]) {
    const urls: string[] = [];
    const onReq = (r: { url(): string }) => {
      if (r.url().includes("/api/me/stream")) urls.push(r.url());
    };
    p.on("request", onReq);
    await p.goto(`${APP}${path}`);
    await p.waitForTimeout(4_000);
    p.off("request", onReq);
    check(
      `network: one SSE stream on ${path}`,
      urls.length === 1,
      `${urls.length} stream request(s)`,
    );
  }
  await p.goto(`${APP}/dashboard?ui=classic`);
  check(
    "classic: ?ui=classic keeps the classic dashboard (detailed console, classic panels)",
    (await p.locator('[data-dashboard-ui="fight-session"]').count()) === 0 &&
      (await p.locator("aside input[readonly]").count()) === overlaysA.length,
  );

  /* 3. Overlay console */
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  metrics.console1440 = await consoleMetrics(p);
  check(
    "console: one compact row per overlay, details folded, no URL field visible",
    (await p.locator("[data-overlay-item]").count()) === overlaysA.length &&
      (await p.locator("[data-overlay-item] details[open]").count()) === 0 &&
      (await p.locator("aside input[readonly]:visible").count()) === 0,
  );
  check(
    "console: shorter than before (2203 px on main at 1440)",
    (metrics.console1440 as { consoleHeight: number }).consoleHeight < 1500,
    `${(metrics.console1440 as { consoleHeight: number }).consoleHeight} px`,
  );
  await shot(p, "prepare--1440");
  // Copy OBS URL → exact URL with token
  const rank = overlaysA.find((o) => o.name === "Progreso de rango")!;
  const rankRow = p.locator(`[data-overlay-item="${rank.id}"]`);
  await rankRow.getByRole("button", { name: /Copiar URL para OBS de Progreso de rango/ }).click();
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check(
    "copy: «Copiar URL para OBS» copies the exact public URL (token unchanged)",
    clip === `${APP}/overlay/${rank.public_token}`,
  );
  check(
    "copy: visible + announced feedback",
    (await rankRow.locator("button[data-copy-status='copied']").count()) === 1 &&
      ((await rankRow.locator("[aria-live='polite']").first().textContent()) ?? "").length > 0,
  );
  // Keyboard: details via Tab + Enter, then the preview link and the URL field
  // Reach «Detalles» by keyboard from the copy button just used (Copy → Configure → Detalles).
  await p.keyboard.press("Tab");
  await p.keyboard.press("Tab");
  const onSummary = await p.evaluate(() => document.activeElement?.tagName === "SUMMARY");
  const summaryOutline = await p.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as Element);
    return `${cs.outlineStyle} ${cs.outlineWidth}`;
  });
  await p.keyboard.press("Enter");
  check(
    "keyboard: «Detalles» opens with Enter and has a visible focus outline",
    onSummary &&
      (await rankRow.locator("details[open]").count()) === 1 &&
      !summaryOutline.startsWith("none"),
    summaryOutline,
  );
  const preview = rankRow.locator('a[target="_blank"]');
  check(
    "details: canvas/language/style + full URL + the same public preview",
    (await rankRow.innerText()).includes("640 × 140") &&
      (await rankRow.locator("input[readonly]").inputValue()) ===
        `${APP}/overlay/${rank.public_token}` &&
      (await preview.getAttribute("href")) === `${APP}/overlay/${rank.public_token}`,
  );
  await shot(p, "console--details-open--1440", false);
  await p.keyboard.press("Space");
  check("keyboard: Space closes it again", (await rankRow.locator("details[open]").count()) === 0);
  const pub = await fetch(`${APP}/overlay/${rank.public_token}`);
  check("preview: the public overlay still renders (HTTP 200)", pub.status === 200);
  await rankRow.getByRole("link", { name: /Configurar Progreso de rango/ }).click();
  await p.waitForURL(new RegExp(`/dashboard/overlays/${rank.id}$`));
  check("configure: same builder route", true);
  await p.goto(`${APP}/dashboard#creator-beta`);
  await p.waitForTimeout(800);
  check(
    "Creator beta: a #creator-beta link (from the builder) opens the folded module",
    (await p.locator("details#creator-beta[open]").count()) === 1,
  );

  /* 4. Tracking states: ready, Companion silent (attention path), recovery */
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  check(
    "tracking: «Seguimiento ● Listo para registrar» when data is fresh",
    (await p.locator("[data-tracking='ready']").count()) === 1,
  );
  await sql`update companion_device set last_seen_at = now() - interval '10 minutes' where user_id = ${A.id}`;
  await sql`update companion_snapshot set profile_observed_at = now() - interval '10 minutes', matches_observed_at = now() - interval '10 minutes' where user_id = ${A.id}`;
  await p.reload();
  await start.waitFor();
  check(
    "Companion silent: «Companion sin señal», diagnostics link, start blocked with the reason",
    (await p.locator("[data-tracking='disconnected']").count()) === 1 &&
      (await p.getByRole("link", { name: "Ver diagnóstico" }).count()) === 1 &&
      (await start.isDisabled()) &&
      (await p.locator("#fs-start-why").count()) === 1,
  );
  await shot(p, "prepare--companion-silent--1440", false);
  await p.getByRole("link", { name: "Ver diagnóstico" }).click();
  await p.waitForTimeout(400);
  check(
    "diagnostics: the Companion module (status, Buckler, version, devices) is in view",
    await p.evaluate(() => {
      const el = document.getElementById("companion");
      const r = el?.getBoundingClientRect();
      return (
        !!r &&
        r.top < window.innerHeight &&
        r.bottom > 0 &&
        (el?.textContent ?? "").includes("Buckler")
      );
    }),
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await shot(p, "prepare--companion-silent--390", false);
  await p.setViewportSize({ width: 1440, height: 900 });
  await sync(A, { profile: profile(A.cfn, 1402), battlelogObserved: true });
  await p.reload();
  await start.waitFor();

  /* 5. PREPARE → START → LIVE */
  await start.focus();
  await start.press("Enter");
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await p.waitForTimeout(300);
  check(
    "start: focus moves to the LIVE heading (not lost to <body>)",
    (await p.evaluate(() => document.activeElement?.id)) === "fs-active-title",
  );
  check(
    "tracking: «Registrando partidas» during the session",
    (await p.locator("[data-tracking='tracking']").count()) === 1,
  );
  // Wait past the 5 s provider cache after start (see report: pre-existing end-of-session issue).
  await p.waitForTimeout(6_000);
  const cls = await p.evaluate(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
      }>)
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: false });
    return true;
  });
  const longName = "UnRivalConNombreLarguisimoXX";
  await sync(A, {
    matches: [match("win", undefined, longName)],
    profile: profile(A.cfn, 1414),
    battlelogObserved: true,
  });
  await p.waitForFunction(() => (document.body.textContent ?? "").includes("en 1 partida"), null, {
    timeout: 30_000,
  });
  check(
    "LIVE: match arrives through SSE with the «Nueva» marker and a polite announcement",
    (await p.getByText("Nueva", { exact: true }).count()) === 1 &&
      (await p.locator("[aria-live='polite']").allTextContents()).join(" ").includes("Victoria"),
  );
  check(
    "LIVE: 1402 → 1414 MR +12 (per character, from the engine)",
    /1402[\s\S]*1414[\s\S]*\+12/.test(await p.locator("#session").innerText()),
  );
  metrics.liveCls = cls
    ? await p.evaluate(() => (window as unknown as { __cls: number }).__cls)
    : null;
  check(
    "LIVE: new match / rating update cause no layout shift beyond 0.1 (CLS)",
    (metrics.liveCls as number) < 0.1,
    String(metrics.liveCls),
  );
  await shot(p, "live--1440", false);
  // A loss and the next profile observation (1405): the change follows the engine (+3).
  await sync(A, {
    matches: [match("loss")],
    profile: profile(A.cfn, 1405),
    battlelogObserved: true,
  });
  await p.waitForFunction(() => (document.body.textContent ?? "").includes("en 2 partidas"), null, {
    timeout: 30_000,
  });
  await p.waitForFunction(
    () => /\+3\b/.test(document.getElementById("session")?.innerText ?? ""),
    null,
    {
      timeout: 30_000,
    },
  );
  check("LIVE: rating update 1414 → 1405 shown as the session change +3", true);
  await shot(p, "live--2matches--1440", false);
  // Mobile LIVE, long opponent name
  for (const [w, h] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(250);
    check(`LIVE ${w}×${h}: no horizontal overflow (long opponent name)`, (await overflowX(p)) <= 0);
    if (w === 390) await shot(p, "live--390", true);
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  // SSE reconnect: the local server crashes and restarts (same env); the dashboard must say it
  // and recover by itself.
  const { execFileSync } = await import("node:child_process");
  const srv = process.env.E2E_SERVER_SCRIPT ?? "";
  if (srv) {
    // A hard crash (SIGKILL): a graceful stop would keep serving the open stream until it ends.
    execFileSync("bash", ["-c", "kill -9 $(pgrep -f '[n]ext-server') 2>/dev/null; true"]);
    const sawReconnect = await p
      .getByText("Reconectando…")
      .waitFor({ timeout: 70_000 })
      .then(
        () => true,
        () => false,
      );
    await shot(p, "live--reconnecting--1440", false);
    execFileSync("bash", [srv, "start", A.id]);
    const recovered = await p
      .getByText("Reconectando…")
      .waitFor({ state: "detached", timeout: 60_000 })
      .then(
        () => true,
        () => false,
      );
    check(
      "SSE: server restart is said («Reconectando…») and the stream recovers by itself",
      sawReconnect && recovered,
      `seen=${sawReconnect} recovered=${recovered}`,
    );
  }
  // End: cancel keeps playing, focus back on End
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="cancel-end"]').click();
  check(
    "end: cancel keeps the session; focus returns to «Finalizar sesión»",
    (await p.locator('[data-k="end"]').count()) === 1 &&
      (await p.evaluate(() => document.activeElement?.getAttribute("data-k"))) === "end",
  );
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/\/dashboard\/sessions\/.+ended=1/, { timeout: 30_000 });
  await p.locator("[data-recap-ui]").waitFor();
  const liveId = (await latestSession(A.id))!.id;
  check(
    "RECAP: saved confirmation, 2 · 1 · 1 · 50 %, Ryu 1402 → 1405 MR",
    (await p.getByText("Sesión finalizada y guardada").count()) === 1 &&
      /2[\s\S]*1[\s\S]*1[\s\S]*50\s%/.test(
        await p.locator("[data-testid='fs-session-results']").innerText(),
      ) &&
      /1402 → 1405 MR/.test(await p.locator("[data-recap-ui]").innerText()),
  );
  await shot(p, "recap--1440");
  await p.getByRole("link", { name: "Preparar otra sesión" }).click();
  await p.waitForURL(/\/dashboard(#[\w#-]*)?$/);
  await start.waitFor();
  check(
    "RECAP → PREPARE: «Tu última sesión» shows the saved session",
    (await p.getByText("Tu última sesión").count()) === 1 &&
      /\+3/.test(await p.locator("#session").innerText()),
  );
  await shot(p, "prepare--after-session--1440");

  /* 6. Responsive PREPARE + RECAP, ES and EN */
  for (const [locale, sizes] of [
    [
      "es",
      [
        [360, 800],
        [390, 844],
        [430, 932],
        [768, 1024],
        [1280, 720],
        [1440, 900],
        [1920, 1080],
      ],
    ],
    [
      "en",
      [
        [390, 844],
        [1440, 900],
      ],
    ],
  ] as const) {
    await setLocale(ctx, A, locale);
    for (const [w, h] of sizes) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`${APP}/dashboard`);
      await start.waitFor();
      await p.evaluate(() => document.fonts.ready);
      const ox = await overflowX(p);
      const hidden = w < 640 ? await fixedBarHidesEnd(p) : false;
      const tiny = await tinyTargets(p);
      check(
        `PREPARE ${locale} ${w}×${h}: no overflow, fixed CTA never hides the page end, targets ≥ 24 px`,
        ox <= 0 && !hidden && tiny.length === 0,
        `overflow ${ox}; hidesEnd=${hidden}; tiny=${tiny.join(",")}`,
      );
      await shot(p, `prepare--${locale}--${w}x${h}`, w < 800);
      await p.goto(`${APP}/dashboard/sessions/${liveId}`);
      await p.locator("[data-recap-ui]").waitFor();
      check(`RECAP ${locale} ${w}×${h}: no horizontal overflow`, (await overflowX(p)) <= 0);
      if (w === 390 || w === 1440) await shot(p, `recap--${locale}--${w}x${h}`, w < 800);
    }
  }
  await setLocale(ctx, A, "es");
  await p.setViewportSize({ width: 1440, height: 900 });

  /* 7. Mobile flow: find overlays → copy → configure (390) */
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  await p.getByRole("link", { name: /Ir a tus overlays/ }).click();
  await p.waitForTimeout(400);
  const firstCopy = p.locator("[data-overlay-item] button[data-copy-status]").first();
  check(
    "mobile: «Ir a tus overlays» brings the first Copy OBS URL into view",
    (await firstCopy.isVisible()) && (await firstCopy.boundingBox())!.y < 844,
  );
  await firstCopy.tap().catch(() => firstCopy.click());
  check(
    "mobile: copy works by touch",
    (await p.evaluate(() => navigator.clipboard.readText())) ===
      `${APP}/overlay/${overlaysA[0]!.public_token}`,
  );
  await shot(p, "mobile--overlays--390", false);
  await p.setViewportSize({ width: 1440, height: 900 });

  /* 8. Header and pages at text 200 % (browser setting) and zoom 200 % */
  const fctx = await textScaledContext(A);
  const fp = await fctx.newPage();
  for (const path of ["/dashboard", "/dashboard?ui=classic", `/dashboard/sessions/${liveId}`]) {
    for (const [w, h] of [
      [360, 800],
      [390, 844],
      [430, 932],
      [768, 1024],
      [1280, 720],
      [1440, 900],
      [1920, 1080],
    ] as const) {
      await fp.setViewportSize({ width: w, height: h });
      await fp.goto(`${APP}${path}`);
      await fp.locator("body > div > header").waitFor();
      await fp.waitForTimeout(200);
      const ox = await overflowX(fp);
      const signOut = await fp.getByRole("button", { name: "Cerrar sesión" }).boundingBox();
      const locale = await fp.getByRole("radiogroup").boundingBox();
      const clipped = await clippedHeaderLabels(fp);
      check(
        `text 200 % ${path} ${w}px: no horizontal overflow; sign-out + language reachable; no clipped labels`,
        ox <= 0 &&
          !!signOut &&
          signOut.x + signOut.width <= w + 1 &&
          !!locale &&
          clipped.length === 0,
        `overflow ${ox}; clipped=${clipped.join(",")}`,
      );
      if ((w === 390 || w === 1440) && path !== `/dashboard/sessions/${liveId}`)
        await fp.screenshot({
          path: `${OUT}/text200--${path.includes("classic") ? "classic" : "fight"}--${w}.png`,
          animations: "disabled",
        });
    }
  }
  await fctx.close();
  metrics.cssStressHeader = await headerScaling(p, "css-stress", "/dashboard");

  /* 9. Keyboard: logical order, no trap, visible focus */
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  const order: string[] = [];
  let invisible = 0;
  for (let i = 0; i < 60; i++) {
    await p.keyboard.press("Tab");
    const info = await p.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      const visible = cs.outlineStyle !== "none" || cs.boxShadow !== "none";
      return {
        t: (a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 28),
        visible,
      };
    });
    if (!info) continue;
    order.push(info.t);
    if (!info.visible) invisible++;
  }
  const iStart = order.findIndex((t) => /Iniciar sesión de juego/.test(t));
  const iCopy = order.findIndex((t) => /Copiar URL para OBS de/.test(t));
  check(
    "keyboard: header → status → START → console overlays (copy/configure/details) → modules; no trap",
    iStart >= 0 && iCopy > iStart && new Set(order).size > 15,
    `${order.length} stops; start@${iStart}; first copy@${iCopy}`,
  );
  check(
    "keyboard: every focus stop has a visible indicator",
    invisible === 0,
    `${invisible} without`,
  );

  /* 10. Reduced motion */
  const rm = await ctxFor(browser, A, { reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`${APP}/dashboard`);
  await rp.locator('[data-k="start"]').click();
  await rp.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await rp.waitForTimeout(6_000);
  await sync(A, {
    matches: [match("win")],
    profile: profile(A.cfn, 1410),
    battlelogObserved: true,
  });
  await rp.waitForFunction(() => (document.body.textContent ?? "").includes("en 1 partida"), null, {
    timeout: 30_000,
  });
  await rp.waitForTimeout(100);
  check(
    "reduced motion: start + new match feedback without running animations",
    (await rp.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 5).length,
    )) === 0,
  );
  await rp.locator('[data-k="end"]').click();
  await rp.locator('[data-k="confirm-end"]').click();
  await rp.waitForURL(/ended=1/, { timeout: 30_000 });
  await rm.close();

  /* 11. Long sessions: 0 · 30 · 100 · 500 matches through the real sync endpoint */
  const sizes = [0, 30, 100, 500];
  const recapIds: Record<number, string> = {};
  for (const n of sizes) {
    await sync(A, { profile: profile(A.cfn, 1402), battlelogObserved: true });
    await p.waitForTimeout(6_000); // past the provider's 5 s profile cache (pre-existing issue)
    await p.goto(`${APP}/dashboard`);
    await start.click();
    await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
    await p.waitForTimeout(1_500);
    const base = Date.now() - 1_000;
    const all = Array.from({ length: n }, (_, i) =>
      match(i % 3 === 0 ? "loss" : "win", new Date(base - (n - i) * 0 + i * 2)),
    );
    for (let i = 0; i < all.length; i += 100) {
      await sync(A, { matches: all.slice(i, i + 100), battlelogObserved: true });
    }
    await sync(A, { profile: profile(A.cfn, 1414), battlelogObserved: true });
    await p.waitForTimeout(6_000);
    await p.locator('[data-k="end"]').click();
    await p.locator('[data-k="confirm-end"]').click();
    await p.waitForURL(/ended=1/, { timeout: 60_000 });
    recapIds[n] = (await latestSession(A.id))!.id;
    const stored = (
      await sql<
        { c: number }[]
      >`select count(*)::int c from match where session_id = ${recapIds[n]!}`
    )[0]!.c;
    check(`${n}-match session: all ${n} matches stored in the session`, stored === n, `${stored}`);
  }
  const perf: Record<string, unknown> = {};
  for (const n of sizes) {
    const path = `/dashboard/sessions/${recapIds[n]}`;
    await p.goto(`${APP}${path}`);
    await p.locator("[data-recap-ui]").waitFor();
    const dom = await p.evaluate(() => document.querySelectorAll("*").length);
    const strip = await p.locator("ol li[aria-label^='Partida ']").count();
    const visibleRows = await p
      .locator("section[aria-labelledby='fs-recap-matches'] > ol > li")
      .count();
    perf[`recap${n}`] = {
      ssrMedianMs: await ssrMs(A, path),
      domNodes: dom,
      stripMarkers: strip,
      visibleRows,
    };
    check(
      `RECAP ${n}: bounded strip (≤ 30) and list (≤ 20 visible), no overflow at 390`,
      strip <= 30 && visibleRows <= 20 && (n === 0 || strip === Math.min(30, n)),
      JSON.stringify(perf[`recap${n}`]),
    );
    if (n >= 30) {
      await p.setViewportSize({ width: 390, height: 844 });
      check(`RECAP ${n} 390: no overflow`, (await overflowX(p)) <= 0);
      await shot(p, `recap--${n}--390`, false);
      await p.setViewportSize({ width: 1440, height: 900 });
      await shot(p, `recap--${n}--1440`);
    }
  }
  perf.dashboardFight = { ssrMedianMs: await ssrMs(A, "/dashboard") };
  perf.dashboardClassic = { ssrMedianMs: await ssrMs(A, "/dashboard?ui=classic") };
  // Client activity on an idle PREPARE: DOM mutations in 30 s (clock ticks, SSE snapshots).
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  perf.idleMutations30s = await p.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0;
        const mo = new MutationObserver((l) => (n += l.length));
        mo.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        setTimeout(() => {
          mo.disconnect();
          resolve(n);
        }, 30_000);
      }),
  );
  perf.timers = await p.evaluate(() =>
    performance.getEntriesByType("navigation").map((e) => {
      const n = e as PerformanceNavigationTiming;
      return {
        ttfb: Math.round(n.responseStart),
        domInteractive: Math.round(n.domInteractive),
        load: Math.round(n.loadEventEnd),
      };
    }),
  );
  metrics.perf = perf;

  /* 12. Overlays untouched */
  check(
    "overlays: OBS tokens unchanged",
    JSON.stringify(tokensBefore) === JSON.stringify(await tokensOf(A.id)),
  );
  check("no page errors / hydration warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
  writeFileSync(`${OUT}/metrics.json`, JSON.stringify(metrics, null, 2));
  writeFileSync(`${STATE}.ids.json`, JSON.stringify({ liveId }));
  await browser.close();
}

async function rollback() {
  const { A } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const { liveId } = JSON.parse(readFileSync(`${STATE}.ids.json`, "utf8")) as { liveId: string };
  const browser = await chromium.launch();
  const ctx = await ctxFor(browser, A);
  const p = await ctx.newPage();
  await p.goto(`${APP}/dashboard`);
  await p.locator("body > div > header").waitFor();
  check(
    "rollback: allowlist cleared ⇒ classic dashboard with the detailed console",
    (await p.locator('[data-dashboard-ui="fight-session"]').count()) === 0 &&
      (await p.locator("[data-overlay-item]").count()) === 0 &&
      (await p.locator("aside input[readonly]").count()) === 3,
  );
  await shot(p, "rollback--classic--1440");
  await p.goto(`${APP}/dashboard/sessions/${liveId}`);
  check(
    "rollback: classic recap",
    (await p.locator('[data-recap-ui="fight-session"]').count()) === 0 &&
      (await p.getByText("Sesión completada").count()) === 1,
  );
  await browser.close();
}

async function cleanup() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id in (${A.id}, ${B.id}) and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "baseline" || PHASE === "peek") await baseline();
else if (PHASE === "run") await run();
else if (PHASE === "rollback") await rollback();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | baseline | run | rollback | cleanup");

if (results.length) {
  const file = `design/phase-5-6d/screenshots/e2e-${PHASE}.json`;
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
}
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
