/**
 * Contract checker for SF6DataProvider output (pure). Used by `pnpm provider:check` to validate
 * a real extractor BEFORE ResilientProvider silently drops invalid entries.
 *
 * ERROR   → the app cannot use the data correctly (check exits 1).
 * WARNING → suspicious but tolerated; compare against CFN by hand.
 * PASS    → verified.
 */
import { ratingPointOf } from "@/domain/sf6/rating";
import type { NormalizedPlayerProfile, NormalizedSF6Match } from "@/domain/sf6/types";
import { normalizedMatchSchema, normalizedProfileSchema } from "./provider";

export type CheckLevel = "ERROR" | "WARNING" | "PASS";
export interface CheckFinding {
  level: CheckLevel;
  message: string;
}

export interface ContractReport {
  findings: CheckFinding[];
  profile: NormalizedPlayerProfile | null;
  matches: NormalizedSF6Match[];
  invalidMatches: number;
  order: "newest-first" | "oldest-first" | "unordered" | "n/a";
  ok: boolean;
}

function issuesText(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .slice(0, 4)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export function checkProviderOutput(input: {
  cfnUserId: string;
  profile: unknown;
  matches: unknown;
  now?: Date;
}): ContractReport {
  const now = input.now ?? new Date();
  const f: CheckFinding[] = [];
  const add = (level: CheckLevel, message: string) => f.push({ level, message });

  /* ── Profile ── */
  const parsedProfile = normalizedProfileSchema.safeParse(input.profile);
  let profile: NormalizedPlayerProfile | null = null;
  if (!parsedProfile.success) {
    add("ERROR", `profile does not match the contract — ${issuesText(parsedProfile.error.issues)}`);
  } else {
    profile = parsedProfile.data;
    if (profile.cfnUserId !== input.cfnUserId) {
      add("ERROR", `cfnUserId mismatch: asked ${input.cfnUserId}, got ${profile.cfnUserId}`);
    } else add("PASS", `cfnUserId ${profile.cfnUserId}`);
    add("PASS", `displayName "${profile.displayName}"`);

    if (profile.characters.length === 0)
      add("WARNING", "profile has no characters with league data");
    else add("PASS", `${profile.characters.length} characters`);

    const seen = new Set<string>();
    for (const c of profile.characters) {
      if (seen.has(c.characterKey))
        add("WARNING", `duplicate characterKey "${c.characterKey}" (first one is kept)`);
      seen.add(c.characterKey);
      if (c.ratingSystem === null) {
        add(
          "WARNING",
          `${c.characterKey}: ratingSystem is null — no rating/delta for this character`,
        );
      } else if (c.ratingSystem === "lp") {
        if (c.leaguePoints === null)
          add("WARNING", `${c.characterKey}: ratingSystem "lp" but leaguePoints is null`);
        if (c.masterRate !== null) {
          add(
            "WARNING",
            `${c.characterKey}: ratingSystem "lp" but masterRate=${c.masterRate} (MR and LP both active?)`,
          );
        }
      } else if (c.ratingSystem === "mr" && c.masterRate === null) {
        add("WARNING", `${c.characterKey}: ratingSystem "mr" but masterRate is null`);
      }
    }
    if (profile.favoriteCharacterKey && !seen.has(profile.favoriteCharacterKey)) {
      add(
        "WARNING",
        `favoriteCharacterKey "${profile.favoriteCharacterKey}" is not in characters[]`,
      );
    }
  }

  /* ── Matches ── */
  const rawMatches: unknown[] = Array.isArray(input.matches) ? input.matches : [];
  if (!Array.isArray(input.matches)) add("ERROR", "getRecentMatches did not return an array");
  const matches: NormalizedSF6Match[] = [];
  let invalid = 0;
  rawMatches.forEach((raw, idx) => {
    const parsed = normalizedMatchSchema.safeParse(raw);
    if (parsed.success) {
      matches.push(parsed.data);
      return;
    }
    invalid++;
    const missingKey = parsed.error.issues.some((i) => i.path[0] === "characterKey");
    add(
      "ERROR",
      `match #${idx} rejected${missingKey ? " (characterKey missing/invalid)" : ""} — ${issuesText(parsed.error.issues)}`,
    );
  });
  if (rawMatches.length > 0) {
    add(
      invalid === 0 ? "PASS" : "ERROR",
      `${matches.length}/${rawMatches.length} matches valid (page size ${rawMatches.length})`,
    );
  } else add("WARNING", "no recent matches returned (play one Ranked match and re-run)");

  const ids = new Set<string>();
  const unknownChars = new Map<string, number>();
  const profileChars = new Map((profile?.characters ?? []).map((c) => [c.characterKey, c]));
  for (const m of matches) {
    if (ids.has(m.externalMatchId))
      add("WARNING", `duplicate externalMatchId ${m.externalMatchId}`);
    ids.add(m.externalMatchId);
    if (m.playedAt.getTime() > now.getTime() + 60_000) {
      add(
        "WARNING",
        `${m.externalMatchId}: playedAt in the future (${m.playedAt.toISOString()}) — timezone?`,
      );
    }
    if (m.mode === "unknown")
      add("WARNING", `${m.externalMatchId}: mode "unknown" — map the battle type`);
    const pc = profileChars.get(m.characterKey);
    if (profile && m.mode === "ranked" && !pc) {
      unknownChars.set(m.characterKey, (unknownChars.get(m.characterKey) ?? 0) + 1);
    }
    if (m.ratingBefore && m.ratingAfter && m.ratingBefore.system !== m.ratingAfter.system) {
      add(
        "WARNING",
        `${m.externalMatchId}: ratingBefore ${m.ratingBefore.system} vs ratingAfter ${m.ratingAfter.system} (promotion, or mapping error?)`,
      );
    }
    const pcPoint = pc ? ratingPointOf(pc) : null;
    if (m.ratingAfter && pcPoint && m.ratingAfter.system !== pcPoint.system) {
      add(
        "WARNING",
        `${m.externalMatchId}: ratingAfter is ${m.ratingAfter.system} but profile says ${pcPoint.system} for ${m.characterKey}`,
      );
    }
  }

  for (const [key, count] of unknownChars) {
    add(
      "WARNING",
      `characterKey "${key}" used in ${count} ranked match(es) but not in profile.characters`,
    );
  }

  let order: ContractReport["order"] = "n/a";
  if (matches.length >= 2) {
    const times = matches.map((m) => m.playedAt.getTime());
    const desc = times.every((t, i) => i === 0 || t <= (times[i - 1] ?? t));
    const asc = times.every((t, i) => i === 0 || t >= (times[i - 1] ?? t));
    order = desc ? "newest-first" : asc ? "oldest-first" : "unordered";
    if (order === "unordered")
      add(
        "WARNING",
        "matches are not in chronological order (the app re-sorts, but check the mapping)",
      );
    else add("PASS", `matches ordered ${order}`);
  }
  if (matches.length > 0) {
    const ranked = matches.filter((m) => m.mode === "ranked").length;
    add("PASS", `${ranked} ranked / ${matches.length - ranked} other`);
    if (matches.every((m) => !m.ratingAfter)) {
      add("WARNING", "no match has ratingAfter — deltas will rely on profile snapshots only");
    }
  }

  return {
    findings: f,
    profile,
    matches,
    invalidMatches: invalid,
    order,
    ok: !f.some((x) => x.level === "ERROR"),
  };
}
