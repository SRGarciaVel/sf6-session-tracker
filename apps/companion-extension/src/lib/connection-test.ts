/**
 * "Test Buckler connection": for each transport (least invasive first: service worker, isolated
 * tab, main tab) try buildId → play.json → battlelog.json page 1 ONCE, stopping at the first
 * transport that passes (debug builds test all of them). A transport stops at its first failure; a 429 stops the whole test.
 * Only PASS/FAIL + counts are kept — never bodies.
 */
import {
  COMPANION_TRANSPORTS,
  normalizeCapcomProfile,
  parseCapcomBattlelogPayload,
  parseCapcomPlayPayload,
  type CompanionTransportKind,
} from "@sf6/capcom-core";
import { BucklerError, CompanionBucklerClient } from "./buckler-client";
import type { BucklerTransport } from "./buckler-transport";
import type { ConnectionTestReport, TransportTestResult } from "./storage";

export async function runConnectionTest(
  cfnUserId: string,
  makeTransport: (kind: CompanionTransportKind) => BucklerTransport,
  options: {
    order?: readonly CompanionTransportKind[];
    now?: () => Date;
    /** Test every transport (debug). Default: stop at the first one that fully passes. */
    exhaustive?: boolean;
  } = {},
): Promise<ConnectionTestReport> {
  const order = options.order ?? COMPANION_TRANSPORTS;
  const results: TransportTestResult[] = [];
  let rateLimited = false;

  for (const kind of order) {
    const r: TransportTestResult = {
      transport: kind,
      buildId: "SKIP",
      play: "SKIP",
      battlelog: "SKIP",
      failure: null,
      status: null,
      characters: null,
      replays: null,
      viewerOwnsProfile: null,
      pageLocale: null,
      requestLocale: null,
      signature: null,
      notes: [],
      request: null,
    };
    results.push(r);
    if (rateLimited) {
      r.failure = "skipped_after_rate_limit";
      continue;
    }
    const alreadyPassed = results.some(
      (x) => x !== r && x.buildId === "PASS" && x.play === "PASS" && x.battlelog === "PASS",
    );
    if (alreadyPassed && !options.exhaustive) {
      results.pop(); // not attempted: fewer Buckler requests in normal use
      break;
    }
    const client = new CompanionBucklerClient(makeTransport(kind), {
      onWarning: (event, fields) =>
        r.notes.push(`${event}:${String(fields.endpoint)}:${String(fields.status)}`),
    });
    let step: "buildId" | "play" | "battlelog" = "buildId";
    try {
      const meta = await client.getPageMeta(cfnUserId);
      r.buildId = "PASS";
      r.pageLocale = meta.locale;
      step = "play";
      const play = normalizeCapcomProfile(parseCapcomPlayPayload(await client.getPlay(cfnUserId)), {
        cfnUserId,
      });
      r.play = "PASS";
      r.characters = play.profile.characters.length;
      r.viewerOwnsProfile = play.viewerOwnsProfile;
      step = "battlelog";
      const page = parseCapcomBattlelogPayload(await client.getBattlelogPage(cfnUserId, 1));
      r.battlelog = "PASS";
      r.replays = page.replays.length;
      r.requestLocale = client.effectiveLocale;
      r.request = client.lastRequest;
    } catch (err) {
      r[step] = "FAIL";
      if (err instanceof BucklerError) {
        r.failure = err.kind;
        r.status = err.status;
        r.signature = err.signature;
        r.requestLocale = err.locale;
        r.request = err.request;
        if (err.kind === "rate_limited") rateLimited = true;
      } else {
        r.failure = err instanceof Error ? err.name : "error";
      }
    }
  }

  const preferred =
    results.find((r) => r.buildId === "PASS" && r.play === "PASS" && r.battlelog === "PASS")
      ?.transport ?? null;
  return {
    at: (options.now?.() ?? new Date()).toISOString(),
    cfnUserId,
    results,
    preferred,
    verdict: preferred ? "PASS" : "FAIL",
  };
}
