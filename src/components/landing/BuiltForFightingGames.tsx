"use client";

/**
 * Scene 6 — built for fighting games. Client component only because the emblem module is
 * shared with the (client) overlay renderer; it adds no new code to the bundle. The rank strip uses the
 * product's real SST-native emblem and rank mapping (no official artwork). Copy states plainly
 * that Street Fighter 6 is the game supported today.
 */
import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { RankEmblem } from "@/components/overlay/creator-themes";
import { rankPrestige } from "@/domain/sf6/rank-prestige";

const LADDER = [
  ["Iron 3", "lp"],
  ["Gold 2", "lp"],
  ["Platinum 4", "lp"],
  ["Diamond 1", "lp"],
  ["Master", "mr"],
  ["Ultimate Master", "mr"],
] as const;

export function BuiltForFightingGames() {
  const t = useTranslations("Landing.built");
  return (
    <section aria-labelledby="built-title" className="py-16 lg:py-24">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div>
          <h2
            id="built-title"
            data-reveal="mask"
            className="font-display text-3xl font-bold sm:text-5xl"
          >
            {t("title")}
            <span className="mt-1 block text-cyan">{t("supported")}</span>
          </h2>
          <p data-reveal="rise" className="mt-5 max-w-lg text-muted">
            {t("body")}
          </p>
        </div>
        <figure data-reveal="stage" className="sst-ladder">
          <ol className="grid grid-cols-3 gap-y-6 sm:grid-cols-6" aria-label={t("ladderLabel")}>
            {LADDER.map(([label, system]) => {
              const prestige = rankPrestige(label, system);
              return (
                <li key={label} className="flex flex-col items-center gap-2 text-center">
                  <span
                    className="sst-emblem-host"
                    style={{ "--ov-tier": prestige.color } as CSSProperties}
                  >
                    <RankEmblem prestige={prestige} />
                  </span>
                  <span className="font-display text-xs font-semibold tracking-wider text-muted uppercase">
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          <figcaption className="mt-5 text-center text-xs text-faint">
            {t("ladderCaption")}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
