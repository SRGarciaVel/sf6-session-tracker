/**
 * Research: can Playwright drive a NORMAL Chromium with a persistent, HUMAN-authenticated profile
 * and load Buckler's Boot Camp without a CloudFront 403?  (isolated — not used by the app)
 *
 *   pnpm research:cfn-browser --login            visible browser; YOU log in by hand, then close
 *                                               the window (or press Enter in this terminal)
 *   pnpm research:cfn-browser --login-plain      same Chromium + same profile launched WITHOUT
 *                                               Playwright (no automation at all) for the human
 *                                               login; close the window when done
 *   pnpm research:cfn-browser --check            visible browser, same profile, no login
 *   pnpm research:cfn-browser --check-headless   identical, but headless
 *
 * Policy: no stealth, no navigator.webdriver changes, no custom UA/headers/flags, no proxies, no
 * credential filling, no Turnstile solving, no retries. Stops at the first 403/429/challenge.
 * Only a short summary is written (debug_output/browser/); never HTML, cookies or Set-Cookie.
 * Profile dir (outside the repo, never inspected): ~/.sf6-buckler-browser-profile
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const CFN = "1733837998";
const BASE = "https://www.streetfighter.com/6/buckler";
const PROFILE_URL = `${BASE}/profile/${CFN}`;
const PROFILE_DIR =
  process.env.SF6_BUCKLER_PROFILE_DIR ?? join(homedir(), ".sf6-buckler-browser-profile");
const OUT_DIR = join(process.cwd(), "debug_output", "browser");

type Mode = "login" | "login-plain" | "check" | "check-headless";

function parseMode(): Mode {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--"));
  if (arg === "--login") return "login";
  if (arg === "--login-plain") return "login-plain";
  if (arg === "--check") return "check";
  if (arg === "--check-headless") return "check-headless";
  console.error(
    "Usage: pnpm research:cfn-browser --login | --login-plain | --check | --check-headless",
  );
  process.exit(1);
}

/** Same launch for every mode except `headless` — the only variable under test. */
function launch(headless: boolean): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chromium", // full Chromium build in both headed and (new) headless mode
    headless,
  });
}

interface PageReport {
  status: number | null;
  finalUrl: string;
  title: string;
  server: string | null;
  xCache: string | null;
  has403: boolean;
  has429: boolean;
  challengeDetected: boolean;
  loginPageDetected: boolean;
  hasNextData: boolean;
  buildId: string | null;
  nextPage: string | null;
  cfnInStructuredData: boolean;
  /** fighter_banner_info.is_my_data — true only when the viewer is logged in as this CFN. */
  isMyData: boolean | null;
}

interface DataReport {
  path: string;
  status: number | null;
  contentType: string | null;
  json: boolean;
  sidMatches: boolean;
  items: number | null;
  error?: string;
}

async function inspectProfile(page: Page): Promise<PageReport> {
  const res = await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);
  const headers = res ? await res.allHeaders() : {};
  const facts = await page.evaluate((cfn) => {
    const text = (document.body?.innerText ?? "").slice(0, 20_000);
    const el = document.getElementById("__NEXT_DATA__");
    let buildId: string | null = null;
    let nextPage: string | null = null;
    let cfnFound = false;
    let isMyData: boolean | null = null;
    if (el?.textContent) {
      try {
        const nd = JSON.parse(el.textContent) as {
          buildId?: string;
          page?: string;
          props?: {
            pageProps?: {
              sid?: number;
              fighter_banner_info?: { is_my_data?: boolean; personal_info?: { short_id?: number } };
            };
          };
        };
        buildId = nd.buildId ?? null;
        nextPage = nd.page ?? null;
        const pp = nd.props?.pageProps;
        cfnFound =
          String(pp?.sid) === cfn ||
          String(pp?.fighter_banner_info?.personal_info?.short_id) === cfn;
        isMyData = pp?.fighter_banner_info?.is_my_data ?? null;
      } catch {
        // malformed — reported as hasNextData with no buildId
      }
    }
    return {
      hasNextData: Boolean(el),
      buildId,
      nextPage,
      cfnFound,
      isMyData,
      challenge:
        /verify you are human|security verification|checking your browser|just a moment|turnstile/i.test(
          text,
        ) || Boolean(document.querySelector('iframe[src*="challenges.cloudflare.com"]')),
      loginText: /must log in|log in to use|to use this service, you must log in/i.test(text),
      requestBlocked: /request blocked|the request could not be satisfied/i.test(text),
    };
  }, CFN);
  const status = res?.status() ?? null;
  const finalUrl = page.url();
  return {
    status,
    finalUrl,
    title: await page.title(),
    server: headers["server"] ?? null,
    xCache: headers["x-cache"] ?? null,
    has403: status === 403 || facts.requestBlocked,
    has429: status === 429,
    challengeDetected: facts.challenge,
    loginPageDetected:
      facts.loginText ||
      /\/auth\/login|cid\.capcom\.com|\/login/i.test(
        new URL(finalUrl).pathname + new URL(finalUrl).host,
      ),
    hasNextData: facts.hasNextData,
    buildId: facts.buildId,
    nextPage: facts.nextPage,
    cfnInStructuredData: facts.cfnFound,
    isMyData: facts.isMyData,
  };
}

/** Same-origin fetch from INSIDE the authenticated page: the browser's own cookies/headers. */
async function fetchNextData(
  page: Page,
  buildId: string,
  kind: "play" | "battlelog",
): Promise<DataReport> {
  const path = `/6/buckler/_next/data/${buildId}/en/profile/${CFN}/${kind}.json?sid=${CFN}`;
  return page.evaluate(
    async ({ path, cfn, kind }) => {
      try {
        const r = await fetch(path, { credentials: "same-origin" });
        const ct = r.headers.get("content-type");
        const text = await r.text();
        let json = false;
        let sidMatches = false;
        let items: number | null = null;
        try {
          const d = JSON.parse(text) as {
            pageProps?: {
              sid?: number;
              replay_list?: unknown[];
              play?: { character_league_infos?: unknown[] };
            };
          };
          json = true;
          sidMatches = String(d.pageProps?.sid) === cfn;
          items =
            kind === "play"
              ? (d.pageProps?.play?.character_league_infos?.length ?? null)
              : (d.pageProps?.replay_list?.length ?? null);
        } catch {
          json = false;
        }
        return { path, status: r.status, contentType: ct, json, sidMatches, items };
      } catch (e) {
        return {
          path,
          status: null,
          contentType: null,
          json: false,
          sidMatches: false,
          items: null,
          error: String(e),
        };
      }
    },
    { path, cfn: CFN, kind },
  );
}

function waitForUser(context: BrowserContext): Promise<void> {
  return new Promise((resolve) => {
    context.on("close", () => resolve());
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(
        "\nPress Enter here when you have finished logging in (or just close the window)… ",
        () => {
          rl.close();
          resolve();
        },
      );
    }
  });
}

function save(mode: Mode, report: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  return file;
}

function blocked(p: PageReport): string | null {
  if (p.has403) return "403";
  if (p.has429) return "429";
  if (p.challengeDetected) return "challenge";
  return null;
}

/**
 * Human login in the SAME Chromium binary and profile, but started as a plain process: no
 * Playwright, no CDP, no extra flags. Playwright-controlled Chromium loops on the Capcom ID
 * security verification (2026-10-04), so the human step must not run under automation.
 */
function loginPlain(): Promise<void> {
  const exe = chromium.executablePath();
  console.log(`Launching plain Chromium (${exe}) with profile ${PROFILE_DIR}`);
  console.log(
    "Log in YOURSELF, then close the window. Then run: pnpm research:cfn-browser --check",
  );
  return new Promise((resolve, reject) => {
    const child = spawn(exe, [`--user-data-dir=${PROFILE_DIR}`, `${BASE}/`], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", () => {
      console.log(
        "summary:",
        save("login-plain", { mode: "login-plain", exe, at: new Date().toISOString() }),
      );
      resolve();
    });
  });
}

async function main() {
  const mode = parseMode();
  if (mode === "login-plain") return loginPlain();
  const headless = mode === "check-headless";
  console.log(`mode=${mode} headless=${headless} profileDir=${PROFILE_DIR}`);
  const context = await launch(headless);
  const browserVersion = context.browser()?.version() ?? "chromium (persistent)";
  const page = context.pages()[0] ?? (await context.newPage());
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const report: Record<string, unknown> = {
    mode,
    headless,
    browserVersion,
    userAgent,
    at: new Date().toISOString(),
  };

  if (mode === "login") {
    await page
      .goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 })
      .catch(() => undefined);
    console.log("\nA Chromium window is open with the dedicated profile.");
    console.log(
      "Log in to Buckler's Boot Camp YOURSELF (this script fills nothing and solves nothing).",
    );
    await waitForUser(context);
    if (context.pages().length > 0) {
      const p = await inspectProfile(context.pages()[0]!);
      report.profile = p;
      console.log("\nprofile check:", JSON.stringify(p, null, 1));
      await context.close();
    } else {
      report.note = "window closed by the user; run --check to verify the saved session";
      console.log("\nWindow closed. Profile saved. Now run: pnpm research:cfn-browser --check");
    }
    console.log("summary:", save(mode, report));
    return;
  }

  const profile = await inspectProfile(page);
  report.profile = profile;
  console.log("profile:", JSON.stringify(profile, null, 1));
  const stop = blocked(profile);
  if (stop) {
    report.stoppedBecause = stop;
    console.log(`STOP: ${stop} — no retries, no further requests.`);
  } else if (profile.buildId) {
    const play = await fetchNextData(page, profile.buildId, "play");
    console.log("play.json:", JSON.stringify(play));
    report.play = play;
    if (play.status === 403 || play.status === 429) {
      report.stoppedBecause = `play.json ${play.status}`;
    } else {
      const battlelog = await fetchNextData(page, profile.buildId, "battlelog");
      console.log("battlelog.json:", JSON.stringify(battlelog));
      report.battlelog = battlelog;
    }
  }
  await context.close();
  console.log("summary:", save(mode, report));
}

main().catch((err: unknown) => {
  console.error("research:cfn-browser failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
