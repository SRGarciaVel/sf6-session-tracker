/**
 * Phase 5.6A — visual audit of the CURRENT SST UI (read-only design evidence).
 *
 * Drives a LOCAL production build (`pnpm build && SF6_PROVIDER=companion APP_URL=http://localhost:3171
 * PORT=3171 pnpm start`) against a LOCAL database with a fictitious account, walks the session
 * lifecycle (prepare → live → end → recap) through the real UI and the real Companion sync
 * endpoint, and screenshots each state at 1440×900, 1280×720 and 390×844.
 *
 *   pnpm exec tsx design/phase-5-6a/audit/capture-current.mts
 *
 * Output: design/phase-5-6a/screenshots/current/ (full set git-ignored; a curated subset is
 * committed). Guards: refuses a non-local database/app. Deletes the demo account at the end.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const OUT = "design/phase-5-6a/screenshots/current";
mkdirSync(OUT, { recursive: true });
const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = (u: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(u).hostname);
if (!isLocal(dbUrl) || !isLocal(APP)) throw new Error("REFUSING: non-local database or app");
const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });
const log = (...a: unknown[]) => console.log(...a);
const one = (rows: { id: string }[]) => {
  if (!rows[0]) throw new Error("expected one row");
  return rows[0].id;
};

/* Fictitious identity (same dataset as the prototypes: design/phase-5-6a/prototypes/data.js). */
const CFN = "9990000200";
const NAME = "Yasmine";
const BASE_MR = 1571;
const SESSION = [
  ["win", 12],
  ["win", 11],
  ["loss", -13],
  ["win", 10],
  ["loss", -12],
  ["win", 14],
  ["win", 9],
  ["loss", -11],
  ["win", 12],
  ["win", 10],
] as const;
const PREVIOUS = [
  ["win", 1544],
  ["loss", 1532],
  ["win", 1546],
  ["win", 1559],
  ["loss", 1548],
  ["win", 1571],
] as const;

function profile(ryuMr: number) {
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
    cfnUserId: CFN,
    displayName: NAME,
    favoriteCharacterKey: "ryu",
  });
}
const OPP = ["Ken", "Juri", "Luke", "Cammy", "JP", "Marisa", "Guile", "Kimberly", "Ed", "Lily"];
let seq = 0;
const match = (result: "win" | "loss") => {
  const o = OPP[seq % OPP.length]!;
  seq++;
  return core.toWireMatch({
    externalMatchId: `AUDIT-${Date.now()}-${seq}`,
    playedAt: new Date(Date.now() - 3_000),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponent: { name: `Rival ${seq}`, characterKey: o.toLowerCase(), characterName: o },
    ratingBefore: null,
    ratingAfter: null,
  });
};

let deviceToken = "";
let lastSync = 0;
async function sync(body: Record<string, unknown>) {
  const wait = lastSync + 6_200 - Date.now(); // server: 1 sync / 5 s per device
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${APP}/api/companion/sync`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({
      cfnUserId: CFN,
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

const VIEWPORTS = [
  ["desktop", 1440, 900],
  ["laptop", 1280, 720],
  ["mobile", 390, 844],
] as const;
const notes: string[] = [];
async function shots(p: Page, name: string, only?: Array<(typeof VIEWPORTS)[number][0]>) {
  for (const [vp, w, h] of VIEWPORTS) {
    if (only && !only.includes(vp)) continue;
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(700);
    await p.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode())
        if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
    });
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (overflow) notes.push(`${name} @ ${vp}: horizontal overflow`);
    await p.screenshot({ path: `${OUT}/${name}--${vp}.png`, fullPage: true });
    await p.screenshot({ path: `${OUT}/${name}--${vp}-fold.png` });
  }
  log("captured", name);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "es-ES", viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const email = `design-${randomUUID().slice(0, 6)}@test.local`;
await page.goto(`${APP}/signup`);
await shots(page, "00-signup", ["desktop", "mobile"]);
await page.fill("#name", NAME);
await page.fill("#email", email);
await page.fill("#password", `design-${randomUUID()}`);
await page.click('button[type="submit"]');
await page.waitForURL(/onboarding/);
await shots(page, "01-onboarding-empty");
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

await sync({ profile: profile(1532), battlelogObserved: true });
await page.fill("#cfn", CFN);
await page.getByRole("button", { name: "Buscar jugador" }).click();
await page.getByText("Jugador encontrado").waitFor();
await shots(page, "02-onboarding-found", ["desktop", "mobile"]);
await page.getByRole("button", { name: /Soy yo/ }).click();
await page.waitForURL(/dashboard/);
const playerId = one(await sql`select id from sf6_player where user_id = ${userId}`);
await shots(page, "03-prepare-first-time");

/* Previous session (history + recap). */
const startBtn = () => page.getByRole("button", { name: "Iniciar sesión de juego" }).first();
const endFlow = async () => {
  await page.getByRole("button", { name: "Finalizar sesión" }).click();
  await shots(page, "confirm-end", ["desktop"]);
  await page.getByRole("button", { name: "Sí, finalizar sesión" }).click();
  await page.waitForURL(/sessions\/.+ended=1/, { timeout: 30_000 });
};
await startBtn().click();
await page.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 20_000 });
for (const [r, mr] of PREVIOUS)
  await sync({ matches: [match(r)], profile: profile(mr), battlelogObserved: true });
await page.goto(`${APP}/dashboard`);
await endFlow();
log("previous session ended");

/* Overlays as the builder would save them. */
const { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } =
  await import("../../../src/domain/overlay/config");
const { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } =
  await import("../../../src/domain/overlay/rank-progress");
async function overlay(name: string, config: postgres.JSONValue) {
  const token = Buffer.from(randomUUID() + randomUUID())
    .toString("base64url")
    .slice(0, 32);
  return one(
    await sql`insert into overlay (player_id, name, public_token, config) values (${playerId}, ${name}, ${token}, ${sql.json(config)}) returning id`,
  );
}
const sessionOverlay = await overlay("Marcador", {
  ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "competitive"),
  locale: "es",
  ratingTransition: "count",
});
await overlay("Progreso de rango", { ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, locale: "es" });

await page.goto(`${APP}/dashboard`);
await shots(page, "04-prepare-after-session");

/* Companion disconnected (browser closed) and stale Buckler data: aged locally. */
await sql`update companion_device set last_seen_at = now() - interval '20 minutes' where user_id = ${userId}`;
await sql`update companion_snapshot set profile_observed_at = now() - interval '20 minutes', matches_observed_at = now() - interval '20 minutes' where user_id = ${userId}`;
await page.goto(`${APP}/dashboard`);
await shots(page, "05-prepare-companion-disconnected");
await sync({ profile: profile(1571), battlelogObserved: true }); // reconnects

/* LIVE */
await page.goto(`${APP}/dashboard`);
await startBtn().click();
await page.getByRole("button", { name: "Finalizar sesión" }).waitFor({ timeout: 20_000 });
await shots(page, "06-live-waiting-first-match");
let mr = BASE_MR;
for (const [i, [r, d]] of SESSION.entries()) {
  mr += d;
  if (i === 6) {
    // Battlelog first (rating pending, Phase 5.5 hold), screenshot, then the profile.
    await sync({ matches: [match(r)], battlelogObserved: true });
    await page.waitForTimeout(1500);
    await shots(page, "07-live-rating-pending", ["desktop"]);
    await sync({ profile: profile(mr), battlelogObserved: false });
    continue;
  }
  await sync({ matches: [match(r)], profile: profile(mr), battlelogObserved: true });
}
await page.waitForTimeout(1500);
await shots(page, "08-live-session");

/* Keyboard: first focus stops on the dashboard. */
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => window.scrollTo(0, 0));
const focusOrder: string[] = [];
for (let i = 0; i < 14; i++) {
  await page.keyboard.press("Tab");
  focusOrder.push(
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "(none)";
      const label = el.getAttribute("aria-label") ?? el.textContent ?? "";
      return `${el.tagName.toLowerCase()} · ${label.trim().replace(/\s+/g, " ").slice(0, 50)}`;
    }),
  );
  if (i === 5) await page.screenshot({ path: `${OUT}/09-focus-ring--desktop-fold.png` });
}

/* Companion goes quiet mid-session. */
await sql`update companion_device set last_seen_at = now() - interval '6 minutes' where user_id = ${userId}`;
await sql`update companion_snapshot set matches_observed_at = now() - interval '6 minutes' where user_id = ${userId}`;
await page.goto(`${APP}/dashboard`);
await shots(page, "10-live-companion-quiet", ["desktop", "mobile"]);
await sync({ profile: profile(mr), battlelogObserved: true });

/* English */
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: APP }]);
await sql`update auth_user set locale = 'en' where id = ${userId}`;
await page.goto(`${APP}/dashboard`);
await shots(page, "11-live-session-en", ["desktop", "mobile"]);
await sql`update auth_user set locale = 'es' where id = ${userId}`;
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "es", url: APP }]);

/* Overlays: builder, analytics */
await page.goto(`${APP}/dashboard/overlays/${sessionOverlay}`);
await shots(page, "12-overlay-builder");
await page.goto(`${APP}/dashboard/analytics`);
await shots(page, "13-analytics", ["desktop", "mobile"]);

/* RECAP */
await page.goto(`${APP}/dashboard`);
await endFlow();
await page.waitForTimeout(800);
await shots(page, "14-recap-just-ended");
await page.goto(`${APP}/dashboard`);
await shots(page, "15-dashboard-after-recap", ["desktop", "mobile"]);

/* Error state */
await page.goto(`${APP}/dashboard/sessions/${randomUUID()}`);
await shots(page, "16-session-not-found", ["desktop"]);

writeFileSync(
  `${OUT}/notes.json`,
  JSON.stringify({ capturedAt: new Date().toISOString(), overflow: notes, focusOrder }, null, 2),
);
await browser.close();
await sql`delete from auth_user where id = ${userId}`;
log("demo account removed");
await sql.end();
await closeDb();
