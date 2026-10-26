/**
 * M2C — Analytics PDF export feedback against a LOCAL production build and a LOCAL database
 * (refuses anything else). One fictitious `@test.local` account gets 120 Ranked matches through
 * the real Companion sync (the "matchup exposure" report scenario), so the export is offered.
 *
 * The 429 (per-account quota: 5 / 10 min) and 503 (process admission: 6 / min) are the REAL
 * server refusals, reached by exporting repeatedly on this local server; the limits are not
 * touched. Network failure, an HTML page served with 200 and a slow response are simulated with
 * page.route (they cannot be produced on demand otherwise).
 *
 *   E2E_STATE=/tmp/pdf.json pnpm exec tsx design/phase-m2/e2e/pdf-export.e2e.mts setup
 *   E2E_STATE=/tmp/pdf.json pnpm exec tsx design/phase-m2/e2e/pdf-export.e2e.mts run <before|after>
 *   E2E_STATE=/tmp/pdf.json pnpm exec tsx design/phase-m2/e2e/pdf-export.e2e.mts cleanup
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import postgres from "postgres";
import * as core from "../../../packages/sf6-capcom-core/src/index";

process.loadEnvFile(".env");
const APP = "http://localhost:3171";
const PHASE = process.argv[2] ?? "";
const LABEL = process.argv[3] ?? "after";
const AFTER = LABEL === "after";
const OUT = `design/phase-m2/screenshots/full/m2c-${LABEL}`;
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
}

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
let base = 0; // set right after the session starts: matches fall inside it, never in the future
const match = (result: "win" | "loss", opp: "jp" | "ken") =>
  core.toWireMatch({
    externalMatchId: `PDF-${base}-${++seq}`,
    playedAt: new Date(base + seq * 50),
    mode: "ranked",
    result,
    characterKey: "ryu",
    characterName: "Ryu",
    opponent: {
      name: `Rival ${seq % 17}`,
      characterKey: opp,
      characterName: opp === "jp" ? "JP" : "Ken",
    },
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
  const email = `pdf-${randomUUID().slice(0, 6)}@test.local`;
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
  const cfn = "9990000830";
  await sync({ cfn, deviceToken }, { profile: profile(cfn) });
  await page.fill("#cfn", cfn);
  await page.getByRole("button", { name: "Buscar jugador" }).click();
  await page.getByText("Jugador encontrado").waitFor();
  await page.getByRole("button", { name: /Soy yo/ }).click();
  await page.waitForURL(/dashboard/);
  await page.getByRole("button", { name: "Iniciar sesión de juego" }).first().click();
  await page.getByRole("button", { name: "Finalizar sesión" }).first().waitFor({ timeout: 30_000 });
  base = Date.now() + 1_000;
  await new Promise((r) => setTimeout(r, 8_000));
  // Report scenario "matchup exposure": vs JP 12–22, vs Ken 47–39.
  const all = [
    ...Array.from({ length: 12 }, () => match("win", "jp")),
    ...Array.from({ length: 22 }, () => match("loss", "jp")),
    ...Array.from({ length: 47 }, () => match("win", "ken")),
    ...Array.from({ length: 39 }, () => match("loss", "ken")),
  ];
  for (let i = 0; i < all.length; i += 60)
    await sync({ cfn, deviceToken }, { matches: all.slice(i, i + 60) });
  await new Promise((r) => setTimeout(r, 2_000));
  await page.getByRole("button", { name: "Finalizar sesión" }).first().click();
  await page.getByRole("button", { name: "Sí, finalizar sesión" }).first().click();
  await page.waitForURL(/ended=1/, { timeout: 30_000 });
  const storage = `${STATE}.storage.json`;
  await ctx.storageState({ path: storage });
  writeFileSync(STATE, JSON.stringify({ id, cfn, deviceToken, storage } satisfies Saved));
  await browser.close();
  await closeDb();
  console.log("setup done");
}

const results: Array<{ check: string; pass: boolean; detail?: string }> = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ check: name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function scrub(p: Page) {
  await p.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode())
      if (n.textContent?.includes("@test.local")) n.textContent = "demo@sst";
  });
}
async function shot(p: Page, name: string) {
  await scrub(p);
  const area = p.locator('[data-testid="review-export"]');
  await area.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}
const errorText = (p: Page) => p.locator('[data-testid="review-pdf-error"]').textContent();
const statusText = (p: Page) => p.locator('[data-testid="review-copy-status"]').textContent();

async function run() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: s.storage,
    locale: "es-ES",
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const p = await ctx.newPage();
  const pdfStatuses: number[] = [];
  p.on("response", (r) => {
    if (r.url().includes("/review.pdf")) pdfStatuses.push(r.status());
  });
  await p.goto(`${APP}/dashboard/analytics?range=all&mode=ranked`);
  const link = p.locator('[data-testid="review-pdf"]');
  await link.waitFor({ timeout: 60_000 });
  await link.scrollIntoViewIfNeeded();
  await p.waitForTimeout(500);

  if (!AFTER) {
    // main: a plain download link. Exhaust the quota, then show what a refusal looks like.
    const outcomes: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dl = p.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
      await link.click();
      const d = await dl;
      outcomes.push(
        d
          ? `${d.suggestedFilename()} failure=${(await d.failure()) ?? "none"}`
          : "no download event",
      );
      await p.waitForTimeout(400);
    }
    await shot(p, "01-after-refusal-no-feedback");
    writeFileSync(
      `${OUT}/before.json`,
      JSON.stringify(
        {
          statuses: pdfStatuses,
          outcomes,
          pageMessage: await p.locator('[data-testid="review-export"]').textContent(),
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ statuses: pdfStatuses, outcomes }, null, 2));
    await browser.close();
    return;
  }

  // 1. pending state + duplicate clicks (slowed by 1.5 s through a route, real response after)
  let routed = 0;
  await p.route("**/review.pdf*", async (route) => {
    routed++;
    await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  const dl1 = p.waitForEvent("download", { timeout: 60_000 });
  await link.click();
  await p.waitForTimeout(200);
  const pendingText = await link.textContent();
  const busy = await link.getAttribute("aria-busy");
  await shot(p, "02-pending");
  await link.click({ force: true });
  await link.click({ force: true });
  const d1 = await dl1;
  await p.unroute("**/review.pdf*");
  const file = await d1.path();
  const head = file ? readFileSync(file).subarray(0, 5).toString() : "";
  check(
    "pending: visible «Generando PDF…» + aria-busy",
    pendingText?.includes("Generando PDF…") === true && busy === "true",
  );
  check("duplicate clicks while pending send one request", routed === 1, `requests: ${routed}`);
  check(
    "success: real PDF saved under the server filename",
    /^sst-review-.*\.pdf$/.test(d1.suggestedFilename()) && head === "%PDF-",
    d1.suggestedFilename(),
  );
  await p.waitForTimeout(300);
  check(
    "success announced, loading cleared",
    (await statusText(p))?.startsWith("PDF descargado") === true &&
      (await link.textContent())?.includes("Descargar PDF") === true,
  );
  await shot(p, "03-success");

  // 2. keyboard: Tab-focus + Enter starts the export (real request)
  await link.focus();
  const dl2 = p.waitForEvent("download", { timeout: 60_000 });
  await p.keyboard.press("Enter");
  await dl2;
  check("keyboard: Enter on the focused control exports", true);
  await p.waitForTimeout(300);
  check("focus stays on the control", await link.evaluate((el) => el === document.activeElement));

  // 3. real quota → 429 (5 per 10 min per account); then real admission → 503
  let saw429 = false;
  let saw503 = false;
  for (let i = 0; i < 6 && !(saw429 && saw503); i++) {
    const response = p.waitForResponse((r) => r.url().includes("/review.pdf"), {
      timeout: 60_000,
    });
    await link.click();
    await response;
    await p.waitForFunction(
      () =>
        document.querySelector('[data-testid="review-pdf"]')?.getAttribute("aria-busy") !== "true",
      null,
      { timeout: 60_000 },
    );
    const status = pdfStatuses.at(-1);
    const err = (await errorText(p)) ?? "";
    if (status === 429 && !saw429) {
      saw429 = true;
      check(
        "real 429 → localized message naming both causes, with the server's Retry-After",
        /^No se pudo iniciar el PDF: puede que ya se esté generando otro informe tuyo o que hayas alcanzado el límite de informes\. Vuelve a intentarlo en \d+ (minutos?|segundos?)\.$/.test(
          err,
        ),
        err,
      );
      await shot(p, "04-429");
    }
    if (status === 503 && !saw503) {
      saw503 = true;
      check(
        "real 503 → capacity message",
        err ===
          "Ahora mismo se están generando otros informes. Vuelve a intentarlo en unos segundos.",
        err,
      );
      await shot(p, "05-503");
    }
  }
  check("both real refusals were reached", saw429 && saw503, `statuses: ${pdfStatuses.join(",")}`);
  check(
    "error is an alert linked to the control",
    (await p.locator('[data-testid="review-pdf-error"]').getAttribute("role")) === "alert" &&
      (await link.getAttribute("aria-describedby")) === "review-pdf-error",
  );

  // 4. simulated: network failure, HTML with 200
  await p.route("**/review.pdf*", (route) => route.abort("internetdisconnected"));
  await link.click();
  await p.waitForFunction(
    () =>
      document.querySelector('[data-testid="review-pdf"]')?.getAttribute("aria-busy") !== "true",
  );
  check(
    "network failure → retry message, loading cleared",
    (await errorText(p)) ===
      "SST no pudo completar la solicitud. Comprueba tu conexión y vuelve a intentarlo." &&
      (await link.textContent())?.includes("Descargar PDF") === true,
  );
  await shot(p, "06-network");
  await p.unroute("**/review.pdf*");
  await p.route("**/review.pdf*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>Sign in</body></html>",
    }),
  );
  let unexpectedDownload = false;
  const onDl = () => (unexpectedDownload = true);
  p.on("download", onDl);
  await link.click();
  await p.waitForTimeout(1_000);
  p.off("download", onDl);
  check(
    "HTML served with 200 → nothing saved, invalid-PDF message",
    !unexpectedDownload &&
      (await errorText(p))?.startsWith("La respuesta no era un PDF válido") === true,
  );
  await p.unroute("**/review.pdf*");

  // 5. mobile 390 + 200 % text with the error visible
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await p.waitForTimeout(300);
  const fit = await p.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const area = document.querySelector('[data-testid="review-export"]')!;
    const parts = [area, ...Array.from(area.querySelectorAll("*"))].filter(
      (el) => el.getBoundingClientRect().width > 0,
    );
    return {
      exportOverflow: Math.max(...parts.map((el) => el.getBoundingClientRect().right)) - vw,
      // Pre-existing (documented in M2A as deferred): the analytics filter form at 200 % text.
      pageOverflow: document.documentElement.scrollWidth - vw,
    };
  });
  check(
    "390 px at 200 % text: the export area (control + error) fits the viewport",
    fit.exportOverflow <= 0,
    `export ${Math.round(fit.exportOverflow)} px · page ${fit.pageOverflow} px (pre-existing filter form)`,
  );
  await shot(p, "07-mobile-text200");

  // 6. English (account preference; test account only, restored)
  await sql`update auth_user set locale = 'en' where id = ${s.id} and email like '%@test.local'`;
  try {
    const ep = await ctx.newPage();
    ep.on("response", (r) => {
      if (r.url().includes("/review.pdf")) pdfStatuses.push(r.status());
    });
    await ep.goto(`${APP}/dashboard/analytics?range=all&mode=ranked`);
    const el = ep.locator('[data-testid="review-pdf"]');
    await el.waitFor();
    await el.click();
    await ep.waitForFunction(
      () =>
        document.querySelector('[data-testid="review-pdf"]')?.getAttribute("aria-busy") !== "true",
      null,
      { timeout: 60_000 },
    );
    const err = (await ep.locator('[data-testid="review-pdf-error"]').textContent()) ?? "";
    check(
      "English refusal message",
      /^(The PDF could not be started: another of your reports may still be generating, or you may have reached the report limit\.|Other reports are being generated)/.test(
        err,
      ),
      err,
    );
    await ep.locator('[data-testid="review-export"]').screenshot({ path: `${OUT}/08-en.png` });
  } finally {
    await sql`update auth_user set locale = 'es' where id = ${s.id} and email like '%@test.local'`;
  }
  writeFileSync(
    `${OUT}/checks.json`,
    JSON.stringify({ ranAt: new Date().toISOString(), statuses: pdfStatuses, results }, null, 2),
  );
  await browser.close();
}

async function cleanup() {
  const s = JSON.parse(readFileSync(STATE, "utf8")) as Saved;
  const deleted =
    await sql`delete from auth_user where id = ${s.id} and email like '%@test.local' returning id`;
  console.log(`deleted ${deleted.length} test accounts`);
}

if (PHASE === "setup") await setup();
else if (PHASE === "run") await run();
else if (PHASE === "cleanup") await cleanup();
else throw new Error("phase: setup | run <label> | cleanup");
await sql.end();
if (results.some((r) => !r.pass)) process.exitCode = 1;
