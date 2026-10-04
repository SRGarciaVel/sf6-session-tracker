/** Test helpers: load the sanitized HAR fixtures (deep-cloned so tests can mutate them). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Sanitized HAR fixtures shared with the server provider tests (test-only: uses node:fs). */
export const FIXTURE_DIR = fileURLToPath(
  new URL("../../../tests/fixtures/capcom", import.meta.url),
);
const FIXTURE_CFN_ID = "1733837998";

export const CFN = FIXTURE_CFN_ID;

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${FIXTURE_DIR}/${name}`, "utf8")) as unknown;
}

export const cardFixture = () => loadFixture(`card-${CFN}.json`);
export const playFixture = () => loadFixture(`play-${CFN}.json`);
export const battlelogFixture = (page: 1 | 2) => loadFixture(`battlelog-${CFN}-page-${page}.json`);

/** Raw replay objects of a battlelog fixture page. */
export function replaysOf(page: 1 | 2): Record<string, unknown>[] {
  const data = battlelogFixture(page) as { pageProps: { replay_list: Record<string, unknown>[] } };
  return data.pageProps.replay_list;
}
