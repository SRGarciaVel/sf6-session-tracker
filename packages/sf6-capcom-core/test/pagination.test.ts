import { describe, expect, it } from "vitest";
import { collectMatchesSince } from "../src/pagination";
import { parseCapcomBattlelogPayload, type CapcomBattlelogPage } from "../src/parse";
import { battlelogFixture, replaysOf } from "./fixtures";

const realPage = (n: 1 | 2) => parseCapcomBattlelogPayload(battlelogFixture(n));
const ids = (replays: unknown[]) => replays.map((r) => (r as { replay_id: string }).replay_id);

/** Fetcher over the 2 real pages (total_page says 10; pages 3+ are synthesized empty-of-overlap). */
function fetcher(pages: Record<number, CapcomBattlelogPage>) {
  const calls: number[] = [];
  const fetchPage = async (page: number) => {
    calls.push(page);
    const p = pages[page];
    if (!p) throw new Error(`unexpected page ${page}`);
    return p;
  };
  return { fetchPage, calls };
}

describe("battlelog pagination (getMatchesSince strategy)", () => {
  it("23. page 1 envelope from the real fixture", () => {
    const p = realPage(1);
    expect(p).toMatchObject({ cfnUserId: "1733837998", currentPage: 1, totalPage: 10 });
    expect(p.replays).toHaveLength(10);
  });

  it("24. page 2 continues where page 1 ends (no overlap, older replays)", () => {
    const p1 = ids(realPage(1).replays);
    const p2 = ids(realPage(2).replays);
    expect(realPage(2).currentPage).toBe(2);
    expect(p2.filter((id) => p1.includes(id))).toEqual([]);
    const lastP1 = replaysOf(1).at(-1)!.uploaded_at as number;
    const firstP2 = replaysOf(2)[0]!.uploaded_at as number;
    expect(firstP2).toBeLessThan(lastP1);
  });

  it("25. stops as soon as a known replay appears (and returns only newer ones)", async () => {
    const { fetchPage, calls } = fetcher({ 1: realPage(1), 2: realPage(2) });
    // known = 3rd replay of page 2 ⇒ everything on page 1 + first 2 of page 2 is new
    const known = new Set([ids(realPage(2).replays)[2]!]);
    const r = await collectMatchesSince(fetchPage, known, 3);
    expect(calls).toEqual([1, 2]);
    expect(r.reachedKnown).toBe(true);
    expect(r.gapSuspected).toBe(false);
    expect(ids(r.replays)).toEqual([...ids(realPage(1).replays), "QW48GVG68", "EQKU5LNFD"]);

    const onFirst = await collectMatchesSince(
      fetcher({ 1: realPage(1) }).fetchPage,
      new Set(["VGPTB9UCN"]),
      3,
    );
    expect(onFirst.replays).toEqual([]);
    expect(onFirst.pagesFetched).toBe(1);
  });

  it("26+27. MAX_BATTLELOG_PAGES_PER_POLL is honoured and gapSuspected is reported", async () => {
    const { fetchPage, calls } = fetcher({ 1: realPage(1), 2: realPage(2) });
    const r = await collectMatchesSince(fetchPage, new Set(["NOT-ON-THESE-PAGES"]), 2);
    expect(calls).toEqual([1, 2]);
    expect(r.replays).toHaveLength(20);
    expect(r.gapSuspected).toBe(true);
    expect(r.gapReason).toBe("page_limit");

    // first poll ever (no known ids): never a gap, still bounded
    const first = await collectMatchesSince(
      fetcher({ 1: realPage(1), 2: realPage(2) }).fetchPage,
      new Set(),
      1,
    );
    expect(first.pagesFetched).toBe(1);
    expect(first.gapSuspected).toBe(false);
  });

  it("history exhausted without finding a known id is also a gap", async () => {
    const onlyPage = { ...realPage(1), totalPage: 1 };
    const r = await collectMatchesSince(fetcher({ 1: onlyPage }).fetchPage, new Set(["OLD"]), 3);
    expect(r).toMatchObject({
      gapSuspected: true,
      gapReason: "history_exhausted",
      pagesFetched: 1,
    });
  });

  it("28. incoherent total_page / current_page are warned about and do not loop", async () => {
    const lying = { ...realPage(1), totalPage: 0 };
    const r1 = await collectMatchesSince(fetcher({ 1: lying }).fetchPage, new Set(["X"]), 3);
    expect(r1.pagesFetched).toBe(1);
    expect(r1.warnings.join()).toContain("incoherent total_page 0");

    const wrongPage = { ...realPage(2), currentPage: 7 };
    const r2 = await collectMatchesSince(
      fetcher({ 1: realPage(1), 2: wrongPage, 3: { ...realPage(2), replays: [] } }).fetchPage,
      new Set(["X"]),
      5,
    );
    expect(r2.warnings.join()).toContain("asked for page 2 but Capcom answered current_page 7");
    expect(r2.warnings.join()).toContain("page 3 is empty but total_page is 10");
    expect(r2.pagesFetched).toBe(3);

    // the same replay shifting from page 1 to page 2 mid-poll is collected once
    const shifted = {
      ...realPage(2),
      replays: [realPage(1).replays.at(-1), ...realPage(2).replays],
    };
    const r3 = await collectMatchesSince(
      fetcher({ 1: realPage(1), 2: shifted }).fetchPage,
      new Set(["X"]),
      2,
    );
    expect(r3.replays).toHaveLength(20);
  });
});
