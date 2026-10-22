/**
 * Phase 5.6C — browser E2E of the gated Fight Session RECAP (PREPARE → LIVE → RECAP) against a LOCAL production build
 * and a LOCAL database (refuses anything else). Fictitious `@test.local` accounts; Companion data
 * goes through the real sync endpoint; session start/end through the real UI and server actions.
 *
 *   E2E_STATE=/some/tmp/file.json pnpm exec tsx design/phase-5-6c/e2e/recap.e2e.mts <phase>
 *
 * Phases (the server env differs between them, see design/phase-5-6c/README.md):
 *   setup     server WITHOUT FIGHT_SESSION_UI_USERS: create accounts A (tester) and B, pair, sync.
 *   run       server WITH FIGHT_SESSION_UI_USERS=<A id>: gate, prepare, start, live, end, overlays…
 *   rollback  server WITHOUT the variable again: A is back on the classic dashboard.
 *   cleanup   delete both accounts.
 * The state file (ids, local device tokens, browser storage) never goes into the repository.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const OUT = "design/phase-5-6c/screenshots/full";
const STATE = process.env.E2E_STATE ?? "";
const PHASE = process.argv[2] ?? "";
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

function profile(cfn: string, ryuMr: number, jamieLp = 23006) {
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
  for (const c of raw.pageProps.play.character_league_infos) {
    if (c.character_tool_name === "ryu") c.league_info.master_rating = ryuMr;
    if (c.character_tool_name === "jamie") c.league_info.league_point = jamieLp;
  }
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
const CHAR = { ryu: "Ryu", jamie: "Jamie" } as const;
const match = (result: "win" | "loss", character: keyof typeof CHAR = "ryu") =>
  core.toWireMatch({
    externalMatchId: `E2E-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() - 1_000),
    mode: "ranked",
    result,
    characterKey: character,
    characterName: CHAR[character],
    opponent: { name: `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
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

/* ───────── checks ───────── */

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function shot(p: Page, name: string, full = true) {
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
  });
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
}
async function overflowX(p: Page) {
  return p.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
async function streamRequests(p: Page, path: string) {
  const urls: string[] = [];
  const onReq = (r: { url(): string }) => {
    if (r.url().includes("/api/me/stream")) urls.push(r.url());
  };
  p.on("request", onReq);
  await p.goto(`${APP}${path}`);
  await p.waitForTimeout(3_000);
  p.off("request", onReq);
  return urls.length;
}
async function ctxFor(
  browser: Browser,
  acc: Account,
  opts: Parameters<Browser["newContext"]>[0] = {},
) {
  return browser.newContext({
    storageState: acc.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    ...opts,
  });
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
    await sync(acc, { profile: profile(cfn, 1571), battlelogObserved: true });
    await page.fill("#cfn", cfn);
    await page.getByRole("button", { name: "Buscar jugador" }).click();
    await page.getByText("Jugador encontrado").waitFor();
    await page.getByRole("button", { name: /Soy yo/ }).click();
    await page.waitForURL(/dashboard/);
    await ctx.storageState({ path: acc.storage });
    await ctx.close();
    return acc;
  };
  const A = await make("A", "9990000300");
  const B = await make("B", "9990000301");
  // Overlays as the builder would save them (session + rank progress) for A.
  const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } =
    await import("../../../src/domain/overlay/rank-progress");
  const playerId = (
    await sql<{ id: string }[]>`select id from sf6_player where user_id = ${A.id}`
  )[0]?.id;
  if (!playerId) throw new Error("player not created");
  const token = Buffer.from(randomUUID() + randomUUID())
    .toString("base64url")
    .slice(0, 32);
  await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${"Progreso de rango"}, ${token}, ${sql.json({ ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "es" } as postgres.JSONValue)})`;
  writeFileSync(STATE, JSON.stringify({ A, B } satisfies Saved, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

/** Glyph boxes (DOM Range) of the results bar must stay in their cells and never intersect. */
async function resultsCollisions(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const out: string[] = [];
    const dl = document.querySelector("[data-testid='fs-session-results']");
    if (!dl) return out;
    const box = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    };
    const cells = Array.from(dl.children).map((c) => ({
      c: c.getBoundingClientRect(),
      b: Array.from(c.querySelectorAll("dt, dd")).map(box),
    }));
    cells.forEach((x, i) => {
      if (x.b.some((b) => b.left < x.c.left - 0.5 || b.right > x.c.right + 0.5))
        out.push(`cell ${i + 1} escapes`);
      cells.slice(i + 1).forEach((y, j) => {
        for (const a of x.b)
          for (const b of y.b)
            if (
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5
            )
              out.push(`cells ${i + 1} and ${i + j + 2} overlap`);
      });
    });
    return out;
  });
}
const latestSession = async (userId: string) =>
  (
    await sql<
      { id: string; status: string }[]
    >`select gs.id, gs.status from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${userId} order by gs.started_at desc limit 1`
  )[0];

async function run() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  await sql`update game_session set status = 'ended', ended_at = now()
    where status = 'active' and player_id in (select id from sf6_player where user_id in (${A.id}, ${B.id}))`;
  const tokensBefore = (
    await sql<
      { t: string }[]
    >`select o.public_token t from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${A.id} order by 1`
  ).map((r) => r.t);

  const ctx = await ctxFor(browser, A);
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource"))
      errors.push(m.text());
  });
  const start = p.locator('[data-k="start"]');
  const endFlow = async () => {
    await p.locator('[data-k="end"]').click();
    await p.locator('[data-k="confirm-end"]').click();
    await p.waitForURL(/\/dashboard\/sessions\/.+ended=1/, { timeout: 30_000 });
    await p.locator("[data-recap-ui], h1").first().waitFor();
  };

  /* 1. Zero-match session: PREPARE → START → END → RECAP */
  await sync(A, { profile: profile(A.cfn, 1571), battlelogObserved: true });
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  await start.click();
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await endFlow();
  const zeroId = (await latestSession(A.id))!.id;
  check(
    "zero matches: Fight Session recap, ended",
    (await p.locator('[data-recap-ui="fight-session"]').count()) === 1 &&
      (await p.getByText("Sesión terminada").count()) === 1,
  );
  check(
    "zero matches: «—» win rate and the honest empty list",
    (await p.getByText("No se ha registrado ninguna partida").count()) === 1 &&
      (await p.locator("[data-testid='fs-session-results']").innerText()).includes("—"),
  );
  await shot(p, "recap--zero--desktop");

  /* 2. Mixed, multi-character session through LIVE */
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  await sync(A, { profile: profile(A.cfn, 1571, 23006), battlelogObserved: true });
  await p.reload();
  await start.waitFor();
  await start.click();
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  await p.waitForTimeout(3_000);
  await sync(A, {
    matches: [match("win")],
    profile: profile(A.cfn, 1583, 23006),
    battlelogObserved: true,
  });
  await sync(A, {
    matches: [match("loss", "jamie")],
    profile: profile(A.cfn, 1583, 22986),
    battlelogObserved: true,
  });
  await sync(A, {
    matches: [match("loss", "jamie")],
    profile: profile(A.cfn, 1583, 22982),
    battlelogObserved: true,
  });
  await p.waitForFunction(() => (document.body.textContent ?? "").includes("en 3 partidas"), null, {
    timeout: 30_000,
  });
  check("LIVE: 3 matches arrived through SSE", true);
  await endFlow();
  const mixedId = (await latestSession(A.id))!.id;
  const results = await p.locator("[data-testid='fs-session-results']").innerText();
  const body = (await p.locator('[data-recap-ui="fight-session"]').textContent()) ?? "";
  check(
    "recap: saved confirmation + «Sesión terminada»",
    body.includes("Sesión finalizada y guardada") && body.includes("Sesión terminada"),
  );
  check(
    "recap: 3 · 1 · 2 · 33,3 %",
    /3[\s\S]*1[\s\S]*2[\s\S]*33,3\s%/.test(results),
    results.replace(/\s+/g, " "),
  );
  check(
    "recap: the latest character's own change (Jamie −24 LP), never a combined total",
    /Cambio en la sesión · Jamie\s*▼\s*-24\s*23\.006 → 22\.982 LP/.test(body),
  );
  check(
    "recap: Ryu keeps its own MR change (+12 MR)",
    /Ryu\s*desde\s*1571\s*1583\s*MR[\s\S]*\+12/.test(body),
  );
  const strip = await p
    .locator("ol[aria-label='Partidas de la sesión'] li[aria-label]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    "recap: strip in session order",
    JSON.stringify(strip) ===
      JSON.stringify(["Partida 1: Victoria", "Partida 2: Derrota", "Partida 3: Derrota"]),
    JSON.stringify(strip),
  );
  check(
    "recap: list newest first with opponents",
    /3\s*\.\s*Jamie vs Ken[\s\S]*1\s*\.\s*Ryu vs Ken/.test(body),
  );
  check(
    "recap: no per-match rating in the list",
    !/\d+\s*\.\s*(Ryu|Jamie) vs Ken[^]*?\d{4}\s*(MR|LP)\s*$/m.test(
      await p
        .locator("#fs-recap-matches ~ ol, section[aria-labelledby='fs-recap-matches'] ol")
        .first()
        .innerText(),
    ),
  );
  check("recap: results bar has no collisions (1440)", (await resultsCollisions(p)).length === 0);
  check(
    "recap: no SSE stream or polling on the recap page",
    (await streamRequests(p, `/dashboard/sessions/${mixedId}`)) === 0,
  );
  await shot(p, "recap--mixed-multichar--desktop");

  /* 3. Viewports, EN, text 200 %, reduced motion */
  for (const [locale, sizes] of [
    [
      "es",
      [
        [1920, 1080],
        [1440, 900],
        [1280, 720],
        [1024, 768],
        [390, 844],
        [360, 800],
      ],
    ],
    [
      "en",
      [
        [1440, 900],
        [390, 844],
      ],
    ],
  ] as const) {
    await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: APP }]);
    await sql`update auth_user set locale = ${locale} where id = ${A.id}`;
    for (const [w, h] of sizes) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(`${APP}/dashboard/sessions/${mixedId}`);
      await p.locator("[data-testid='fs-session-results']").waitFor();
      await p.evaluate(() => document.fonts.ready);
      const col = await resultsCollisions(p);
      check(
        `${locale} ${w}×${h}: no collisions, no horizontal overflow`,
        col.length === 0 && !(await overflowX(p)),
        col.join("; "),
      );
      await shot(p, `recap--${locale}--${w}x${h}`, false);
      if (w === 390) await shot(p, `recap--${locale}--${w}x${h}--full`);
    }
  }
  await sql`update auth_user set locale = 'es' where id = ${A.id}`;
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "es", url: APP }]);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(`${APP}/dashboard/sessions/${mixedId}`);
  await p.locator("[data-testid='fs-session-results']").waitFor();
  await p.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await p.waitForTimeout(300);
  check(
    "text 200 %: results bar still has no collisions",
    (await resultsCollisions(p)).length === 0,
  );
  await shot(p, "recap--text200--desktop", false);

  /* Keyboard: the primary action is reachable and visibly focused */
  await p.goto(`${APP}/dashboard/sessions/${mixedId}`);
  await p.locator("[data-testid='fs-session-results']").waitFor();
  let tabs = 0;
  for (; tabs < 20; tabs++) {
    await p.keyboard.press("Tab");
    if (
      (await p.evaluate(() => document.activeElement?.getAttribute("href"))) ===
      "/dashboard#session"
    )
      break;
  }
  const ring = await p.evaluate(
    () => getComputedStyle(document.activeElement as Element).boxShadow,
  );
  check(
    "keyboard: «Preparar otra sesión» reachable by Tab with a visible inset focus",
    tabs < 20 && ring.includes("inset"),
    `${tabs + 1} Tab`,
  );

  /* 4. Old completed session by URL + navigation back to PREPARE */
  await p.goto(`${APP}/dashboard/sessions/${zeroId}`);
  check(
    "old completed session by URL: its own recap (0 matches)",
    (await p.getByText("No se ha registrado ninguna partida").count()) === 1,
  );
  await p.goto(`${APP}/dashboard/sessions/${mixedId}`);
  await p.getByRole("link", { name: "Preparar otra sesión" }).click();
  await p.waitForURL(/\/dashboard(#session)?$/);
  await start.waitFor();
  check(
    "«Preparar otra sesión» → dashboard PREPARE with the last session",
    (await p.getByText("Tu última sesión").count()) === 1,
  );

  /* 5. Classic recap still available for the tester */
  await p.goto(`${APP}/dashboard/sessions/${mixedId}?ui=classic`);
  check(
    "?ui=classic: classic recap",
    (await p.locator('[data-recap-ui="fight-session"]').count()) === 0 &&
      (await p.getByText("Sesión completada").count()) === 1,
  );
  await shot(p, "recap--classic--tester--desktop");

  /* 6. B: not allowlisted, not the owner */
  const bctx = await ctxFor(browser, B, { extraHTTPHeaders: { "x-ui": "fight-session" } });
  await bctx.addCookies([{ name: "ui", value: "fight-session", url: APP }]);
  const bp = await bctx.newPage();
  const res = await bp.goto(`${APP}/dashboard/sessions/${mixedId}?ui=fight-session`);
  // The not-found page streams in after the loading state: wait for it before reading.
  const notFound = bp.getByText(/no encontrad|not found|no existe/i).first();
  const shown = await notFound.waitFor({ timeout: 20_000 }).then(
    () => true,
    () => false,
  );
  // Visible text only: <script> payloads carry the whole i18n catalogue (which itself contains
  // words like "Jamie" or "Sesión terminada"), not the session.
  const bBody = ((await bp.locator("body").innerText()) ?? "").toLowerCase();
  const leaked = ["jamie", "22.982", "23.006", "sesión terminada", "rival 1"].filter((x) =>
    bBody.includes(x),
  );
  check(
    "non-owner: another player's session is not found and leaks nothing",
    shown &&
      leaked.length === 0 &&
      (await bp.locator("[data-testid='fs-session-results']").count()) === 0,
    `HTTP ${res?.status()} (streamed not-found page); not-found shown=${shown}; leaked=${leaked.join(",")}`,
  );
  // B's own session through the classic dashboard (zero matches)
  await sync(B, { profile: profile(B.cfn, 1571), battlelogObserved: true });
  await bp.goto(`${APP}/dashboard`);
  await bp.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
  await bp.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 30_000 });
  await bp.getByRole("button", { name: "Finalizar sesión" }).click();
  await bp.getByRole("button", { name: "Sí, finalizar sesión" }).click();
  await bp.waitForURL(/ended=1/, { timeout: 30_000 });
  const bId = (await latestSession(B.id))!.id;
  await bp.goto(`${APP}/dashboard/sessions/${bId}?ui=fight-session`);
  check(
    "gate: ineligible owner gets the classic recap even forcing ?ui=, cookie and header",
    (await bp.locator('[data-recap-ui="fight-session"]').count()) === 0 &&
      (await bp.getByText("Sesión completada").count()) === 1,
  );
  await bctx.close();

  /* 7. Overlays untouched */
  const tokensAfter = (
    await sql<
      { t: string }[]
    >`select o.public_token t from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${A.id} order by 1`
  ).map((r) => r.t);
  check(
    "overlays: OBS tokens unchanged",
    JSON.stringify(tokensBefore) === JSON.stringify(tokensAfter),
  );

  /* Reduced motion */
  const rm = await ctxFor(browser, A, { reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`${APP}/dashboard/sessions/${mixedId}`);
  await rp.waitForTimeout(800);
  check(
    "reduced motion: no running animation on the recap",
    (await rp.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 5).length,
    )) === 0,
  );
  await rm.close();
  check("no page errors / hydration warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
  writeFileSync(`${STATE}.ids.json`, JSON.stringify({ mixedId }));
  await browser.close();
}

async function rollback() {
  const { A } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const { mixedId } = JSON.parse(readFileSync(`${STATE}.ids.json`, "utf8")) as { mixedId: string };
  const browser = await chromium.launch();
  const ctx = await ctxFor(browser, A);
  const p = await ctx.newPage();
  await p.goto(`${APP}/dashboard/sessions/${mixedId}`);
  check(
    "rollback: allowlist cleared ⇒ the same URL shows the classic recap",
    (await p.locator('[data-recap-ui="fight-session"]').count()) === 0 &&
      (await p.getByText("Sesión completada").count()) === 1,
  );
  await shot(p, "rollback--classic-recap--desktop");
  await browser.close();
}

async function cleanup() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id in (${A.id}, ${B.id}) and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "run") await run();
else if (PHASE === "rollback") await rollback();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | run | rollback | cleanup");

if (results.length) {
  const file = `design/phase-5-6c/screenshots/e2e-${PHASE}.json`;
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
}
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
