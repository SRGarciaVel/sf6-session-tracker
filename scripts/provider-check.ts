/**
 * Validate an SF6DataProvider against a CFN User ID.
 *
 *   pnpm provider:check 1733837998             # configured provider (SF6_PROVIDER)
 *   pnpm provider:check --fixture [cfnId]      # Capcom provider over the sanitized HAR fixtures,
 *                                              # zero network, no DB, no env needed
 *
 * Calls the RAW provider (no silent dropping), validates the per-character contract and prints
 * PROFILE / CHARACTERS / MATCHES tables plus ERROR / WARNING / PASS findings. For the Capcom
 * provider it also prints raw ids (characterId, league_rank, replay side, battle type), the
 * pagination envelope and the parser warnings. Exit code 1 only when there are ERRORs.
 */
import type { SF6DataProvider } from "@/server/sf6/provider";
import type { CapcomInspection, CapcomSF6DataProvider } from "@/server/sf6/providers/capcom";

try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

const rating = (r: { system: string; value: number } | null | undefined) =>
  r ? `${r.value} ${r.system.toUpperCase()}` : "—";

function printCapcomDetails(inspection: CapcomInspection) {
  const { profile, matches, pagination } = inspection;
  console.log("\n== CAPCOM CHARACTERS (raw ids)");
  const byKey = new Map(profile.profile.characters.map((c) => [c.characterKey, c]));
  console.table(
    profile.characters.map((d) => {
      const c = byKey.get(d.characterKey);
      return {
        characterKey: d.characterKey,
        characterId: d.characterId,
        name: d.characterName,
        leagueRankRaw: d.leagueRankRaw,
        rank: c?.rank ?? null,
        ratingSystem: c?.ratingSystem ?? null,
        LP: c?.leaguePoints ?? null,
        MR: c?.masterRate ?? null,
        seasonId: d.seasonId,
        phase: c?.phase ?? null,
      };
    }),
  );

  console.log("\n== CAPCOM MATCHES (battlelog page 1)");
  const byId = new Map(matches.matches.map((m) => [m.externalMatchId, m]));
  console.table(
    matches.details.map((d) => {
      const m = byId.get(d.externalMatchId);
      return {
        replay_id: d.externalMatchId,
        playedAt: m?.playedAt.toISOString(),
        battleType: `${d.battleTypeRaw} (${d.battleTypeName ?? "?"})`,
        mode: m?.mode,
        side: d.side,
        rounds: `${d.roundsWon}-${d.roundsLost}`,
        result: m?.result,
        own: m?.characterKey,
        opponent: `${m?.opponent.name ?? "?"} (${m?.opponent.characterKey ?? "?"})`,
        ratingAtMatch:
          `${d.ratingAtMatchRaw.leaguePoint} LP / rank ${d.ratingAtMatchRaw.leagueRank}` +
          (d.ratingAtMatchRaw.masterLeague ? ` / ${d.ratingAtMatchRaw.masterRating} MR` : ""),
        ratingBefore: rating(m?.ratingBefore),
      };
    }),
  );

  console.log("\n== PAGINATION");
  console.table([pagination]);

  console.log("\n== CAPCOM WARNINGS");
  const warnings = [...profile.warnings, ...matches.warnings];
  if (warnings.length === 0) console.log("(none)");
  for (const w of warnings) console.log(`WARNING  ${w}`);
}

async function main() {
  const args = process.argv.slice(2);
  const fixture = args.includes("--fixture");
  const positional = args.filter((a) => !a.startsWith("--"));

  const { cfnUserIdSchema } = await import("@/server/sf6/provider");
  const { checkProviderOutput } = await import("@/server/sf6/contract-check");
  const capcom = await import("@/server/sf6/providers/capcom");

  let provider: SF6DataProvider;
  let close = async () => {};
  let cfnArg = positional[0];
  if (fixture) {
    const { createCapcomFixtureFetch, FIXTURE_CFN_ID } =
      await import("@/server/sf6/providers/capcom/fixture-fetch");
    cfnArg ??= FIXTURE_CFN_ID;
    provider = capcom.CapcomSF6DataProvider.withClientOptions({
      fetch: createCapcomFixtureFetch(),
    });
    console.log("provider: capcom (FIXTURE MODE — sanitized HAR, no network)\n");
  } else {
    if (!cfnArg) {
      console.error(
        "Usage: pnpm provider:check <cfnUserId>   |   pnpm provider:check --fixture [cfnUserId]",
      );
      process.exit(1);
    }
    const { getRawSF6DataProvider } = await import("@/server/sf6");
    const { closeDb } = await import("@/server/db/client");
    close = closeDb;
    provider = getRawSF6DataProvider();
    console.log(`provider: ${provider.name}\n`);
  }
  const id = cfnUserIdSchema.parse(cfnArg);

  const t0 = Date.now();
  const profile = await provider.getPlayerProfile(id);
  const profileMs = Date.now() - t0;
  const t1 = Date.now();
  const matches = await provider.getRecentMatches(id);
  const matchesMs = Date.now() - t1;

  const report = checkProviderOutput({ cfnUserId: id, profile, matches });

  console.log(`== PROFILE (${profileMs} ms)`);
  if (report.profile) {
    console.table([
      {
        cfnUserId: report.profile.cfnUserId,
        displayName: report.profile.displayName,
        favoriteCharacterKey: report.profile.favoriteCharacterKey ?? null,
        characters: report.profile.characters.length,
      },
    ]);
    console.log("\n== CHARACTERS");
    console.table(
      report.profile.characters.map((c) => ({
        characterKey: c.characterKey,
        characterName: c.characterName,
        rank: c.rank,
        rankTier: c.rankTier,
        ratingSystem: c.ratingSystem,
        LP: c.leaguePoints,
        MR: c.masterRate,
        phase: c.phase ?? null,
      })),
    );
  }

  console.log(`\n== MATCHES (${matchesMs} ms, order: ${report.order})`);
  console.table(
    report.matches.slice(0, 20).map((m) => ({
      id: m.externalMatchId,
      playedAt: m.playedAt.toISOString(),
      ago: `${Math.round((Date.now() - m.playedAt.getTime()) / 60_000)} min`,
      mode: m.mode,
      result: m.result,
      characterKey: m.characterKey,
      opponent: m.opponent.characterName ?? m.opponent.characterKey ?? "?",
      before: rating(m.ratingBefore),
      after: rating(m.ratingAfter),
    })),
  );

  if (provider instanceof capcom.CapcomSF6DataProvider) {
    printCapcomDetails(await (provider as CapcomSF6DataProvider).inspect(id));
  }

  console.log("\n== CHECKS");
  for (const finding of report.findings) {
    const tag =
      finding.level === "PASS" ? "PASS   " : finding.level === "WARNING" ? "WARNING" : "ERROR  ";
    console.log(`${tag}  ${finding.message}`);
  }
  const errors = report.findings.filter((x) => x.level === "ERROR").length;
  const warnings = report.findings.filter((x) => x.level === "WARNING").length;
  console.log(
    `\n${errors} error(s), ${warnings} warning(s) — ${report.ok ? "contract OK" : "contract FAILED"}`,
  );
  console.log("Now compare the tables above with CFN (see docs/capcom-provider.md).");
  await close();
  if (!report.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("provider check FAILED:", err);
  process.exit(1);
});
