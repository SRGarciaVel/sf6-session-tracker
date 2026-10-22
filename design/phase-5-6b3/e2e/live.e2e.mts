/**
 * Phase 5.6B3 — browser E2E of the gated Fight Session LIVE dashboard against a LOCAL production build
 * and a LOCAL database (refuses anything else). Fictitious `@test.local` accounts; Companion data
 * goes through the real sync endpoint; session start/end through the real UI and server actions.
 *
 *   E2E_STATE=/some/tmp/file.json pnpm exec tsx design/phase-5-6b3/e2e/live.e2e.mts <phase>
 *
 * Phases (the server env differs between them, see design/phase-5-6b3/README.md):
 *   setup     server WITHOUT FIGHT_SESSION_UI_USERS: create accounts A (tester) and B, pair, sync.
 *   run       server WITH FIGHT_SESSION_UI_USERS=<A id>: gate, prepare, start, live, end, overlays…
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
const OUT = "design/phase-5-6b3/screenshots/full";
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

function profile(cfn: string, ryuMr: number) {
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
    if (c.character_tool_name === "ryu") c.league_info.master_rating = ryuMr;
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
    externalMatchId: `E2E-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() - 3_000),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
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
const isFight = (p: Page) =>
  p
    .locator('[data-dashboard-ui="fight-session"]')
    .count()
    .then((n) => n === 1);
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
async function ageCompanion(userId: string, minutes: number) {
  await sql`update companion_device set last_seen_at = now() - make_interval(mins => ${minutes}) where user_id = ${userId}`;
  await sql`update companion_snapshot set updated_at = now() - make_interval(mins => ${minutes}),
    profile_observed_at = now() - make_interval(mins => ${minutes}),
    matches_observed_at = now() - make_interval(mins => ${minutes}) where user_id = ${userId}`;
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

async function run() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  // Re-runnable: close a session left active by an interrupted run (fictitious local account).
  await sql`update game_session set status = 'ended', ended_at = now()
    where status = 'active' and player_id in (select id from sf6_player where user_id = ${A.id})`;

  /* Gate: B (not listed) can't force it */
  {
    const ctx = await ctxFor(browser, B, { extraHTTPHeaders: { "x-ui": "fight-session" } });
    await ctx.addCookies([
      { name: "ui", value: "fight-session", url: APP },
      { name: "dashboard-ui", value: "fight-session", url: APP },
    ]);
    const p = await ctx.newPage();
    await p.goto(`${APP}/dashboard?ui=fight-session`);
    check(
      "gate: ineligible account forcing ?ui=, cookies and a header still gets classic",
      !(await isFight(p)),
    );
    check(
      "classic: status bar + classic start button present",
      (await p.getByText("Iniciar sesión de juego").count()) > 0,
    );
    await shot(p, "classic--prepare--desktop");
    await p.evaluate(() => localStorage.setItem("ui", "fight-session"));
    await p.reload();
    check("gate: localStorage cannot enable it either", !(await isFight(p)));
    await ctx.close();
  }

  /* A: eligible */
  const ctx = await ctxFor(browser, A);
  // Fresh Companion data for A (the start requires data younger than the freshness window).
  await sync(A, { profile: profile(A.cfn, 1571), battlelogObserved: true });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource"))
      errors.push(m.text());
  });
  const fightStreams = await streamRequests(p, "/dashboard");
  check("gate: eligible account gets the Fight Session dashboard", await isFight(p));
  check(
    "realtime: exactly one SSE connection (Fight Session)",
    fightStreams === 1,
    `${fightStreams}`,
  );
  await p.goto(`${APP}/dashboard?ui=classic`);
  check("opt-out: ?ui=classic shows the classic dashboard to the tester", !(await isFight(p)));
  await shot(p, "classic--tester--desktop");
  const classicStreams = await streamRequests(p, "/dashboard?ui=classic");
  check(
    "realtime: exactly one SSE connection (classic)",
    classicStreams === 1,
    `${classicStreams}`,
  );
  const classicUrls = await p
    .locator('input[aria-label*="OBS"], input[readonly]')
    .evaluateAll((els) =>
      els
        .map((e) => (e as HTMLInputElement).value)
        .filter((v) => v.includes("/overlay/"))
        .sort(),
    );

  await p.goto(`${APP}/dashboard`);
  const tokens = (
    await sql<
      { public_token: string }[]
    >`select o.public_token from overlay o join sf6_player p on p.id = o.player_id where p.user_id = ${A.id}`
  )
    .map((r) => `${APP}/overlay/${r.public_token}`)
    .sort();
  const fightUrls = await p
    .locator('input[aria-label*="OBS"], input[readonly]')
    .evaluateAll((els) =>
      els
        .map((e) => (e as HTMLInputElement).value)
        .filter((v) => v.includes("/overlay/"))
        .sort(),
    );
  check(
    "overlays: same OBS URLs in both modes and equal to the stored tokens",
    JSON.stringify(fightUrls) === JSON.stringify(tokens) &&
      JSON.stringify(classicUrls) === JSON.stringify(tokens),
    `${fightUrls.length} urls`,
  );
  const ovControls = {
    configure: await p.locator('#overlays a[href^="/dashboard/overlays/"]').count(),
    copy: await p.locator("#overlays button", { hasText: /copiar url/i }).count(),
    preview: await p.locator('#overlays a[target="_blank"][href*="/overlay/"]').count(),
    create: await p
      .locator("#overlays")
      .getByText(/nuevo overlay/i)
      .count(),
  };
  check(
    "overlays: configure + copy + preview + create are available",
    ovControls.configure >= 2 &&
      ovControls.copy >= 2 &&
      ovControls.preview >= 2 &&
      ovControls.create >= 1,
    JSON.stringify(ovControls),
  );

  /* PREPARE */
  const start = p.locator('[data-k="start"]');
  await start.waitFor();
  check(
    "prepare: one primary CTA, enabled with a fresh Companion",
    (await start.count()) === 1 && !(await start.isDisabled()),
  );
  check(
    "prepare: CTA in the first viewport (1440×900)",
    ((await start.boundingBox())?.y ?? 9999) + 80 < 900,
  );
  await shot(p, "fight--prepare--desktop");
  for (const [name, w, h] of [
    ["laptop", 1280, 720],
    ["mobile", 390, 844],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(400);
    const box = await start.boundingBox();
    check(
      `prepare @${name}: CTA visible without scrolling`,
      !!box && box.y >= 0 && box.y + box.height <= h,
      box ? `y=${Math.round(box.y)}` : "none",
    );
    check(`prepare @${name}: no horizontal overflow`, !(await overflowX(p)));
    await shot(p, `fight--prepare--${name}`, false);
    await shot(p, `fight--prepare--${name}--full`);
  }
  // Mobile: the overlays are one tap away and the fixed bar does not cover the end of the page.
  await p.getByRole("link", { name: /Ir a tus overlays/ }).click();
  await p.waitForTimeout(500);
  const ov = await p.locator("#overlays").boundingBox();
  check(
    "mobile: «Ir a tus overlays» brings the overlay console into view",
    !!ov && ov.y < 844 && ov.y > -10,
  );
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(300);
  const cover = await p.evaluate(() => {
    const bar = document.querySelector('[data-k="start"]')?.closest("div");
    const barTop = bar?.getBoundingClientRect().top ?? 0;
    // Visible content only: decorative/clipped parts (the stage's ghost name) are excluded.
    // Leaf elements only: containers include the reserved bottom padding by design.
    const items = Array.from(document.querySelectorAll("main *")).filter((e) => {
      const el = e as HTMLElement;
      return (
        el.childElementCount === 0 &&
        el.offsetParent &&
        !bar?.contains(el) &&
        !el.closest('[aria-hidden="true"]') &&
        el.getClientRects().length > 0
      );
    });
    let worst = { bottom: 0, what: "" };
    for (const el of items) {
      const b = el.getBoundingClientRect().bottom;
      if (b > worst.bottom)
        worst = {
          bottom: b,
          what: `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`,
        };
    }
    return { barTop, ...worst };
  });
  check(
    "mobile: last content ends above the fixed action bar",
    cover.bottom <= cover.barTop + 1,
    `content ${Math.round(cover.bottom)} (${cover.what}) / bar ${Math.round(cover.barTop)}`,
  );
  await p.setViewportSize({ width: 1440, height: 900 });

  /* Keyboard: the CTA is reached early from the top of the page */
  await sync(A, { profile: profile(A.cfn, 1571), battlelogObserved: true });
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  let tabs = 0;
  for (; tabs < 20; tabs++) {
    await p.keyboard.press("Tab");
    if ((await p.evaluate(() => document.activeElement?.getAttribute("data-k"))) === "start") break;
  }
  check("keyboard: start reached by Tab", tabs < 20, `${tabs + 1} Tab presses`);
  const ring = await p.evaluate(
    () => getComputedStyle(document.activeElement as Element).boxShadow,
  );
  check("keyboard: focus visible on the clipped CTA (inset ring)", ring.includes("inset"));
  await shot(p, "fight--prepare--focus", false);

  /* Companion disconnected / Buckler stale */
  await ageCompanion(A.id, 20);
  await p.reload();
  await start.waitFor();
  check(
    "disconnected: CTA disabled and the next step is explained",
    (await start.isDisabled()) && (await p.locator("#fs-start-why").count()) === 1,
  );
  check(
    "disconnected: status reads «No listo», never «Conectado» for the Companion",
    (await p.getByText("No listo").count()) > 0,
  );
  await shot(p, "fight--prepare--disconnected--desktop");
  await p.setViewportSize({ width: 390, height: 844 });
  await shot(p, "fight--prepare--disconnected--mobile", false);
  await p.setViewportSize({ width: 1440, height: 900 });
  await sync(A, { profile: profile(A.cfn, 1571), battlelogObserved: true });

  /* Start failure: server rejects (Companion data removed after the page loaded) */
  await p.reload();
  await start.waitFor();
  await p.waitForTimeout(500);
  await sql`delete from companion_snapshot where user_id = ${A.id}`;
  await start.click();
  const alert = p.locator('#session [role="alert"]');
  await alert.waitFor({ timeout: 20_000 });
  const startError = (await alert.innerText()).trim();
  const activeAfterFail = (
    await sql`select 1 from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${A.id} and gs.status = 'active'`
  ).length;
  check(
    "start failure: server error shown, no session created",
    startError.length > 0 && activeAfterFail === 0,
    startError,
  );
  await shot(p, "fight--prepare--start-error--desktop");
  await sync(A, { profile: profile(A.cfn, 1571), battlelogObserved: true });

  /* Start success (double click = one session) */
  await p.reload();
  await start.waitFor();
  await p.waitForTimeout(500);
  await start.dblclick();
  await p.locator('[data-k="end"]').waitFor({ timeout: 30_000 });
  const active = (
    await sql`select 1 from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${A.id} and gs.status = 'active'`
  ).length;
  check(
    "start: real action → active view; exactly one active session in the DB",
    active === 1,
    `${active}`,
  );
  check(
    "active: no ambiguous «Iniciar nueva sesión»",
    (await p.getByText("Iniciar nueva sesión").count()) === 0,
  );
  await shot(p, "fight--active--desktop");

  /* LIVE · 0 matches */
  const summaryText = () =>
    p.locator("section[aria-label='Marcador de la sesión'] p").first().innerText();
  const stripLabels = () =>
    p
      .locator("ol[aria-label='Partidas de la sesión'] li")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check(
    "LIVE · 0 matches: scoreboard «—», waiting state",
    (await p.getByText("Esperando tu primera partida Ranked…").count()) === 1 &&
      (await p.locator('[data-testid="fs-winrate"]').innerText()).trim() === "—",
  );
  check(
    "LIVE: the classic statistics panel is gone from the Fight Session view",
    (await p.getByText("Porcentaje de victorias").count()) === 0,
  );
  await shot(p, "live--0-matches--desktop");

  /* A ranked match arrives from the battlelog only (no profile yet) — through the existing SSE.
     It must be played AFTER the last profile observation (taken at session start) for the
     post-match rating to be pending, as in real play. */
  await p.waitForTimeout(5_000);
  await sync(A, { matches: [match("win")], battlelogObserved: true });
  await p.waitForFunction(
    () => (document.body.textContent ?? "").includes("Victoria vs Ken"),
    null,
    {
      timeout: 30_000,
    },
  );
  check(
    "match 1 (no reload): scoreboard, last match and strip agree",
    /^1 victorias, 0 derrotas, 100\s% de victorias en 1 partida$/.test(await summaryText()) &&
      JSON.stringify(await stripLabels()) === JSON.stringify(["Partida 1: Victoria"]),
    await summaryText(),
  );
  check(
    "match 1: «Nueva» badge on the latest match",
    (await p.getByText("Nueva", { exact: true }).count()) === 1,
  );
  check(
    "match 1: post-match MR not observed yet ⇒ last confirmed value, labelled",
    (await p.getByText(/MR pendiente · último confirmado/).count()) === 1,
  );
  await shot(p, "live--match-1-pending--desktop");

  /* Another match (battlelog only) */
  await sync(A, { matches: [match("loss")], battlelogObserved: true });
  await p.waitForFunction(
    () => document.querySelectorAll("ol[aria-label='Partidas de la sesión'] li").length === 2,
    null,
    { timeout: 30_000 },
  );
  check(
    "match 2: strip updated in order; win rate consistent with the counts",
    JSON.stringify(await stripLabels()) ===
      JSON.stringify(["Partida 1: Victoria", "Partida 2: Derrota"]) &&
      /^1 victorias, 1 derrotas, 50\s% de victorias en 2 partidas$/.test(await summaryText()),
  );
  check("match 2: last match is the loss", (await p.getByText("Derrota vs Ken").count()) === 1);
  await shot(p, "live--match-2--desktop");

  /* The next profile observation confirms the MR */
  await sync(A, { profile: profile(A.cfn, 1570), battlelogObserved: false });
  await p.waitForFunction(
    () => !(document.body.textContent ?? "").includes("pendiente · último confirmado"),
    null,
    { timeout: 30_000 },
  );
  const ratingText = await p.locator(".fs-rating").first().innerText();
  check(
    "profile observation: rating confirmed, engine session delta (1571 → 1570, −1)",
    /1571[\s\S]*1570[\s\S]*MR[\s\S]*▼\s*[−-]1/.test(ratingText),
    ratingText.replace(/\s+/g, " "),
  );
  await shot(p, "live--rating-confirmed--desktop");
  const dbCount = await sql<
    { n: number }[]
  >`select count(*)::int n from match m join game_session gs on gs.id = m.session_id join sf6_player p on p.id = gs.player_id where p.user_id = ${A.id} and gs.status = 'active'`;
  check("DB: the session counts exactly the 2 matches shown", dbCount[0]?.n === 2);

  await p.reload();
  await p.locator('[data-k="end"]').waitFor({ timeout: 20_000 });
  check(
    "refresh while active: same LIVE state, no «Nueva» replay on load",
    JSON.stringify(await stripLabels()) ===
      JSON.stringify(["Partida 1: Victoria", "Partida 2: Derrota"]) &&
      (await p.getByText("Nueva", { exact: true }).count()) === 0,
  );
  for (const [name, w, h] of [
    ["laptop", 1280, 720],
    ["mobile", 390, 844],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(400);
    check(`LIVE @${name}: no horizontal overflow`, !(await overflowX(p)));
    await shot(p, `live--${name}`, false);
    await shot(p, `live--${name}--full`);
  }
  await p.setViewportSize({ width: 1440, height: 900 });

  /* Companion quiet mid-session */
  await ageCompanion(A.id, 6);
  await p.reload();
  await p.locator('[data-k="end"]').waitFor({ timeout: 20_000 });
  check(
    "mid-session Companion quiet: «Sin datos recientes», session still active",
    (await p.getByText("Sin datos recientes").count()) > 0 &&
      (await p.locator('[data-k="end"]').count()) === 1,
  );
  await shot(p, "fight--active--quiet--desktop");
  await sync(A, { profile: profile(A.cfn, 1570), battlelogObserved: true });
  await p.reload();
  await p.locator('[data-k="end"]').waitFor({ timeout: 20_000 });

  /* End: cancel (Esc), then confirm */
  await p.locator('[data-k="end"]').click();
  await shot(p, "fight--active--confirm--desktop", false);
  await p.keyboard.press("Escape");
  check(
    "end: Esc cancels, focus back on «Finalizar sesión»",
    (await p.evaluate(() => document.activeElement?.getAttribute("data-k"))) === "end",
  );
  await p.locator('[data-k="end"]').click();
  await p.locator('[data-k="confirm-end"]').click();
  await p.waitForURL(/\/dashboard\/sessions\/.+ended=1/, { timeout: 30_000 });
  const ended = await sql<
    { status: string; n: number }[]
  >`select gs.status, (select count(*)::int from match m where m.session_id = gs.id) n from game_session gs join sf6_player p on p.id = gs.player_id where p.user_id = ${A.id} order by gs.started_at desc limit 1`;
  check(
    "end: real action → existing recap; session ended with its 2 matches",
    ended[0]?.status === "ended" && ended[0]?.n === 2,
    JSON.stringify(ended[0]),
  );
  await shot(p, "fight--recap-after-end--desktop");
  await p
    .getByRole("link", { name: /Preparar nueva sesión/ })
    .first()
    .click();
  await p.waitForURL(/\/dashboard/);
  await p.waitForTimeout(800);
  check(
    "after end: back to PREPARE with the last session",
    (await p.locator('[data-k="start"]').count()) === 1 &&
      (await p.getByText("Tu última sesión").count()) === 1,
  );
  await shot(p, "fight--prepare-after-session--desktop");
  await p.reload();
  await start.waitFor();
  check("refresh after end: PREPARE", (await p.locator('[data-k="start"]').count()) === 1);
  check(
    "session records: history and recap still reachable",
    (await p.locator('a[href^="/dashboard/sessions/"]').count()) >= 1,
  );

  /* English + reduced motion */
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: APP }]);
  await sql`update auth_user set locale = 'en' where id = ${A.id}`;
  await p.goto(`${APP}/dashboard`);
  await start.waitFor();
  check(
    "EN: labels",
    (await p.getByText("Start game session").count()) === 1 &&
      (await p.getByText("Ready to play").count()) >= 1,
  );
  await shot(p, "fight--prepare--en--desktop");
  await p.setViewportSize({ width: 390, height: 844 });
  check("EN @mobile: no horizontal overflow", !(await overflowX(p)));
  await shot(p, "fight--prepare--en--mobile", false);
  await sql`update auth_user set locale = 'es' where id = ${A.id}`;
  await ctx.close();

  const rm = await ctxFor(browser, A, { reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`${APP}/dashboard`);
  await rp.waitForTimeout(1_000);
  const running = await rp.evaluate(
    () =>
      document
        .getAnimations()
        .filter((a) => Number(a.effect?.getComputedTiming().duration ?? 0) > 5).length,
  );
  check(
    "reduced motion: no running animation on the Fight Session dashboard",
    running === 0,
    `${running}`,
  );
  await rm.close();

  check("no page errors / hydration warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

async function rollback() {
  const { A } = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const ctx: BrowserContext = await ctxFor(browser, A);
  const p = await ctx.newPage();
  await p.goto(`${APP}/dashboard`);
  await p.locator("#session").waitFor();
  check(
    "rollback: variable cleared ⇒ the tester is back on the classic dashboard",
    !(await isFight(p)),
  );
  await shot(p, "rollback--classic--desktop");
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
  const file = `design/phase-5-6b3/screenshots/e2e-${PHASE}.json`;
  writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
}
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
