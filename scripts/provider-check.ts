/**
 * Smoke-test the configured SF6DataProvider (SF6_PROVIDER) against a real CFN User ID.
 * Runs the same validation layer the app uses, so "OK" here means the tracker will accept it.
 *
 *   pnpm provider:check 1234567890
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
  const { getSF6DataProvider, cfnUserIdSchema } = await import("@/server/sf6");
  const { closeDb } = await import("@/server/db/client");
  const id = cfnUserIdSchema.parse(cfnUserId);
  const provider = getSF6DataProvider();
  console.log(`provider: ${provider.name}\n`);

  const t0 = Date.now();
  const profile = await provider.getPlayerProfile(id);
  console.log(`profile OK (${Date.now() - t0} ms)`);
  console.table([profile]);

  const t1 = Date.now();
  const matches = await provider.getRecentMatches(id);
  console.log(`\nmatches OK (${Date.now() - t1} ms): ${matches.length} valid`);
  console.table(
    matches.slice(0, 10).map((m) => ({
      id: m.externalMatchId,
      playedAt: m.playedAt.toISOString(),
      mode: m.mode,
      result: m.result,
      vs: `${m.playerCharacter ?? "?"} vs ${m.opponent.character ?? "?"}`,
      opponent: m.opponent.name,
    })),
  );
  const ids = new Set(matches.map((m) => m.externalMatchId));
  if (ids.size !== matches.length)
    console.warn("⚠ duplicate externalMatchId values in one response");
  if (matches.some((m) => m.playedAt.getTime() > Date.now() + 60_000)) {
    console.warn("⚠ some playedAt values are in the future — check timezone parsing");
  }
  await closeDb();
}

main().catch((err: unknown) => {
  console.error("provider check FAILED:", err);
  process.exit(1);
});
