import { expect, test, type Page } from "@playwright/test";

/**
 * Multi-character session, end to end (mock CFN + real worker + SSE + OBS overlay):
 * A.K.I. (LP) win → switch to Kimberly (MR) win → global W/L sums, ratings stay separate,
 * the overlay follows the active character, and an overlay refresh keeps the state.
 */

const DEMO = { email: "demo@sf6.local", password: "demo-password-123" };

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", DEMO.email);
  await page.fill("#password", DEMO.password);
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard");
}

const scoreWins = (page: Page) => page.getByTestId("score-wins");
const characterDelta = (page: Page, key: string) =>
  page.locator(`[data-character-row="${key}"] [data-delta]`);

test("A.K.I. then Kimberly: global W/L, separate ratings, overlay follows the active character", async ({
  page,
  context,
}) => {
  await login(page);
  // Deterministic UI language for text assertions.
  await page.click("button[role=radio][lang=en]");
  await expect(page.getByText("Current session", { exact: false })).toBeVisible();

  // Mock CFN plays A.K.I. first.
  await page.click("button[data-character=aki]");
  await expect(page.getByText("Now playing A.K.I.")).toBeVisible();

  await page.getByRole("button", { name: /start (new )?session/i }).click();
  await expect(page.locator("header .live-dot")).toBeVisible();
  await expect(scoreWins(page)).toHaveText("0");

  // 1. A.K.I. ranked win.
  await page.click("button[data-tool=win]");
  await expect(scoreWins(page)).toHaveText("1", { timeout: 20_000 });
  await expect(page.getByTestId("active-character")).toHaveText("A.K.I.");
  await expect(characterDelta(page, "aki")).toHaveText(/^\+[\d,]+ LP$/);
  const akiDelta = (await characterDelta(page, "aki").textContent())?.trim();

  // 2. Switch to Kimberly, ranked win.
  await page.click("button[data-character=kimberly]");
  await expect(page.getByText("Now playing Kimberly")).toBeVisible();
  await page.click("button[data-tool=win]");
  await expect(scoreWins(page)).toHaveText("2", { timeout: 20_000 });
  await expect(page.getByTestId("active-character")).toHaveText("Kimberly");
  await expect(characterDelta(page, "kimberly")).toHaveText(/^\+\d+ MR$/);
  // A.K.I. keeps its own LP progress, untouched by Kimberly's match.
  await expect(characterDelta(page, "aki")).toHaveText(akiDelta ?? "");

  // 3. OBS overlay: global W/L + Kimberly as the rating character.
  const url = await page.getByLabel("OBS Browser Source URL").first().inputValue();
  const obs = await context.newPage();
  await obs.setViewportSize({ width: 800, height: 180 });
  await obs.goto(url);
  const overlay = obs.locator(".sf6-overlay");
  await expect(obs.locator(".ov-win").first()).toHaveText("2");
  await expect(overlay).toContainText(/Kimberly/i);
  await expect(overlay).toContainText("MR");

  // 4. Refresh: state intact (server-rendered, never 0-0).
  await obs.reload();
  await expect(obs.locator(".ov-win").first()).toHaveText("2");
  await expect(overlay).toContainText(/Kimberly/i);
});
