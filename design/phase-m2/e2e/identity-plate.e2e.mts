/**
 * M2D — character identity plate in the REAL renderers, against a LOCAL production build and a
 * LOCAL database (refuses anything else). One fictitious `@test.local` account (Creator Beta
 * granted locally so the three Creator themes render), data through the real Companion sync.
 *
 *   setup   account, pairing, onboarding (first overlay), local Creator grant, session + match
 *   matrix  every theme × every supported canvas × plate on/off, on the public OBS page:
 *           plate present/absent, fit scale on vs off (≥ 0.85 target), no overflow, screenshots
 *   live    OBS page open: save Off / Automatic in the real builder, then a real match with
 *           another character — the OBS page updates without a reload
 *
 *   E2E_STATE=/tmp/ip.json pnpm exec tsx design/phase-m2/e2e/identity-plate.e2e.mts <setup|matrix|live|cleanup>
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const OUT = "design/phase-m2/screenshots/full/m2d";
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
  storage: string;
  overlayId: string;
  token: string;
}

const CANVASES = {
  minimal: ["compact", "standard", "detailed"],
  competitive: ["compact", "standard", "detailed"],
  fighter: ["compact", "standard", "detailed"],
  "rank-card": ["standard", "detailed"],
  broadcast: ["compact", "standard", "detailed"],
  prestige: ["standard", "detailed"],
} as const;
const SIZE = {
  compact: [600, 120],
  standard: [800, 180],
  detailed: [900, 240],
} as const;

function profile(cfn: string) {
  const raw = JSON.parse(readFileSync("tests/fixtures/capcom/play-1733837998.json", "utf8"));
  const n = core.normalizeCapcomProfile(core.parseCapcomPlayPayload(raw), {
    cfnUserId: "1733837998",
  }).profile;
  return core.toWireProfile({
    ...n,
    cfnUserId: cfn,
    displayName: "Tester",
    favoriteCharacterKey: "ryu",
  });
}
let seq = 0;
const match = (characterKey: string, characterName: string, result: "win" | "loss") =>
  core.toWireMatch({
    externalMatchId: `IP-${Date.now()}-${++seq}`,
    playedAt: new Date(Date.now() - 1_000 + seq),
    mode: "ranked",
    result,
    characterKey,
    characterName,
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

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function setup() {
  const browser = await chromium.launch();
  const { createPairingCode } = await import("../../../src/server/companion/service");
  const { getDb, closeDb } = await import("../../../src/server/db/client");
  const ctx = await browser.newContext({ locale: "es-ES" });
  const page = await ctx.newPage();
  const email = `ip-${randomUUID().slice(0, 6)}@test.local`;
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
  const cfn = "9990000840";
  await sync({ cfn, deviceToken }, { profile: profile(cfn) });
  await page.fill("#cfn", cfn);
  await page.getByRole("button", { name: "Buscar jugador" }).click();
  await page.getByText("Jugador encontrado").waitFor();
  await page.getByRole("button", { name: /Soy yo/ }).click();
  await page.waitForURL(/dashboard/);
  // Local test account only: Creator Beta so the three Creator themes are effective.
  await sql`insert into entitlement_grant (user_id, plan, source, expires_at)
    values (${id}, 'creator_beta', 'operator', now() + interval '1 day')`;
  await page.reload();
  await page.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
  await page.getByRole("button", { name: "Finalizar sesión" }).first().waitFor({ timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1_500));
  await sync({ cfn, deviceToken }, { matches: [match("ryu", "Ryu", "win")] });
  const o = (
    await sql<{ id: string; public_token: string }[]>`select o.id, o.public_token from overlay o
      join sf6_player p on p.id = o.player_id where p.user_id = ${id} order by o.created_at limit 1`
  )[0]!;
  const storage = `${STATE}.storage.json`;
  await ctx.storageState({ path: storage });
  writeFileSync(
    STATE,
    JSON.stringify({
      id,
      cfn,
      deviceToken,
      storage,
      overlayId: o.id,
      token: o.public_token,
    } satisfies Saved),
  );
  await browser.close();
  await closeDb();
  console.log("setup done");
}

async function setConfig(s: Saved, patch: Record<string, unknown>) {
  const raw = (
    await sql<
      { config: Record<string, unknown> }[]
    >`select config from overlay where id = ${s.overlayId}`
  )[0]!.config;
  const next = { ...raw, ...patch };
  await sql`update overlay set config = ${sql.json(next as never)} where id = ${s.overlayId}`;
}

async function matrix() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const raw = (
    await sql<
      { config: Record<string, unknown> }[]
    >`select config from overlay where id = ${s.overlayId}`
  )[0]!.config;
  check(
    "onboarding overlay stored with identityPlate auto",
    raw.identityPlate === "auto",
    String(raw.identityPlate),
  );
  const allFields = Object.fromEntries(Object.keys(raw.fields as object).map((k) => [k, true]));
  const browser = await chromium.launch();
  const rows: Array<Record<string, unknown>> = [];
  for (const [theme, canvases] of Object.entries(CANVASES)) {
    for (const canvas of canvases) {
      const [w, h] = SIZE[canvas];
      const measured: Record<
        string,
        {
          font: number;
          overflowX: number;
          overflowY: number;
          plate: number;
          plateBox: number[] | null;
          text: string;
        }
      > = {};
      for (const plate of ["off", "auto"] as const) {
        await setConfig(s, {
          theme,
          preset: canvas,
          identityPlate: plate,
          fields: allFields,
          showTitle: true,
        });
        const ctx = await browser.newContext({ viewport: { width: w, height: h } });
        const p = await ctx.newPage();
        await p.goto(`${APP}/overlay/${s.token}`);
        await p.locator(".sf6-overlay").waitFor();
        await p.evaluate(() => document.fonts.ready);
        await p.waitForTimeout(700);
        measured[plate] = await p.evaluate(() => {
          const root = document.querySelector<HTMLElement>(".sf6-overlay")!;
          const panel = root.firstElementChild as HTMLElement;
          const ip = root.querySelector<HTMLElement>(".ov-ip");
          const b = ip?.getBoundingClientRect();
          const clone = root.cloneNode(true) as HTMLElement;
          clone.querySelectorAll(".ov-ip").forEach((n) => n.remove());
          return {
            font: parseFloat(getComputedStyle(root).fontSize),
            overflowX: panel.scrollWidth - root.clientWidth,
            overflowY: panel.scrollHeight - root.clientHeight,
            plate: root.querySelectorAll(".ov-ip").length,
            plateBox: b
              ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]
              : null,
            text: clone.textContent ?? "",
          };
        });
        await p.screenshot({
          path: `${OUT}/${theme}--${canvas}--${plate}.png`,
          omitBackground: true,
        });
        await ctx.close();
      }
      const ratio = measured.auto!.font / measured.off!.font;
      rows.push({
        theme,
        canvas,
        ratio: Number(ratio.toFixed(3)),
        on: measured.auto,
        off: { font: measured.off!.font },
      });
      check(
        `${theme} ${canvas}: plate on (1) / off (0)`,
        measured.auto!.plate === 1 && measured.off!.plate === 0,
      );
      check(
        `${theme} ${canvas}: metrics text identical on/off`,
        measured.auto!.text === measured.off!.text,
      );
      check(
        `${theme} ${canvas}: no overflow with the plate`,
        measured.auto!.overflowX <= 1 && measured.auto!.overflowY <= 1,
        `x ${measured.auto!.overflowX} y ${measured.auto!.overflowY}`,
      );
      check(`${theme} ${canvas}: content scale on/off ≥ 0.85`, ratio >= 0.85, ratio.toFixed(3));
    }
  }
  writeFileSync(`${OUT}/matrix.json`, JSON.stringify(rows, null, 2));
  await setConfig(s, { theme: "broadcast", preset: "standard", identityPlate: "auto" });
  await browser.close();
}

async function live() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const obsCtx = await browser.newContext({ viewport: { width: 800, height: 180 } });
  const obs = await obsCtx.newPage();
  await obs.goto(`${APP}/overlay/${s.token}`);
  await obs.locator(".ov-ip").waitFor();
  await obs.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  const plateText = () => obs.locator(".ov-ip").first().textContent();
  check("OBS: plate shows the active character (RYU)", (await plateText()) === "RYU");

  // The real builder: switch the plate Off and save (owner-authorized server action).
  const bctx = await browser.newContext({
    storageState: s.storage,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
  });
  const b = await bctx.newPage();
  await b.goto(`${APP}/dashboard/overlays/${s.overlayId}`);
  await b.locator('[data-testid="editor"]').waitFor({ timeout: 60_000 });
  const tab = b.getByRole("tab", { name: /Contenido/ });
  if (await tab.count()) await tab.first().click();
  const group = b.locator('[data-testid="identity-plate"]');
  await group.waitFor();
  await group.scrollIntoViewIfNeeded();
  await group.screenshot({ path: `${OUT}/builder-control.png` });
  await group.getByRole("radio", { name: "Desactivada" }).click();
  await b.locator('[data-testid="save-button"]').click();
  await b.locator('[data-testid="save-state"][data-state="saved"]').waitFor({ timeout: 30_000 });
  await obs.waitForFunction(() => document.querySelectorAll(".ov-ip").length === 0, null, {
    timeout: 30_000,
  });
  check(
    "builder Off → OBS drops the plate without a reload",
    await obs.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true),
  );
  await group.getByRole("radio", { name: "Automática" }).click();
  await b.locator('[data-testid="save-button"]').click();
  await b.locator('[data-testid="save-state"][data-state="saved"]').waitFor({ timeout: 30_000 });
  await obs.locator(".ov-ip").waitFor({ timeout: 30_000 });
  check("builder Automatic → OBS shows it again without a reload", (await plateText()) === "RYU");

  // A real match with another character (Companion sync → ingestion → SSE).
  await sync(s, { matches: [match("jamie", "Jamie", "win")] });
  await obs.waitForFunction(() => document.querySelector(".ov-ip")?.textContent === "JAM", null, {
    timeout: 30_000,
  });
  const name = await obs.locator(".ov-char").first().textContent();
  check(
    "new match with Jamie → plate JAM, same as the name, no reload",
    (name ?? "").includes("Jamie") &&
      (await obs.evaluate(
        () => (window as unknown as { __noReload?: boolean }).__noReload === true,
      )),
  );
  check("still exactly one plate after the updates", (await obs.locator(".ov-ip").count()) === 1);
  await obs.screenshot({ path: `${OUT}/live-jamie.png`, omitBackground: true });

  // Pinned rating character wins (existing rule): pin Ryu while Jamie is active.
  await setConfig(s, { ratingCharacterKey: "ryu" });
  const pinned = await browser.newPage({ viewport: { width: 800, height: 180 } });
  await pinned.goto(`${APP}/overlay/${s.token}`);
  await pinned.locator(".ov-ip").waitFor();
  check(
    "pinned Ryu while Jamie is active → plate RYU",
    (await pinned.locator(".ov-ip").textContent()) === "RYU",
  );
  await setConfig(s, { ratingCharacterKey: null });
  writeFileSync(`${OUT}/checks-live.json`, JSON.stringify(results, null, 2));
  await browser.close();
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id = ${s.id} and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "matrix") await matrix();
else if (PHASE === "live") await live();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | matrix | live | cleanup");
if (PHASE === "matrix")
  writeFileSync(`${OUT}/checks-matrix.json`, JSON.stringify(results, null, 2));
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
