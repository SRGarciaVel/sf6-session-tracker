/** Test helpers: load the sanitized HAR fixtures (deep-cloned so tests can mutate them). */
import { readFileSync } from "node:fs";
import { DEFAULT_FIXTURE_DIR, FIXTURE_CFN_ID } from "./fixture-fetch";

export const CFN = FIXTURE_CFN_ID;

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${DEFAULT_FIXTURE_DIR}/${name}`, "utf8")) as unknown;
}

export const cardFixture = () => loadFixture(`card-${CFN}.json`);
export const playFixture = () => loadFixture(`play-${CFN}.json`);
export const battlelogFixture = (page: 1 | 2) => loadFixture(`battlelog-${CFN}-page-${page}.json`);

/** Raw replay objects of a battlelog fixture page. */
export function replaysOf(page: 1 | 2): Record<string, unknown>[] {
  const data = battlelogFixture(page) as { pageProps: { replay_list: Record<string, unknown>[] } };
  return data.pageProps.replay_list;
}
