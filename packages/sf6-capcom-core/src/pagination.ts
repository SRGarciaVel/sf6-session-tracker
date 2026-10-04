/**
 * Battlelog pagination (pure apart from the injected page fetcher).
 *
 * Observed: `current_page`, `total_page` (10 in the HAR) and 10 replays per page, newest first;
 * page 1 has no `page` param, page N uses `?page=N&sid=…`.
 */
import type { CapcomBattlelogPage } from "./parse";

export const DEFAULT_MAX_BATTLELOG_PAGES_PER_POLL = 3;

export interface MatchesSinceResult {
  /** Raw replays not in `knownReplayIds`, newest first, de-duplicated by replay_id. */
  replays: unknown[];
  pagesFetched: number;
  totalPage: number | null;
  /** A known replay_id was found ⇒ everything newer has been collected. */
  reachedKnown: boolean;
  /**
   * true when there were known ids but none was found: matches between the last poll and the
   * oldest fetched page may be missing. Never hidden.
   */
  gapSuspected: boolean;
  gapReason: "page_limit" | "history_exhausted" | null;
  warnings: string[];
}

function replayIdOf(raw: unknown): string | null {
  return raw && typeof raw === "object" && "replay_id" in raw && typeof raw.replay_id === "string"
    ? raw.replay_id
    : null;
}

export async function collectMatchesSince(
  fetchPage: (page: number) => Promise<CapcomBattlelogPage>,
  knownReplayIds: ReadonlySet<string>,
  maxPages: number = DEFAULT_MAX_BATTLELOG_PAGES_PER_POLL,
): Promise<MatchesSinceResult> {
  const limit = Math.max(1, Math.floor(maxPages));
  const replays: unknown[] = [];
  const collected = new Set<string>();
  const warnings: string[] = [];
  let totalPage: number | null = null;
  let pagesFetched = 0;
  let reachedKnown = false;
  let stoppedByLimit = false;

  for (let page = 1; ; page++) {
    if (totalPage !== null && page > totalPage) break;
    if (page > limit) {
      stoppedByLimit = true;
      break;
    }
    const data = await fetchPage(page);
    pagesFetched++;

    if (data.currentPage !== page) {
      warnings.push(`asked for page ${page} but Capcom answered current_page ${data.currentPage}`);
    }
    if (data.totalPage < 0 || (data.totalPage === 0 && data.replays.length > 0)) {
      warnings.push(`incoherent total_page ${data.totalPage} with ${data.replays.length} replays`);
    }
    if (totalPage !== null && data.totalPage !== totalPage) {
      warnings.push(`total_page changed during the poll (${totalPage} → ${data.totalPage})`);
    }
    totalPage = Math.max(data.totalPage, page);

    for (const raw of data.replays) {
      const id = replayIdOf(raw);
      if (id !== null && knownReplayIds.has(id)) {
        // Newest first: everything after the first known replay is older than it.
        reachedKnown = true;
        break;
      }
      if (id !== null && collected.has(id)) continue; // shifted across pages mid-poll
      if (id !== null) collected.add(id);
      replays.push(raw);
    }
    if (reachedKnown) break;
    if (data.replays.length === 0) {
      if (page < data.totalPage) {
        warnings.push(`page ${page} is empty but total_page is ${data.totalPage} — stopping`);
      }
      break;
    }
  }

  const gapSuspected = knownReplayIds.size > 0 && !reachedKnown;
  return {
    replays,
    pagesFetched,
    totalPage,
    reachedKnown,
    gapSuspected,
    gapReason: gapSuspected ? (stoppedByLimit ? "page_limit" : "history_exhausted") : null,
    warnings,
  };
}
