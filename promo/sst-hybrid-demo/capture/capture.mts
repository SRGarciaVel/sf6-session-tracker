/**
 * Captures the REAL SST interface for the promo video from a LOCAL production build
 * (`pnpm build && SF6_PROVIDER=companion APP_URL=http://localhost:3171 PORT=3171 pnpm start`)
 * against a LOCAL database, with a fictitious account and fictitious data (demo-data.mts).
 *
 *   tsx promo/sst-hybrid-demo/capture/capture.mts
 *
 * Output: promo/sst-hybrid-demo/assets/captures/ (git-ignored, regenerable).
 * Guards: refuses any non-local database or tracker. Removes the demo account at the end.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";
import { DEMO } from "./demo-data";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const OUT = "promo/sst-hybrid-demo/assets/captures";
mkdirSync(`${OUT}/count`, { recursive: true });

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const log = (...a: unknown[]) => console.log(...a);
const PHASE = process.argv[2] ?? "all";

/* ───────── fictitious Companion data through the real sync endpoint ───────── */

const FIXTURE_CFN = "1733837998"; // sanitized fixture shape only; identity replaced below
function profile(p: { yasmine: number; ryuMr?: number; ryuPos?: number; aki?: number }) {
  const raw = JSON.parse(
    readFileSync(`tests/fixtures/capcom/play-${FIXTURE_CFN}.json`, "utf8"),
  ) as {
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
    if (c.character_tool_name === "yasmine") c.league_info.master_rating = p.yasmine;
    if (c.character_tool_name === "ryu") {
      c.league_info.master_rating = p.ryuMr ?? DEMO.ryu.mr;
      c.league_info.master_rating_ranking = p.ryuPos ?? DEMO.ryu.position;
    }
    if (c.character_tool_name === "aki") c.league_info.league_point = p.aki ?? DEMO.aki.lp;
  }
  const n = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: FIXTURE_CFN,
  }).profile;
  return core.toWireProfile({
    ...n,
    cfnUserId: DEMO.cfn,
    displayName: DEMO.displayName,
    favoriteCharacterKey: "yasmine",
  });
}
let matchSeq = 0;
// Played "just now": the session only counts matches played after it started.
const match = (result: "win" | "loss") =>
  core.toWireMatch({
    externalMatchId: `DEMO-${Date.now()}-${++matchSeq}`,
    playedAt: new Date(Date.now() - 3_000),
    mode: "ranked",
    result,
    characterKey: "yasmine",
    characterName: "Yasmine",
    opponent: {
      name: `Rival ${matchSeq}`,
      characterKey: ["ken", "jp", "juri", "luke", "cammy", "marisa", "guile", "kimberly"][
        matchSeq % 8
      ]!,
      characterName: ["Ken", "JP", "Juri", "Luke", "Cammy", "Marisa", "Guile", "Kimberly"][
        matchSeq % 8
      ]!,
    },
    ratingBefore: null,
    ratingAfter: null,
  });

let deviceToken = "";
let lastSync = 0;
async function sync(body: Record<string, unknown>) {
  const wait = lastSync + 6_200 - Date.now(); // server: 1 sync / 5 s per device
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${APP}/api/companion/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({
      cfnUserId: DEMO.cfn,
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

/* ───────── account ───────── */

const browser: Browser = await chromium.launch();
const suffix = randomUUID().slice(0, 6);
const email = DEMO.email(suffix);
const userCtx: BrowserContext = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  locale: "es-ES",
});
const page = await userCtx.newPage();
await page.goto(`${APP}/signup`);
await page.fill("#name", "Demo");
await page.fill("#email", email);
await page.fill("#password", `promo-${randomUUID()}`);
await page.click('button[type="submit"]');
await page.waitForURL(/onboarding/);
const one = (rows: { id: string }[]) => {
  if (!rows[0]) throw new Error("expected one row");
  return rows[0].id;
};
const userId = one(await sql`select id from auth_user where email = ${email}`);

const { createPairingCode } = await import("../../../src/server/companion/service");
const { getDb, closeDb } = await import("../../../src/server/db/client");
const { code } = await createPairingCode(getDb(), userId);
const pair = await fetch(`${APP}/api/companion/pair`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, deviceName: "Demo browser" }),
});
deviceToken = ((await pair.json()) as { deviceToken: string }).deviceToken; // never printed

await sync({ profile: profile({ yasmine: DEMO.yasmine.baseline }), legend: DEMO.legend });
await page.fill("#cfn", DEMO.cfn);
await page.getByRole("button", { name: "Buscar jugador" }).click();
await page.getByText("Jugador encontrado").waitFor();
await page.getByRole("button", { name: /Soy yo/ }).click();
await page.waitForURL(/dashboard/);
await page.getByRole("button", { name: "Iniciar sesión de juego" }).click();
await page.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 20_000 });
const playerId = one(await sql`select id from sf6_player where user_id = ${userId}`);
log("demo account ready");

/* ───────── session so far: 7 ranked matches (5 W · 2 L), MR 1829 → 1859 ───────── */

const steps = DEMO.results.length;
for (let i = 0; i < steps; i++) {
  const mr = Math.round(
    DEMO.yasmine.baseline + ((DEMO.yasmine.before - DEMO.yasmine.baseline) * (i + 1)) / steps,
  );
  await sync({
    matches: [match(DEMO.results[i]!)],
    profile: profile({ yasmine: mr }),
    battlelogObserved: true,
    legend: DEMO.legend,
  });
}
log("session populated");

async function shot(p: Page, path: string, opts: { full?: boolean } = {}) {
  await p.waitForTimeout(900);
  // The account e-mail is fictitious, but it is not part of the story: show a neutral label.
  await p.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
    }
  });
  await p.screenshot({ path, fullPage: opts.full ?? false, animations: "disabled" });
  log("captured", path);
}

await page.goto(`${APP}/dashboard`);
await shot(page, `${OUT}/dashboard-before.png`, { full: true });

if (PHASE === "peek") {
  await browser.close();
  await sql`delete from auth_user where id = ${userId}`;
  await sql.end();
  await closeDb();
  process.exit(0);
}

/* ───────── overlays (stored configs, as the builder would save them) ───────── */

const { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } =
  await import("../../../src/domain/overlay/config");
const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } =
  await import("../../../src/domain/overlay/rank-progress");
async function overlay(name: string, config: postgres.JSONValue) {
  const token = Buffer.from(randomUUID() + randomUUID())
    .toString("base64url")
    .slice(0, 32);
  const id = one(
    await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${name}, ${token}, ${sql.json(config)}) returning id`,
  );
  return { token, id };
}
const sessionOv = await overlay("Sesión", {
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "competitive"),
  locale: "es",
  ratingCharacterKey: "yasmine",
  fields: { ...DEFAULT_OVERLAY_CONFIG.fields, rank: true },
  ratingTransition: "count",
  ratingTransitionSpeed: "slow",
});
const rpBroadcast = await overlay("Progreso de rango", {
  ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  locale: "es",
  characterKey: "ryu",
  style: "broadcast",
});
const rpCompact = await overlay("Progreso de rango (compacto)", {
  ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  locale: "es",
  characterKey: "ryu",
  style: "compact",
});

/* Static captures of the real public OBS pages (transparent, 2× for crisp zooms). */
async function obs(token: string, w: number, h: number, path: string) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${APP}/overlay/${token}`);
  await p.locator(".sf6-overlay").waitFor();
  await p.waitForTimeout(1200);
  await p.screenshot({ path, omitBackground: true, animations: "disabled" });
  await ctx.close();
  log("captured", path);
}
await obs(rpBroadcast.token, 640, 140, `${OUT}/rank-broadcast.png`);
await obs(rpCompact.token, 400, 140, `${OUT}/rank-compact.png`);

/* ───────── the count: real renderer, controlled clock, one screenshot per video frame ───────── */

const countCtx = await browser.newContext({
  viewport: { width: 800, height: 180 },
  deviceScaleFactor: 2,
});
const countPage = await countCtx.newPage();
await countPage.clock.install();
await countPage.goto(`${APP}/overlay/${sessionOv.token}`);
await countPage.locator(".sf6-overlay").waitFor();
await countPage.waitForTimeout(1500);
await countPage.clock.pauseAt(Date.now() + 1000);
const frameShot = async (i: number) =>
  countPage.screenshot({
    path: `${OUT}/count/${String(i).padStart(3, "0")}.png`,
    omitBackground: true,
    animations: "disabled",
  });
// Showcased match, exactly as the Companion delivers it: the battlelog first (no post-match
// rating ⇒ the overlay holds 1859 · +30), then the next profile observation (1861 ⇒ count).
await sync({ matches: [match("win")], battlelogObserved: true });
await countPage.clock.runFor(2000);
await frameShot(0);
await sync({
  profile: profile({ yasmine: DEMO.yasmine.after }),
  battlelogObserved: false,
  legend: DEMO.legend,
});
await countPage.waitForFunction(() => document.querySelector(".ov-counting") !== null, null, {
  timeout: 15_000,
});
const FRAMES = 36; // 1.2 s at 30 fps (count runs 0.8 s, then rests)
for (let i = 1; i <= FRAMES; i++) {
  await countPage.clock.runFor(1000 / 30);
  await frameShot(i);
}
log(`captured ${FRAMES + 1} count frames`);
await countCtx.close();

await page.goto(`${APP}/dashboard`);
await shot(page, `${OUT}/dashboard-after.png`, { full: true });

/* Builder (rating transition controls) — Style tab. */
await page.goto(`${APP}/dashboard/overlays/${sessionOv.id}`);
await page.getByRole("tab", { name: /Estilo/ }).click();
await page.getByTestId("rating-transition").scrollIntoViewIfNeeded();
await shot(page, `${OUT}/builder-style.png`);
await page.goto(`${APP}/dashboard/overlays/${rpBroadcast.id}`);
await shot(page, `${OUT}/builder-rank.png`);

writeFileSync(
  `${OUT}/README.txt`,
  "Generated by capture.mts from a local demo instance (fictitious data). Do not commit.\n",
);
await browser.close();
await sql`delete from auth_user where id = ${userId}`;
log("demo account removed");
await sql.end();
await closeDb();
