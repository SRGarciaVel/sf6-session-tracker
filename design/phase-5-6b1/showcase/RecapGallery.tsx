/**
 * Phase 5.6C visual QA: the real FightSessionRecap for representative sessions (server-rendered,
 * static; built into out/recap*.html by build.mts). Sessions come from the real engine.
 */
import { NextIntlClientProvider } from "next-intl";
import { START, engineSession } from "@/components/fight-session/test-support";
import type { ActivityItem } from "@/components/fight-session";
import { FightSessionRecap } from "@/app/(app)/dashboard/sessions/[id]/FightSessionRecap";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { MatchResult } from "@/domain/sf6/types";
import type { ShowcaseLocale } from "./Root";

const items = (results: MatchResult[]): ActivityItem[] =>
  results.map((result, i) => ({
    id: `m${i + 1}`,
    result,
    characterName: "Ryu",
    opponentCharacter: ["Ken", "Juri", "Luke", "Cammy"][i % 4]!,
    opponentName: `Rival ${i + 1}`,
    playedAt: new Date(START.getTime() + (i + 1) * 6 * 60_000).toISOString(),
  }));

const WIN: MatchResult[] = [
  "win",
  "win",
  "loss",
  "win",
  "loss",
  "win",
  "win",
  "loss",
  "win",
  "win",
];
const LOSE: MatchResult[] = ["loss", "loss", "win", "loss", "loss"];

export const RECAPS = {
  winning: {
    session: engineSession({ results: WIN, status: "ended", snapshot: { value: 1613, after: 9 } }),
    items: items(WIN),
  },
  losing: {
    session: engineSession({
      results: LOSE,
      status: "ended",
      system: "lp",
      baseline: 23006,
      snapshot: { value: 22850, after: 4 },
    }),
    items: items(LOSE),
  },
  unavailable: {
    session: engineSession({ results: ["win", "loss"], status: "ended", snapshot: null }),
    items: items(["win", "loss"]),
  },
  empty: {
    session: engineSession({ results: [], status: "ended", snapshot: null }),
    items: [] as ActivityItem[],
  },
} as const;

export function RecapPage({
  locale,
  which,
}: {
  locale: ShowcaseLocale;
  which: keyof typeof RECAPS;
}) {
  const r = RECAPS[which];
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : es} timeZone="UTC">
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-7" data-recap={which}>
        <FightSessionRecap
          session={r.session}
          ratingModel="per_character"
          startedAt={START.toISOString()}
          endedAt={new Date(START.getTime() + 64 * 60_000).toISOString()}
          matches={r.items}
          justEnded
        />
      </main>
    </NextIntlClientProvider>
  );
}
