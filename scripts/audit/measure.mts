/**
 * Performance audit measurements (LOCAL ONLY; refuses any non-loopback database or app).
 *
 *   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts setup
 *   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts requests   # standalone
 *   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts idle       # embedded
 *   AUDIT_STATE=/tmp/audit.json pnpm exec tsx scripts/audit/measure.mts cleanup
 *
 * The app must run from a production build with DATABASE_URL pointed at
 * scripts/audit/pg-wire-probe.mjs (control on :5442), see docs/audit/2026-10-22-performance-security-review.md.
 * Fictitious `@test.local` accounts; Companion data through the real sync endpoint.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PROBE = "http://127.0.0.1:5442";
const PHASE = process.argv[2] ?? "";
const STATE = process.env.AUDIT_STATE ?? "";
const OUT = process.env.AUDIT_OUT ?? "docs/audit/2026-10-22-evidence";
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
if (!STATE) throw new Error("AUDIT_STATE (a path outside the repo) is required");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

interface Account {
  key: string;
  id: string;
  cfn: string;
  deviceToken: string;
  storage: string;
  cookie: string;
}
interface Saved {
  accounts: Account[];
  sessions: Record<string, string>; // size → session id (account 0)
  overlay: { id: string; token: string };
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
    displayName: "SIM",
    favoriteCharacterKey: "ryu",
  });
}
let seq = 0;
const match = (result: "win" | "loss", playedAt = new Date()) =>
  core.toWireMatch({
    externalMatchId: `AUD-${Date.now()}-${++seq}`,
    playedAt,
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
  const t0 = performance.now();
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
  await res.text();
  lastSync.set(acc.cfn, Date.now());
  if (res.status !== 200) throw new Error(`sync ${res.status}`);
  return performance.now() - t0;
}
const probe = async (path: "reset" | "stats") =>
  (await (await fetch(`${PROBE}/${path}`)).json()) as {
    roundTrips: number;
    simple: number;
    statements: Record<string, number>;
  };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

/** Round trips + distinct statements for one operation (after the app settles). */
async function count(op: () => Promise<unknown>, settleMs = 400) {
  await new Promise((r) => setTimeout(r, settleMs));
  await probe("reset");
  await op();
  await new Promise((r) => setTimeout(r, settleMs));
  const s = await probe("stats");
  return {
    roundTrips: s.roundTrips,
    statements: Object.values(s.statements).reduce((a, b) => a + b, 0),
    distinct: Object.keys(s.statements).length,
    top: Object.entries(s.statements)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([q, n]) => `${n}× ${q.slice(0, 140)}`),
  };
}

/* ───────── setup ───────── */

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../src/server/db/client");
  const accounts: Account[] = [];
  for (const [i, cfn] of ["9990000700", "9990000701", "9990000702"].entries()) {
    const ctx = await browser.newContext({ locale: "es-ES" });
    const page = await ctx.newPage();
    const email = `aud-${i}-${randomUUID().slice(0, 6)}@test.local`;
    await page.goto(`${APP}/signup`);
    await page.fill("#name", `Audit ${i}`);
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
      body: JSON.stringify({ code, deviceName: `Audit ${i}` }),
    });
    const deviceToken = ((await pair.json()) as { deviceToken: string }).deviceToken; // never printed
    const storage = `${STATE}.${i}.storage.json`;
    const acc: Account = { key: String(i), id, cfn, deviceToken, storage, cookie: "" };
    await sync(acc, { profile: profile(cfn, 1402) });
    await page.fill("#cfn", cfn);
    await page.getByRole("button", { name: "Buscar jugador" }).click();
    await page.getByText("Jugador encontrado").waitFor();
    await page.getByRole("button", { name: /Soy yo/ }).click();
    await page.waitForURL(/dashboard/);
    await ctx.storageState({ path: storage });
    const { cookies } = JSON.parse(readFileSync(storage, "utf8")) as {
      cookies: Array<{ name: string; value: string }>;
    };
    acc.cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    accounts.push(acc);
    await ctx.close();
  }
  // Account 0: sessions of 0 / 30 / 100 / 500 matches through the real UI + sync endpoint.
  const a = accounts[0]!;
  const ctx = await browser.newContext({ storageState: a.storage, locale: "es-ES" });
  const page = await ctx.newPage();
  const sessions: Record<string, string> = {};
  for (const n of [0, 30, 100, 500]) {
    await sync(a, { profile: profile(a.cfn, 1402) });
    await new Promise((r) => setTimeout(r, 6_000)); // past the provider profile cache
    await page.goto(`${APP}/dashboard`);
    await page.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
    await page.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 1_500));
    const all = Array.from({ length: n }, (_, i) =>
      match(i % 3 ? "win" : "loss", new Date(Date.now() - 1_000 + i)),
    );
    for (let i = 0; i < all.length; i += 100) await sync(a, { matches: all.slice(i, i + 100) });
    await sync(a, { profile: profile(a.cfn, 1414) });
    await new Promise((r) => setTimeout(r, 6_000));
    await page.getByRole("button", { name: "Finalizar sesión" }).click();
    await page.getByRole("button", { name: "Sí, finalizar sesión" }).click();
    await page.waitForURL(/ended=1/, { timeout: 60_000 });
    sessions[n] = (
      await sql<
        { id: string }[]
      >`select gs.id from game_session gs join sf6_player p on p.id = gs.player_id
        where p.user_id = ${a.id} order by gs.started_at desc limit 1`
    )[0]!.id;
  }
  await ctx.close();
  const o = (
    await sql<{ id: string; public_token: string }[]>`select o.id, o.public_token from overlay o
      join sf6_player p on p.id = o.player_id where p.user_id = ${a.id} limit 1`
  )[0]!;
  writeFileSync(
    STATE,
    JSON.stringify({
      accounts,
      sessions,
      overlay: { id: o.id, token: o.public_token },
    } satisfies Saved),
  );
  console.log(`setup done; A = ${accounts[0]!.id}`);
  await browser.close();
  await closeDb();
}

/* ───────── requests (standalone mode: no in-process worker noise) ───────── */

async function ssr(path: string, cookie?: string) {
  const times: number[] = [];
  let status = 0;
  let cacheControl: string | null = null;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const res = await fetch(`${APP}${path}`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });
    await res.text();
    times.push(performance.now() - t0);
    status = res.status;
    cacheControl = res.headers.get("cache-control");
  }
  return { status, medianMs: Math.round(median(times)), cacheControl };
}

async function requests() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const [A, B, C] = s.accounts as [Account, Account, Account];
  const out: Record<string, unknown> = {};
  const pages: Array<[string, string, string | undefined]> = [
    ["landing (anonymous)", "/", undefined],
    ["landing (signed in)", "/", A.cookie],
    ["login (anonymous)", "/login", undefined],
    ["help/companion (signed in)", "/help/companion", A.cookie],
    ["onboarding (signed in, has player)", "/onboarding", A.cookie],
    ["dashboard Fight Session", "/dashboard", A.cookie],
    ["dashboard classic", "/dashboard", B.cookie],
    ["analytics (500+ matches)", "/dashboard/analytics", A.cookie],
    ["analytics all-time", "/dashboard/analytics?range=all&mode=all", A.cookie],
    ["recap 0 matches", `/dashboard/sessions/${s.sessions[0]}`, A.cookie],
    ["recap 30 matches", `/dashboard/sessions/${s.sessions[30]}`, A.cookie],
    ["recap 100 matches", `/dashboard/sessions/${s.sessions[100]}`, A.cookie],
    ["recap 500 matches", `/dashboard/sessions/${s.sessions[500]}`, A.cookie],
    [
      "recap 500 classic (?ui=classic)",
      `/dashboard/sessions/${s.sessions[500]}?ui=classic`,
      A.cookie,
    ],
    ["overlay builder", `/dashboard/overlays/${s.overlay.id}`, A.cookie],
    ["overlay page (public)", `/overlay/${s.overlay.token}`, undefined],
    ["overlay state API (public)", `/api/overlay/${s.overlay.token}/state`, undefined],
    ["review PDF", "/dashboard/analytics/review.pdf?range=all&mode=all", A.cookie],
  ];
  for (const [name, path, cookie] of pages) {
    const timing = await ssr(path, cookie);
    const db = await count(async () => {
      const r = await fetch(`${APP}${path}`, {
        headers: cookie ? { cookie } : {},
        redirect: "manual",
      });
      await r.arrayBuffer();
    });
    out[`page: ${name}`] = { ...timing, db };
    console.log(name, timing.medianMs, "ms", db.roundTrips, "round trips");
  }

  // Companion endpoints.
  out["companion state (every ~30 s per open browser)"] = await count(async () => {
    const r = await fetch(`${APP}/api/companion/state`, {
      headers: { authorization: `Bearer ${C.deviceToken}` },
    });
    await r.text();
  });
  out["companion sync: profile only, no session, no listeners"] = await count(() =>
    sync(C, { profile: profile(C.cfn, 1402) }),
  );
  out["heartbeat (no active session)"] = await count(async () => {
    const r = await fetch(`${APP}/api/session/heartbeat`, {
      method: "POST",
      headers: { cookie: C.cookie, origin: APP },
    });
    await r.text();
  });

  // Active session on B with SSE listeners: the fan-out cost of one sync.
  const browser = await chromium.launch();
  const bctx = await browser.newContext({ storageState: B.storage, locale: "es-ES" });
  const bp = await bctx.newPage();
  await sync(B, { profile: profile(B.cfn, 1402) });
  await new Promise((r) => setTimeout(r, 6_000));
  await bp.goto(`${APP}/dashboard`);
  out["action: start session (classic UI click → active)"] = await count(async () => {
    await bp.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
    await bp.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 30_000 });
  }, 1_000);
  const btoken = (
    await sql<{ public_token: string }[]>`select o.public_token from overlay o join sf6_player p
      on p.id = o.player_id where p.user_id = ${B.id} limit 1`
  )[0]!.public_token;
  const overlayPages = [];
  for (let i = 0; i < 2; i++) {
    const op = await bctx.newPage();
    await op.goto(`${APP}/overlay/${btoken}`);
    overlayPages.push(op);
  }
  await new Promise((r) => setTimeout(r, 2_000));
  const syncTimes: number[] = [];
  out["companion sync: 1 match + profile, active session, 1 dashboard + 2 overlay streams"] =
    await count(async () => {
      syncTimes.push(await sync(B, { matches: [match("win")], profile: profile(B.cfn, 1408) }));
    }, 1_500);
  out["companion sync: duplicate replay (same match again)"] = await count(async () => {
    const m = match("loss");
    await sync(B, { matches: [m] });
    await probe("reset");
    await sync(B, { matches: [m] });
  }, 1_500);
  out["companion sync: 100 new matches in one batch"] = await count(async () => {
    const batch = Array.from({ length: 100 }, (_, i) =>
      match(i % 2 ? "win" : "loss", new Date(Date.now() - 500 + i)),
    );
    syncTimes.push(await sync(B, { matches: batch }));
  }, 2_000);
  out["action: end session (confirm → recap)"] = await count(async () => {
    await bp.getByRole("button", { name: "Finalizar sesión" }).click();
    await bp.getByRole("button", { name: "Sí, finalizar sesión" }).click();
    await bp.waitForURL(/ended=1/, { timeout: 60_000 });
  }, 1_500);
  for (const op of overlayPages) await op.close();
  await bctx.close();

  // Concurrency: A, B and C sync every ~6.2 s for ~45 s while 10 overlay streams of A are open.
  // One context per stream: a single browser context is limited to 6 HTTP/1.1 connections per
  // host, and each SSE stream holds one (see the audit report, finding on OBS sources).
  const streamCtx = [];
  for (let i = 0; i < 10; i++) {
    const c = await browser.newContext();
    await (await c.newPage()).goto(`${APP}/overlay/${s.overlay.token}`);
    streamCtx.push(c);
  }
  const lat: number[] = [];
  await probe("reset");
  const t0 = Date.now();
  await Promise.all(
    [A, B, C].map(async (acc) => {
      while (Date.now() - t0 < 45_000)
        lat.push(await sync(acc, { profile: profile(acc.cfn, 1400 + (seq++ % 30)) }));
    }),
  );
  const st = await probe("stats");
  out["concurrency: 3 accounts syncing for 45 s, 10 overlay streams open"] = {
    syncs: lat.length,
    syncMedianMs: Math.round(median(lat)),
    syncP95Ms: Math.round(p95(lat)),
    dbRoundTrips: st.roundTrips,
    dbRoundTripsPerSync: Math.round(st.roundTrips / lat.length),
  };
  out["sync latency (active session, listeners)"] = syncTimes.map(Math.round);
  for (const c of streamCtx) await c.close();
  await browser.close();
  writeFileSync(`${OUT}/requests.json`, JSON.stringify(out, null, 2));
}

/* ───────── idle (embedded mode: the in-process tracker runs) ───────── */

async function idle() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const out: Record<string, unknown> = {};
  await new Promise((r) => setTimeout(r, 5_000));
  for (const [label, ms] of [["no active session, no clients", 60_000]] as const) {
    await probe("reset");
    await new Promise((r) => setTimeout(r, ms));
    const st = await probe("stats");
    out[label] = {
      seconds: ms / 1000,
      roundTrips: st.roundTrips,
      perMinute: Math.round((st.roundTrips / ms) * 60_000),
      top: Object.entries(st.statements)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([q, n]) => `${n}× ${q.slice(0, 120)}`),
    };
  }
  // One open dashboard (SSE) and one overlay, nothing happening.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ storageState: s.accounts[0]!.storage });
  const dp = await ctx.newPage();
  await dp.goto(`${APP}/dashboard`);
  const op = await ctx.newPage();
  await op.goto(`${APP}/overlay/${s.overlay.token}`);
  await new Promise((r) => setTimeout(r, 3_000));
  await probe("reset");
  await new Promise((r) => setTimeout(r, 60_000));
  const st = await probe("stats");
  out["1 dashboard + 1 overlay open, no session"] = {
    roundTrips: st.roundTrips,
    perMinute: st.roundTrips,
    top: Object.entries(st.statements)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([q, n]) => `${n}× ${q.slice(0, 120)}`),
  };
  await browser.close();
  writeFileSync(`${OUT}/idle.json`, JSON.stringify(out, null, 2));
}

/* ───────── frontend (standalone mode) ───────── */

async function frontend() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const [A, B] = s.accounts as [Account, Account];
  const browser = await chromium.launch();
  const out: Record<string, unknown> = {};
  const pages: Array<[string, string, Account | null, string | null]> = [
    ["dashboard Fight Session", "/dashboard", A, "[data-overlay-item] summary"],
    ["dashboard classic", "/dashboard", B, null],
    ["analytics", "/dashboard/analytics", A, '[data-testid="methodology"] summary'],
    ["recap 500 matches", `/dashboard/sessions/${s.sessions[500]}`, A, "details summary"],
    ["overlay builder", `/dashboard/overlays/${s.overlay.id}`, A, '[role="tab"]:nth-child(2)'],
    ["overlay page (OBS)", `/overlay/${s.overlay.token}`, null, null],
    ["login", "/login", null, null],
  ];
  for (const [name, path, acc, interact] of pages) {
    const ctx = await browser.newContext({
      ...(acc ? { storageState: acc.storage } : {}),
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript({
      content: `window.__name = (f) => f; window.__lt = 0; window.__ev = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += e.duration; }).observe({ type: "longtask", buffered: true });
              new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push(e.duration); }).observe({ type: "event", durationThreshold: 16, buffered: true }); } catch {}`,
    });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Performance.enable");
    await p.goto(`${APP}${path}`);
    await p.waitForLoadState("load");
    await p.waitForTimeout(1_500);
    if (interact) {
      const el = p.locator(interact).first();
      if ((await el.count()) > 0) {
        await el.click();
        await p.waitForTimeout(400);
      }
    }
    const m = await p.evaluate(() => {
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const js = res.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
      const css = res.filter((r) => r.name.endsWith(".css"));
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      const w = window as unknown as { __lt: number; __ev: number[] };
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        jsFiles: js.length,
        jsKB: Math.round(js.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024),
        jsDecodedKB: Math.round(js.reduce((a, r) => a + (r.decodedBodySize || 0), 0) / 1024),
        cssKB: Math.round(css.reduce((a, r) => a + (r.encodedBodySize || 0), 0) / 1024),
        htmlKB: Math.round((nav.encodedBodySize || 0) / 1024),
        domNodes: document.querySelectorAll("*").length,
        longTaskMs: Math.round(w.__lt),
        maxInteractionMs: w.__ev.length ? Math.round(Math.max(...w.__ev)) : null,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      };
    });
    const task = async () =>
      (
        (await cdp.send("Performance.getMetrics")) as {
          metrics: Array<{ name: string; value: number }>;
        }
      ).metrics.find((x) => x.name === "TaskDuration")!.value;
    const t0 = await task();
    await p.waitForTimeout(30_000);
    const t1 = await task();
    const heap2 = await p.evaluate(() => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return mem ? Math.round(mem.usedJSHeapSize / 1048576) : null;
    });
    out[name] = { ...m, idleCpuMsPer30s: Math.round((t1 - t0) * 1000), heapMBAfter30s: heap2 };
    console.log(name, JSON.stringify(out[name]));
    await ctx.close();
  }
  await browser.close();
  writeFileSync(`${OUT}/frontend.json`, JSON.stringify(out, null, 2));
}

/* ───────── interactions (Event Timing; standalone mode) ───────── */

async function interactions() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const [A] = s.accounts as [Account];
  const browser = await chromium.launch();
  const out: Record<string, unknown> = {};
  const cases: Array<[string, string, string]> = [
    ["dashboard: overlay «Detalles» toggle", "/dashboard", "[data-overlay-item] summary"],
    ["dashboard: OBS guide disclosure", "/dashboard", '[data-testid="obs-guide"] summary'],
    [
      "recap 500: «Ver N partidas anteriores»",
      `/dashboard/sessions/${s.sessions[500]}`,
      "section details summary",
    ],
    ["builder: editor tab", `/dashboard/overlays/${s.overlay.id}`, '[role="tab"]'],
    [
      "analytics: methodology disclosure",
      "/dashboard/analytics",
      '[data-testid="methodology"] summary',
    ],
  ];
  for (const [name, path, sel] of cases) {
    const ctx = await browser.newContext({
      storageState: A.storage,
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript({
      content: `window.__name = (f) => f; window.__ev = [];
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ n: e.name, d: e.duration, p: e.processingEnd - e.processingStart, delay: e.processingStart - e.startTime }); }).observe({ type: "event", durationThreshold: 16, buffered: true });`,
    });
    const p = await ctx.newPage();
    await p.goto(`${APP}${path}`);
    await p.waitForLoadState("load");
    await p.waitForTimeout(5_000);
    const els = p.locator(sel);
    const n = await els.count();
    for (let i = 0; i < 6; i++) {
      await els.nth(n > 1 ? i % Math.min(n, 4) : 0).click();
      await p.waitForTimeout(500);
    }
    const ev = await p.evaluate(
      () =>
        (window as unknown as { __ev: Array<{ n: string; d: number; p: number; delay: number }> })
          .__ev,
    );
    const clicks = ev.filter(
      (e) => e.n === "click" || e.n === "pointerup" || e.n === "pointerdown",
    );
    const ds = clicks.map((e) => e.d).sort((a, b) => a - b);
    out[name] = {
      interactions: clicks.length,
      maxMs: ds.length ? Math.round(ds[ds.length - 1]!) : 0,
      medianMs: ds.length ? Math.round(ds[Math.floor(ds.length / 2)]!) : 0,
      worst: clicks
        .sort((a, b) => b.d - a.d)
        .slice(0, 2)
        .map((e) => ({
          event: e.n,
          durationMs: Math.round(e.d),
          processingMs: Math.round(e.p),
          inputDelayMs: Math.round(e.delay),
        })),
    };
    console.log(name, JSON.stringify(out[name]));
    await ctx.close();
  }
  await browser.close();
  writeFileSync(`${OUT}/interactions.json`, JSON.stringify(out, null, 2));
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const ids = s.accounts.map((a) => a.id);
  const deleted =
    await sql`delete from auth_user where id in ${sql(ids)} and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "requests") await requests();
else if (PHASE === "idle") await idle();
else if (PHASE === "frontend") await frontend();
else if (PHASE === "interactions") await interactions();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | requests | idle | cleanup");
await sql.end();
