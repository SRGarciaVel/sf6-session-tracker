/**
 * Phase 5.6C — Fight Session RECAP rendered on the server path (ES/EN) from real engine
 * summaries: winning, losing, empty, multi-character, unknown rating, legacy model, in progress,
 * long sessions (bounded strip, folded list, session numbering) and draws.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityItem } from "@/components/fight-session";
import { START, engineSession } from "@/components/fight-session/test-support";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { toLiveSessionState, type LiveSessionState } from "@/domain/overlay/state";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type RatingModel,
  type SessionMatch,
} from "@/domain/session/engine";
import type { MatchResult } from "@/domain/sf6/types";
import { FightSessionRecap, RECAP_LIST_MAX, RECAP_STRIP_MAX } from "./FightSessionRecap";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

/** The persisted-match projection for an engineSession (same ids/times/opponents). */
function itemsOf(results: MatchResult[]): ActivityItem[] {
  return results.map((result, i) => ({
    id: `m${i + 1}`,
    result,
    characterName: "Ryu",
    opponentCharacter: "Ken",
    opponentName: `Rival ${i + 1}`,
    playedAt: new Date(START.getTime() + (i + 1) * 6 * 60_000).toISOString(),
  }));
}

function render(
  session: LiveSessionState,
  items: ActivityItem[],
  opts: { locale?: "es" | "en"; justEnded?: boolean; ratingModel?: RatingModel } = {},
) {
  const ended = session.status === "ended";
  return renderToString(
    <NextIntlClientProvider
      locale={opts.locale ?? "es"}
      messages={opts.locale === "en" ? en : es}
      timeZone="UTC"
    >
      <FightSessionRecap
        session={session}
        ratingModel={opts.ratingModel ?? "per_character"}
        startedAt={START.toISOString()}
        endedAt={ended ? new Date(START.getTime() + 64 * 60_000).toISOString() : null}
        matches={items}
        justEnded={opts.justEnded ?? false}
      />
    </NextIntlClientProvider>,
  );
}

const ended = (
  results: MatchResult[],
  snapshot: { value: number; after: number } | null,
  extra = {},
) => engineSession({ results, status: "ended", snapshot, ...extra });

describe("Fight Session RECAP", () => {
  it("winning session: title, period, duration, results with the session change, strip, list", () => {
    const results: MatchResult[] = [
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
    const html = render(ended(results, { value: 1613, after: 9 }), itemsOf(results), {
      justEnded: true,
    });
    const t = text(html);
    expect(t).toContain("Sesión finalizada y guardada");
    expect(html).toMatch(/role="status"[^>]*>.*Sesión finalizada y guardada/);
    expect(t).toContain("Sesión terminada");
    expect(t).toContain("Duración 1h 04m");
    expect(t).toMatch(/Partidas\s+10\s+Victorias\s+7\s+Derrotas\s+3\s+% de victorias\s+70\s%/);
    expect(t).toMatch(/Cambio en la sesión · Ryu\s+▲\s+\+42\s+1571 → 1613 MR/);
    expect(html).toContain('aria-label="Partida 10: Victoria"');
    expect(t).toMatch(/10\s*\.\s*Ryu vs Ken/);
    expect(html).toContain('href="/dashboard#session"');
    expect(html).toContain('href="/dashboard#overlays"');
    expect(html).toContain('href="?ui=classic"');
  });

  it("losing session gets the same presentation (no judgement, no badges)", () => {
    const results: MatchResult[] = ["loss", "loss", "loss"];
    const t = text(render(ended(results, { value: 1530, after: 2 }), itemsOf(results)));
    expect(t).toContain("Sesión terminada");
    expect(t).toMatch(/Victorias\s+0\s+Derrotas\s+3\s+% de victorias\s+0\s%/);
    expect(t).toMatch(/▼\s+-41/);
    expect(t).not.toMatch(/mejor|récord|logro/i);
  });

  it("all wins", () => {
    const results: MatchResult[] = ["win", "win"];
    expect(text(render(ended(results, { value: 1600, after: 1 }), itemsOf(results)))).toMatch(
      /% de victorias\s+100\s%/,
    );
  });

  it("no matches: «—» win rate, no strip, honest empty list", () => {
    const t = text(render(ended([], null), []));
    expect(t).toMatch(/Partidas\s+0/);
    expect(t).toContain("—");
    expect(t).toContain("No se ha registrado ninguna partida");
    expect(t).not.toContain("Partida 1:");
    // No character was played: no rating change is reported for anyone.
    expect(t).not.toContain("Cambio en la sesión");
    expect(t).not.toContain("Personajes de la sesión");
  });

  it("unknown final rating: explained, never shown as 0 or as a held value", () => {
    const results: MatchResult[] = ["win", "loss"];
    const t = text(render(ended(results, null), itemsOf(results)));
    expect(t).toContain("MR final no disponible");
    expect(t).not.toContain("pendiente");
    expect(t).not.toContain("±0");
  });

  it("legacy session: no rating changes are claimed", () => {
    const results: MatchResult[] = ["win"];
    const t = text(
      render(ended(results, { value: 1583, after: 0 }), itemsOf(results), {
        ratingModel: "legacy",
      }),
    );
    expect(t).toContain("Sesión registrada antes del rating por personaje");
    expect(t).not.toContain("Cambio en la sesión");
  });

  it("multiple characters: one rating per character, systems never combined", () => {
    const at = (m: number) => new Date(START.getTime() + m * 60_000);
    const mk = (
      id: string,
      min: number,
      key: string,
      name: string,
      result: MatchResult,
    ): SessionMatch => ({
      externalMatchId: id,
      playedAt: at(min),
      mode: "ranked",
      result,
      characterKey: key,
      characterName: name,
      opponentCharacter: "Ken",
      opponentName: null,
    });
    const summary = summarizeSession({
      status: "ended",
      ratingModel: "per_character",
      baseline: {
        startedAt: START,
        endedAt: at(30),
        baselineMatchId: null,
        baselinePlayedAt: null,
        filter: DEFAULT_SESSION_FILTER,
      },
      matches: [
        mk("a", 6, "ryu", "Ryu", "win"),
        mk("b", 12, "jamie", "Jamie", "loss"),
        mk("c", 18, "jamie", "Jamie", "loss"),
      ],
      characterBaselines: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          source: "session_start",
          rating: { system: "mr", value: 1571, rank: null },
          capturedAt: START,
        },
        {
          characterKey: "jamie",
          characterName: "Jamie",
          source: "session_start",
          rating: { system: "lp", value: 23006, rank: null },
          capturedAt: START,
        },
      ],
      current: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          rating: { system: "mr", value: 1583, rank: null },
          observedAt: at(30),
        },
        {
          characterKey: "jamie",
          characterName: "Jamie",
          rating: { system: "lp", value: 22982, rank: null },
          observedAt: at(30),
        },
      ],
      favoriteCharacterKey: "ryu",
    });
    const session = toLiveSessionState("s", summary, { characters: [], activeCharacterKey: null });
    const t = text(render(session, []));
    expect(t).toMatch(/Cambio en la sesión · Jamie\s+▼\s+-24\s+23\.006 → 22\.982 LP/);
    expect(t).toMatch(/Jamie desde\s+23\.006\s+22\.982\s+LP/);
    expect(t).toMatch(/Ryu desde\s+1571\s+1583\s+MR/);
    expect(t).not.toMatch(/\+?-?\d+\s*(MR|LP)\s*(total|combinado)/i);
  });

  it("active session reached by URL: not shown as finished", () => {
    const t = text(render(engineSession({ results: ["win"] }), itemsOf(["win"])));
    expect(t).toContain("Sesión en curso");
    expect(t).not.toContain("Sesión terminada");
    expect(t).not.toContain("Partidas de la sesión");
  });

  it("long session: bounded strip (session numbering) and a folded list", () => {
    const results: MatchResult[] = Array.from({ length: 45 }, (_, i) =>
      i % 4 === 0 ? "loss" : "win",
    );
    const html = render(ended(results, { value: 1700, after: 44 }), itemsOf(results));
    const strip = html.match(/aria-label="Partida \d+: /g) ?? [];
    expect(strip).toHaveLength(RECAP_STRIP_MAX);
    expect(html).toContain('aria-label="Partida 16: ');
    expect(html).not.toContain('aria-label="Partida 15: ');
    expect(text(html)).toContain(`Se muestran las últimas ${RECAP_STRIP_MAX} de 45 partidas.`);
    expect(text(html)).toContain(`Ver ${45 - RECAP_LIST_MAX} partidas anteriores`);
    expect(text(html)).toMatch(/45\s*\.\s*Ryu vs Ken/);
    expect(text(html)).toMatch(/[^0-9]1\s*\.\s*Ryu vs Ken/); // inside the folded part
  });

  it("draws are counted and explained", () => {
    const results: MatchResult[] = ["win", "draw", "loss"];
    const t = text(render(ended(results, { value: 1571, after: 2 }), itemsOf(results)));
    expect(t).toContain("1 empate (no cuentan en el % de victorias)");
    expect(t).toMatch(/% de victorias\s+50\s%/);
  });

  it("English", () => {
    const results: MatchResult[] = ["win", "loss", "loss"];
    const t = text(
      render(ended(results, { value: 1547, after: 2 }), itemsOf(results), {
        locale: "en",
        justEnded: true,
      }),
    );
    expect(t).toContain("Session complete");
    expect(t).toContain("Session ended and saved");
    expect(t).toContain("Prepare another session");
    expect(t).toMatch(/Win rate\s+33\.3%/);
    expect(t).toContain("View classic recap");
  });
});
