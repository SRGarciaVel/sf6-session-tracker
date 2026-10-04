/**
 * Server provider and browser companion must produce IDENTICAL normalized data: both use
 * @sf6/capcom-core, and the companion's wire form must round-trip through the sync schema.
 */
import { describe, expect, it } from "vitest";
import {
  companionSyncRequestSchema,
  normalizeCapcomMatches,
  normalizeCapcomProfile,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  toWireMatch,
  toWireProfile,
} from "@sf6/capcom-core";
import { CapcomSF6DataProvider } from "@/server/sf6/providers/capcom";
import {
  createCapcomFixtureFetch,
  FIXTURE_CFN_ID as CFN,
} from "@/server/sf6/providers/capcom/fixture-fetch";

describe("server provider ≡ companion (same fixtures)", () => {
  it("profile and matches are identical after the companion wire round-trip", async () => {
    const now = new Date("2026-10-04T00:00:00Z");
    const fetch = createCapcomFixtureFetch();
    const server = CapcomSF6DataProvider.withClientOptions({ fetch }, { now: () => now });
    const serverProfile = await server.getPlayerProfile(CFN);
    const serverMatches = await server.getRecentMatches(CFN);

    // Companion path: same raw payloads, normalized in "the browser", serialized, validated.
    const raw = async (path: string) =>
      (await (await fetch(`https://www.streetfighter.com${path}`)).json()) as unknown;
    const buildId = "fd-cwVZtHmfmH_deY-WuZ";
    const play = await raw(
      `/6/buckler/_next/data/${buildId}/en/profile/${CFN}/play.json?sid=${CFN}`,
    );
    const log = await raw(
      `/6/buckler/_next/data/${buildId}/en/profile/${CFN}/battlelog.json?sid=${CFN}`,
    );
    const profile = normalizeCapcomProfile(parseCapcomPlayPayload(play), {
      cfnUserId: CFN,
    }).profile;
    const matches = normalizeCapcomMatches(parseCapcomBattlelogPayload(log).replays, {
      trackedCfnId: CFN,
      now,
    }).matches;
    const wire = JSON.parse(
      JSON.stringify({
        cfnUserId: CFN,
        observedAt: now.toISOString(),
        profile: toWireProfile(profile),
        matches: matches.map(toWireMatch),
        gapSuspected: false,
        client: { version: "0.1.0", transport: "main_tab" },
      }),
    ) as unknown;
    const received = companionSyncRequestSchema.parse(wire);

    expect(received.profile).toEqual(serverProfile);
    expect(received.matches).toEqual(serverMatches);
  });
});
