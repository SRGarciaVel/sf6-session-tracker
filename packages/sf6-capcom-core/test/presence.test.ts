import { describe, expect, it } from "vitest";
import {
  companionSyncRequestSchema,
  onlineStatusOfBanner,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  normalizeCapcomProfile,
  presenceFromOnlineStatus,
} from "../src";
import { loadFixture as fixtureJson } from "./fixtures";

const CFN = "1733837998";

describe("presenceFromOnlineStatus — evidence-backed codes only", () => {
  it.each([
    [1, "offline"],
    [2, "menu"],
    [8, "practice"],
    [11, "ranked-match"],
  ] as const)("%i → %s", (code, presence) => {
    expect(presenceFromOnlineStatus(code)).toBe(presence);
  });

  it.each([0, 3, 4, 5, 6, 7, 9, 10, 12, 999, -1, 1.5, Number.NaN, null, undefined, "1", "11"])(
    "%s → unknown (no mapping without evidence; Battle Hub 4/5/6 included)",
    (code) => {
      expect(presenceFromOnlineStatus(code)).toBe("unknown");
    },
  );

  it("never maps by the localized name", () => {
    expect(presenceFromOnlineStatus("Ranked Match")).toBe("unknown");
    expect(presenceFromOnlineStatus("Offline")).toBe("unknown");
  });
});

describe("onlineStatusOfBanner — lenient extraction", () => {
  const banner = (online_status: unknown) => ({
    online_status_info: {
      online_status,
      online_status_data: { online_status_name: "Ranked Match", online_status_type: 11 },
    },
  });

  it("reads the numeric code (real shape)", () => {
    expect(onlineStatusOfBanner(banner(11))).toBe(11);
    expect(onlineStatusOfBanner(banner(1))).toBe(1);
    expect(onlineStatusOfBanner(banner(0))).toBe(0);
  });

  it("absent or malformed ⇒ null, never throws", () => {
    for (const b of [
      null,
      undefined,
      {},
      { online_status_info: null },
      { online_status_info: {} },
      banner("11"),
      banner(-1),
      banner(2.5),
      banner(10_001),
      "x",
    ]) {
      expect(onlineStatusOfBanner(b)).toBeNull();
    }
  });
});

describe("presence on the pages SST already fetches", () => {
  const withPresence = (raw: unknown, code: unknown) => {
    const copy = structuredClone(raw) as { pageProps: Record<string, Record<string, unknown>> };
    const banner = copy.pageProps.fighter_banner_info ?? {};
    banner.online_status_info = {
      online_status: code,
      online_status_data: { online_status_name: "<b>x</b>", online_status_type: code },
    };
    copy.pageProps.fighter_banner_info = banner;
    return copy;
  };

  it("play.json: exposed next to the profile, NOT inside it", () => {
    const raw = withPresence(fixtureJson(`play-${CFN}.json`), 8);
    const out = normalizeCapcomProfile(parseCapcomPlayPayload(raw), { cfnUserId: CFN });
    expect(out.onlineStatus).toBe(8);
    expect(out.profile).not.toHaveProperty("onlineStatus");
    expect(JSON.stringify(out.profile)).not.toContain("online_status");
  });

  it("battlelog.json: read from the page's fighter_banner_info", () => {
    const raw = withPresence(fixtureJson(`battlelog-${CFN}-page-1.json`), 11);
    expect(parseCapcomBattlelogPayload(raw).onlineStatus).toBe(11);
  });

  it("sanitized fixtures without the field still parse (null)", () => {
    const play = normalizeCapcomProfile(parseCapcomPlayPayload(fixtureJson(`play-${CFN}.json`)), {
      cfnUserId: CFN,
    });
    expect(play.onlineStatus).toBeNull();
    expect(
      parseCapcomBattlelogPayload(fixtureJson(`battlelog-${CFN}-page-1.json`)).onlineStatus,
    ).toBeNull();
  });

  it("a malformed presence never breaks the page parse", () => {
    const raw = withPresence(fixtureJson(`battlelog-${CFN}-page-1.json`), { nested: true });
    expect(parseCapcomBattlelogPayload(raw).onlineStatus).toBeNull();
  });
});

describe("sync contract — additive presence", () => {
  const base = {
    cfnUserId: CFN,
    observedAt: "2026-10-14T20:00:00.000Z",
    profile: null,
    matches: [],
    gapSuspected: false,
    client: { version: "0.3.0", transport: "service_worker" as const },
  };

  it("old Companion (no presence key) is still valid", () => {
    const parsed = companionSyncRequestSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.presence).toBeUndefined();
  });

  it("new Companion: code, null code or null presence", () => {
    for (const presence of [{ onlineStatus: 11 }, { onlineStatus: null }, null]) {
      expect(companionSyncRequestSchema.safeParse({ ...base, presence }).success).toBe(true);
    }
  });

  it("presence is strict: no names, no extra keys, no junk codes", () => {
    for (const presence of [
      { onlineStatus: 11, name: "Ranked Match" },
      { onlineStatus: "11" },
      { onlineStatus: -1 },
      { onlineStatus: 1.5 },
      { onlineStatus: 10_001 },
      { state: "practice" },
    ]) {
      expect(companionSyncRequestSchema.safeParse({ ...base, presence }).success).toBe(false);
    }
  });
});
