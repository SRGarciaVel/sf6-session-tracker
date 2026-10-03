/**
 * Validate the configured SF6DataProvider (SF6_PROVIDER) against a real CFN User ID.
 *
 *   pnpm provider:check 1733837998
 *
 * Calls the RAW provider (no silent dropping), validates the per-character contract and prints
 * PROFILE / CHARACTERS / MATCHES tables plus ERROR / WARNING / PASS findings.
 * Exit code 1 only when there are ERRORs.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // optional
}

async function main() {
  const cfnUserId = process.argv[2];
  if (!cfnUserId) {
    console.error("Usage: pnpm provider:check <cfnUserId>");
    process.exit(1);
  }
  const { getRawSF6DataProvider, cfnUserIdSchema } = await import("@/server/sf6");
  const { checkProviderOutput } = await import("@/server/sf6/contract-check");
  const { closeDb } = await import("@/server/db/client");
  const id = cfnUserIdSchema.parse(cfnUserId);
  const provider = getRawSF6DataProvider();
  console.log(`provider: ${provider.name}\n`);

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

  const rating = (r: { system: string; value: number } | null | undefined) =>
    r ? `${r.value} ${r.system.toUpperCase()}` : "—";
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
  console.log("Now compare the tables above with CFN (see docs/audit §2.4 checklist).");
  await closeDb();
  if (!report.ok) process.exit(1);
}

main().catch((err: unknown) => {
  console.error("provider check FAILED:", err);
  process.exit(1);
});
