/**
 * Missing rank in completed sessions — browser check against a LOCAL production build and a LOCAL
 * database (refuses anything else). One fictitious `@test.local` account reproduces the reported
 * shape through the real Companion sync: a Master character in a higher Master league
 * (`master_league` 37 ⇒ no evidence-backed label ⇒ stored rank null), session 1866 → 1903 MR,
 * ENDED. The public overlay is then rendered in Broadcast and the default (Competitive) theme.
 *
 *   E2E_STATE=/tmp/rank.json pnpm exec tsx design/fix-overlay-missing-rank/e2e/missing-rank.e2e.mts setup
 *   E2E_STATE=/tmp/rank.json pnpm exec tsx design/fix-overlay-missing-rank/e2e/missing-rank.e2e.mts capture <before|after>
 *   E2E_STATE=/tmp/rank.json pnpm exec tsx design/fix-overlay-missing-rank/e2e/missing-rank.e2e.mts cleanup
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const LABEL = process.argv[3] ?? "after";
const OUT = `design/fix-overlay-missing-rank/screenshots`;
const STATE = process.env.E2E_STATE ?? "";
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
if (!STATE) throw new Error("E2E_STATE (a path outside the repo) is required");
mkdirSync(OUT, { recursive: true });
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

interface Saved {
  id: string;
  cfn: string;
  deviceToken: string;
  overlayId: string;
  token: string;
}

/** Profile with Ryu in Master league 37 (no captured label ⇒ rank null) at `mr`. */
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
    if (c.character_tool_name === "ryu") {
      c.league_info.master_rating = mr;
      c.league_info.master_league = 37;
    }
  const n = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: "1733837998",
  }).profile;
  return core.toWireProfile({
    ...n,
    cfnUserId: cfn,
    displayName: "Streamer",
    favoriteCharacterKey: "ryu",
  });
}
let seq = 0;
const match = (result: "win" | "loss") =>
  core.toWireMatch({
    externalMatchId: `RANK-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() + seq),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponent: { name: `Rival ${seq}`, characterKey: "ken", characterName: "Ken" },
    ratingBefore: null,
    ratingAfter: null,
  });
let lastSync = 0;
async function sync(s: Pick<Saved, "cfn" | "deviceToken">, body: Record<string, unknown>) {
  const wait = lastSync + 6_200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${APP}/api/companion/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${s.deviceToken}` },
    body: JSON.stringify({
      cfnUserId: s.cfn,
      observedAt: new Date().toISOString(),
      profile: null,
      matches: [],
      gapSuspected: false,
      battlelogObserved: true,
      client: { version: "0.4.0", transport: "service_worker" },
      ...body,
    }),
  });
  lastSync = Date.now();
  if (res.status !== 200) throw new Error(`sync ${res.status}`);
}

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../../src/server/db/client");
  const ctx = await browser.newContext({ locale: "es-ES" });
  const page = await ctx.newPage();
  const email = `rank-${randomUUID().slice(0, 6)}@test.local`;
  await page.goto(`${APP}/signup`);
  await page.fill("#name", "Tester");
  await page.fill("#email", email);
  await page.fill("#password", `e2e-${randomUUID()}`);
  await page.click('button[type="submit"]');
  await page.waitForURL(/onboarding/);
  const id = (await sql<{ id: string }[]>`select id from auth_user where email = ${email}`)[0]!.id;
  const { code } = await createPairingCode(getDb(), id);
  const pair = await fetch(`${APP}/api/companion/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName: "E2E" }),
  });
  const deviceToken = ((await pair.json()) as { deviceToken: string }).deviceToken; // never printed
  const cfn = "9990000820";
  await sync({ cfn, deviceToken }, { profile: profile(cfn, 1866) });
  await page.fill("#cfn", cfn);
  await page.getByRole("button", { name: "Buscar jugador" }).click();
  await page.getByText("Jugador encontrado").waitFor();
  await page.getByRole("button", { name: /Soy yo/ }).click();
  await page.waitForURL(/dashboard/);
  await page.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
  await page.getByRole("button", { name: "Finalizar sesión" }).first().waitFor({ timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1_500));
  await sync(
    { cfn, deviceToken },
    { matches: [match("win"), match("win"), match("loss"), match("win")] },
  );
  await sync({ cfn, deviceToken }, { profile: profile(cfn, 1903) });
  await new Promise((r) => setTimeout(r, 4_000));
  await page.getByRole("button", { name: "Finalizar sesión" }).first().click();
  await page.getByRole("button", { name: "Sí, finalizar sesión" }).first().click();
  await page.waitForURL(/ended=1/, { timeout: 30_000 });
  const o = (
    await sql<{ id: string; public_token: string }[]>`select o.id, o.public_token from overlay o
      join sf6_player p on p.id = o.player_id where p.user_id = ${id} order by o.created_at limit 1`
  )[0]!;
  writeFileSync(
    STATE,
    JSON.stringify({
      id,
      cfn,
      deviceToken,
      overlayId: o.id,
      token: o.public_token,
    } satisfies Saved),
  );
  await browser.close();
  await closeDb();
  console.log("setup done");
}

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function capture() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  // What the database holds for this local test session (never production).
  const stored = (
    await sql<
      {
        status: string;
        initial_rank: string | null;
        final_rank: string | null;
        initial_master_rate: number | null;
        final_master_rate: number | null;
      }[]
    >`select gs.status, b.initial_rank, b.final_rank, b.initial_master_rate, b.final_master_rate
      from game_session gs join sf6_player p on p.id = gs.player_id
      join session_character_baseline b on b.session_id = gs.id and b.character_key = 'ryu'
      where p.user_id = ${s.id} order by gs.started_at desc limit 1`
  )[0];
  console.log("stored:", JSON.stringify(stored));
  const browser = await chromium.launch();
  for (const theme of ["broadcast", "competitive"] as const) {
    await sql`update overlay set config = jsonb_set(jsonb_set(config, '{theme}', to_jsonb(${theme}::text)),
      '{fields,rank}', 'true'::jsonb) where id = ${s.overlayId}`;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 400 } });
    const p = await ctx.newPage();
    await p.goto(`${APP}/overlay/${s.token}`);
    await p.locator(".sf6-overlay").first().waitFor({ timeout: 30_000 });
    await p.waitForTimeout(1_500);
    const text = (await p.locator(".sf6-overlay").first().textContent()) ?? "";
    await p.screenshot({ path: `${OUT}/${theme}--${LABEL}.png`, animations: "disabled" });
    if (LABEL === "after") {
      check(`${theme}: rank Ultimate Master`, text.includes("Ultimate Master"), text.slice(0, 200));
      check(
        `${theme}: MR 1903 and delta +37 unchanged`,
        text.includes("1903") && /\+\s?37/.test(text),
      );
      const wl = theme === "broadcast" ? /3V\s?1D/ : /Victorias3\/Derrotas1/;
      check(
        `${theme}: other metrics unchanged (3 W / 1 L, 75 %)`,
        wl.test(text) && /75\s%/.test(text),
      );
    } else console.log(`${theme} (${LABEL}):`, text.slice(0, 200));
    await ctx.close();
  }
  if (LABEL === "after")
    check(
      "stored rows untouched: ended, ranks still null, MR 1866 → 1903",
      stored?.status === "ended" &&
        stored.initial_rank === null &&
        stored.final_rank === null &&
        stored.initial_master_rate === 1866 &&
        stored.final_master_rate === 1903,
    );
  await browser.close();
  if (results.length)
    writeFileSync(
      `${OUT}/checks.json`,
      JSON.stringify({ ranAt: new Date().toISOString(), stored, results }, null, 2),
    );
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id = ${s.id} and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "capture") await capture();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | capture <label> | cleanup");
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
