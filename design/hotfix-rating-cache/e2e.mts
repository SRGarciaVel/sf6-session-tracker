/**
 * Session rating consistency hotfix — browser E2E against a LOCAL production build and a LOCAL
 * database (refuses anything else). Fictitious `@test.local` accounts; Companion data goes
 * through the real `/api/companion/sync` endpoint; sessions start/end through the real UI.
 *
 *   E2E_STATE=/tmp/x.json pnpm exec tsx design/hotfix-rating-cache/e2e.mts setup     # no allowlist
 *   E2E_STATE=/tmp/x.json pnpm exec tsx design/hotfix-rating-cache/e2e.mts run       # FIGHT_SESSION_UI_USERS=<A id>
 *   E2E_STATE=/tmp/x.json pnpm exec tsx design/hotfix-rating-cache/e2e.mts cleanup
 *
 * A uses the Fight Session UI, B the classic UI. For each: START → (inside the 5 s profile cache
 * window) a match + a newer profile (Ryu MR 1402 → 1414, Jamie LP 23006 → 22982) → LIVE → END →
 * RECAP, then END → immediate START with a newer profile. Every result is checked in the
 * DATABASE (frozen finals / baselines), then on screen, then again after a reload.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const OUT = "design/hotfix-rating-cache/screenshots";
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
  cfn: string;
  deviceToken: string;
  storage: string;
}

function profile(cfn: string, ryuMr: number, jamieLp: number) {
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
    displayName: "SIM",
    favoriteCharacterKey: "ryu",
  });
}
let seq = 0;
const match = (result: "win" | "loss", character: "ryu" | "jamie") =>
  core.toWireMatch({
    externalMatchId: `E2E-${Date.now()}-${++seq}`,
    playedAt: new Date(),
    mode: "ranked",
    result,
    characterKey: character,
    characterName: character === "ryu" ? "Ryu" : "Jamie",
    opponent: { name: `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
    ratingBefore: null,
    ratingAfter: null,
  });
const lastSync = new Map<string, number>();
async function sync(acc: Account, body: Record<string, unknown>) {
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
      battlelogObserved: true,
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
async function shot(p: Page, name: string, full = true) {
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
  });
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full, animations: "disabled" });
}
const latest = async (userId: string) =>
  (
    await sql<{ id: string; started_at: Date; status: string }[]>`
      select gs.id, gs.started_at, gs.status from game_session gs join sf6_player p on p.id = gs.player_id
      where p.user_id = ${userId} order by gs.started_at desc limit 1`
  )[0]!;
const frozen = async (sessionId: string) =>
  Object.fromEntries(
    (
      await sql<
        {
          character_key: string;
          initial_master_rate: number | null;
          final_master_rate: number | null;
          initial_league_points: number | null;
          final_league_points: number | null;
          final_rating_system: string | null;
        }[]
      >`select character_key, initial_master_rate, final_master_rate, initial_league_points,
          final_league_points, final_rating_system
        from session_character_baseline where session_id = ${sessionId}`
    ).map((r) => [r.character_key, r]),
  );

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../src/server/db/client");
  const make = async (key: "A" | "B", cfn: string): Promise<Account> => {
    const ctx = await browser.newContext({ locale: "es-ES" });
    const page = await ctx.newPage();
    const email = `rc-${key.toLowerCase()}-${randomUUID().slice(0, 6)}@test.local`;
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
    await sync(acc, { profile: profile(cfn, 1402, 23006) });
    await page.fill("#cfn", cfn);
    await page.getByRole("button", { name: "Buscar jugador" }).click();
    await page.getByText("Jugador encontrado").waitFor();
    await page.getByRole("button", { name: /Soy yo/ }).click();
    await page.waitForURL(/dashboard/);
    await ctx.storageState({ path: acc.storage });
    await ctx.close();
    return acc;
  };
  const A = await make("A", "9990000500");
  const B = await make("B", "9990000501");
  writeFileSync(STATE, JSON.stringify({ A, B }, null, 2));
  console.log(`setup done. Restart the server with FIGHT_SESSION_UI_USERS=${A.id}`);
  await browser.close();
  await closeDb();
}

async function flow(page: Page, acc: Account, ui: "fight" | "classic") {
  const start =
    ui === "fight"
      ? page.locator('[data-k="start"]')
      : page.getByRole("button", { name: "Iniciar sesión de juego" }).first();
  const endAsk =
    ui === "fight"
      ? page.locator('[data-k="end"]')
      : page.getByRole("button", { name: "Finalizar sesión" });
  const endConfirm =
    ui === "fight"
      ? page.locator('[data-k="confirm-end"]')
      : page.getByRole("button", { name: "Sí, finalizar sesión" });
  const label = ui === "fight" ? "Fight Session" : "classic";

  // Fresh 1402 baseline, then the window: START → newer profile → END, all < 5 s apart.
  await sync(acc, { profile: profile(acc.cfn, 1402, 23006) });
  await page.goto(`${APP}/dashboard`);
  await start.waitFor();
  await new Promise((r) =>
    setTimeout(r, Math.max(0, (lastSync.get(acc.cfn) ?? 0) + 6_300 - Date.now())),
  );
  const t0 = Date.now();
  await start.click();
  await endAsk.waitFor({ timeout: 30_000 });
  await sync(acc, {
    matches: [match("win", "ryu"), match("loss", "jamie")],
    profile: profile(acc.cfn, 1414, 22982),
  });
  await page.waitForFunction(
    () => /\+12/.test(document.querySelector("main")?.textContent ?? ""),
    null,
    { timeout: 30_000 },
  );
  check(`${label}: LIVE shows Ryu +12 MR`, true);
  await shot(page, `${ui}--live`, false);
  await endAsk.click();
  await endConfirm.click();
  const tEnd = Date.now();
  await page.waitForURL(/\/dashboard\/sessions\/.+ended=1/, { timeout: 30_000 });
  const s1 = await latest(acc.id);
  const f1 = await frozen(s1.id);
  check(
    `${label}: END ${((tEnd - t0) / 1000).toFixed(1)} s after START (inside the 5 s cache window)`,
    tEnd - t0 < 5_000,
  );
  check(
    `${label}: DB frozen finals Ryu 1402 → 1414 MR, Jamie 23006 → 22982 LP (systems not mixed)`,
    f1.ryu?.initial_master_rate === 1402 &&
      f1.ryu?.final_master_rate === 1414 &&
      f1.ryu?.final_rating_system === "mr" &&
      f1.jamie?.initial_league_points === 23006 &&
      f1.jamie?.final_league_points === 22982 &&
      f1.jamie?.final_rating_system === "lp" &&
      f1.jamie?.final_master_rate === null,
    JSON.stringify({ ryu: f1.ryu, jamie: f1.jamie }),
  );
  // The recap streams in after loading.tsx: wait for the rendered values, then read them.
  const recapShown = () =>
    page
      .waitForFunction(
        () => {
          const t = (document.querySelector("main")?.innerText ?? "").replace(/\s+/g, " ");
          return /\+12/.test(t) && /[-−]24/.test(t) && /1414/.test(t);
        },
        null,
        { timeout: 30_000 },
      )
      .then(
        () => true,
        () => false,
      );
  check(`${label}: RECAP shows +12 MR and −24 LP`, await recapShown());
  await shot(page, `${ui}--recap`);
  await page.reload();
  check(`${label}: RECAP after reload still +12 / −24`, await recapShown());

  // END → immediate START with a newer profile: the new baseline is the newest observation.
  await page.goto(`${APP}/dashboard`);
  await start.waitFor();
  await sync(acc, { profile: profile(acc.cfn, 1390, 22982) });
  await start.click();
  await endAsk.waitFor({ timeout: 30_000 });
  const s2 = await latest(acc.id);
  const f2 = await frozen(s2.id);
  check(
    `${label}: immediate next START takes the newest baseline (Ryu 1390 MR, Jamie 22982 LP)`,
    s2.id !== s1.id &&
      f2.ryu?.initial_master_rate === 1390 &&
      f2.jamie?.initial_league_points === 22982,
    JSON.stringify({ ryu: f2.ryu?.initial_master_rate, jamie: f2.jamie?.initial_league_points }),
  );
  const f1Again = await frozen(s1.id);
  check(
    `${label}: the previous session's finals are untouched by the next start`,
    f1Again.ryu?.final_master_rate === 1414 && f1Again.jamie?.final_league_points === 22982,
  );
  await endAsk.click();
  await endConfirm.click();
  await page.waitForURL(/ended=1/, { timeout: 30_000 });
}

async function run() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as { A: Account; B: Account };
  const browser = await chromium.launch();
  for (const [acc, ui] of [
    [A, "fight"],
    [B, "classic"],
  ] as const) {
    const ctx = await browser.newContext({
      storageState: acc.storage,
      locale: "es-ES",
      viewport: { width: 1440, height: 900 },
    });
    await ctx.addInitScript({ content: "window.__name = (f) => f;" });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${APP}/dashboard`);
    check(
      `${ui}: expected dashboard UI`,
      (await page.locator('[data-dashboard-ui="fight-session"]').count()) ===
        (ui === "fight" ? 1 : 0),
    );
    await flow(page, acc, ui);
    check(`${ui}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
  await browser.close();
}

async function cleanup() {
  const { A, B } = JSON.parse(readFileSync(STATE, "utf8")) as { A: Account; B: Account };
  const deleted =
    await sql`delete from auth_user where id in (${A.id}, ${B.id}) and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "run") await run();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | run | cleanup");
if (results.length)
  writeFileSync(
    `${OUT}/e2e-${PHASE}.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2),
  );
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
