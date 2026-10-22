/**
 * Phase 5.6B2 — the Fight Session dashboard rendered on the server path (ES/EN) from the real
 * LiveDashboardProvider state: PREPARE readiness states, ACTIVE intermediate view, status strip.
 */
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import type { CompanionSignals } from "@/domain/companion/readiness";
import type { DashboardLiveState } from "@/server/dashboard/state";
import { LiveDashboardProvider } from "../LiveDashboard";
import { SessionPanel } from "../SessionPanel";
import { FightSessionArea, FightStatusStrip } from "./FightSessionDashboard";
import { SESSION, SIGNALS, dashState, recentOf } from "./test-fixtures";
import { engineSession } from "@/components/fight-session/test-support";
import type { MatchResult } from "@/domain/sf6/types";
import { pickRatingCharacter, toLiveSessionState } from "@/domain/overlay/state";
import {
  DEFAULT_SESSION_FILTER,
  summarizeSession,
  type SessionMatch,
} from "@/domain/session/engine";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../actions", () => ({ startSessionAction: vi.fn(), endSessionAction: vi.fn() }));

const render = (state: DashboardLiveState, node: ReactNode, locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <LiveDashboardProvider initial={state}>{node}</LiveDashboardProvider>
    </NextIntlClientProvider>,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const area = (state: DashboardLiveState, locale: "es" | "en" = "es") =>
  render(state, <FightSessionArea />, locale);
const startTag = (html: string) => /<button[^>]*data-k="start"[^>]*>/.exec(html)?.[0] ?? "";

describe("PREPARE", () => {
  it("ready Companion: dominant enabled CTA, what will be tracked, character context", () => {
    const html = area(dashState(SESSION.none()));
    const t = text(html);
    expect(t).toContain("Listo para jugar");
    expect(startTag(html)).not.toContain("disabled");
    expect(startTag(html)).toContain('aria-describedby="fs-start-tracked"');
    expect(t).toContain("Al iniciar, SST registra tus partidas Ranked");
    expect(t).toContain("Ryu");
    expect(t).toContain("Aún no has jugado ninguna sesión con SST.");
    expect(html.match(/data-k="start"/g)).toHaveLength(1); // one primary CTA, never two
  });
  it("Companion not paired: blocked, CTA disabled, exact next step + link to the Companion", () => {
    const html = area(dashState(SESSION.none(), { signals: SIGNALS.unpaired }));
    const t = text(html);
    expect(t).toContain("No listo");
    expect(startTag(html)).toContain("disabled");
    expect(startTag(html)).toContain('aria-describedby="fs-start-why"');
    expect(t).toContain("Vincula el Companion");
    expect(html).toContain('href="#companion"');
  });
  it("paired but Buckler never synced is NOT ready (pairing ≠ Buckler)", () => {
    const html = area(dashState(SESSION.none(), { signals: SIGNALS.bucklerNever }));
    expect(startTag(html)).toContain("disabled");
    expect(text(html)).toContain("Inicia sesión en Buckler");
  });
  it("stale baseline data blocks the start like the server would", () => {
    const html = area(dashState(SESSION.none(), { signals: SIGNALS.stale }));
    expect(startTag(html)).toContain("disabled");
    expect(text(html)).toContain("Esperando una sincronización reciente");
  });
  it("Companion quiet: tells the user to open the Companion browser", () => {
    const t = text(area(dashState(SESSION.none(), { signals: SIGNALS.quiet })));
    expect(t).toContain("No hemos recibido datos del Companion recientemente");
  });
  it("after a session: 'prepare another' with the last session's results and its recap link", () => {
    const state = dashState(SESSION.ended());
    const html = area(state);
    const t = text(html);
    expect(t).toContain("Listo para jugar"); // not "Sesión finalizada" as if it were current
    expect(t).toContain("Tu última sesión");
    expect(t).toMatch(/Partidas\s+3\s+Victorias\s+2\s+Derrotas\s+1/);
    expect(html).toContain(`href="/dashboard/sessions/${state.live.session.sessionId}"`);
  });
  it("English", () => {
    const t = text(area(dashState(SESSION.none(), { signals: SIGNALS.unpaired }), "en"));
    expect(t).toContain("Not ready");
    expect(t).toContain("Start game session");
  });
});

describe("LIVE", () => {
  const live = (state: DashboardLiveState) => text(area(state));

  it("zero matches: 0 · — · 0, waiting state, End control, no second start action", () => {
    const html = area(dashState(engineSession({ results: [] }), { recent: true }));
    const t = text(html);
    expect(t).toContain("Sesión activa");
    expect(html).toMatch(/data-testid="fs-winrate">—</);
    expect(t).toContain("Esperando tu primera partida Ranked…");
    expect(html).toContain('data-k="end"');
    expect(t).not.toContain("Iniciar nueva sesión");
    expect(t).not.toContain("Iniciar sesión de juego");
    expect(html.match(/id="session"/g)).toHaveLength(1);
  });
  it("one win: scoreboard, last match, strip", () => {
    const t = live(
      dashState(engineSession({ results: ["win"], snapshot: { value: 1583, after: 0 } }), {
        recent: true,
      }),
    );
    expect(t).toContain("1 victorias, 0 derrotas, 100 % de victorias en 1 partida");
    expect(t).toContain("Victoria vs Ken");
    expect(t).toMatch(/Partidas\s+1\s+V/);
  });
  it("one loss", () => {
    const t = live(
      dashState(engineSession({ results: ["loss"], snapshot: { value: 1560, after: 0 } }), {
        recent: true,
      }),
    );
    expect(t).toContain("0 victorias, 1 derrotas, 0 % de victorias en 1 partida");
    expect(t).toContain("Derrota vs Ken");
  });
  it("mixed results: engine totals and win rate; strip numbered by session position", () => {
    const results: MatchResult[] = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? "loss" : "win",
    );
    const session = engineSession({ results, snapshot: { value: 1600, after: 11 } });
    const html = area(dashState(session, { recent: true }));
    const t = text(html);
    expect(t).toContain(`8 victorias, 4 derrotas, 66,7 % de victorias en 12 partidas`);
    expect(html).toContain('aria-label="Partida 3: Victoria"');
    expect(html).toContain('aria-label="Partida 12: Victoria"');
    expect(html).toContain('aria-label="Partida 10: Derrota"');
    expect(html).not.toContain('aria-label="Partida 2:');
  });
  it("MR: start → now with the engine's session delta", () => {
    const t = live(
      dashState(engineSession({ results: ["win", "win"], snapshot: { value: 1594, after: 1 } }), {
        recent: true,
      }),
    );
    expect(t).toMatch(/Ryu\s+desde\s+1571\s+1594\s+MR\s+Cambio en la sesión\s*:\s+▲\s+\+23/);
  });
  it("LP keeps its unit and grouping", () => {
    const s = engineSession({
      results: ["win"],
      system: "lp",
      baseline: 21850,
      snapshot: { value: 21950, after: 0 },
    });
    expect(live(dashState(s, { recent: true }))).toMatch(/21\.850\s+21\.950\s+LP/);
  });
  it("Jamie case: pending post-match LP is the LAST CONFIRMED value, labelled, never a bare 'current'", () => {
    // Session start 23 000 LP; profile observed after match 1 (23 152); match 2 ingested from the
    // battlelog, no profile since ⇒ the engine's current is unknown, the held value is 23 152.
    const s = engineSession({
      results: ["win", "win"],
      system: "lp",
      baseline: 23000,
      snapshot: { value: 23152, after: 0 },
    });
    expect(pickRatingCharacter(s)?.current).toBeNull();
    const t = live(dashState(s, { recent: true }));
    expect(t).toContain("23.152");
    expect(t).toContain("LP pendiente · último confirmado");
    expect(t.match(/23\.152/g)).toHaveLength(1); // one rating presentation, the labelled one
  });
  it("unknown rating (no observation, no baseline): no number is invented", () => {
    const s = engineSession({ results: ["win"], baseline: null, snapshot: null });
    const t = live(dashState(s, { recent: true }));
    expect(t).not.toMatch(/\d{4}\s+MR/);
  });
  it("character switch: each character's own rating, systems never mixed, latest first", () => {
    const START = new Date("2026-10-21T19:30:00Z");
    const at = (m: number) => new Date(START.getTime() + m * 60_000);
    const mk = (id: string, min: number, key: string, name: string): SessionMatch => ({
      externalMatchId: id,
      playedAt: at(min),
      mode: "ranked",
      result: "win",
      characterKey: key,
      characterName: name,
      opponentCharacter: "Ken",
      opponentName: null,
    });
    const summary = summarizeSession({
      status: "active",
      ratingModel: "per_character",
      baseline: {
        startedAt: START,
        endedAt: null,
        baselineMatchId: null,
        baselinePlayedAt: null,
        filter: DEFAULT_SESSION_FILTER,
      },
      matches: [mk("a", 6, "ryu", "Ryu"), mk("b", 12, "jamie", "Jamie")],
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
          rating: { system: "lp", value: 23000, rank: null },
          capturedAt: START,
        },
      ],
      current: [
        {
          characterKey: "ryu",
          characterName: "Ryu",
          rating: { system: "mr", value: 1583, rank: null },
          observedAt: at(13),
        },
        {
          characterKey: "jamie",
          characterName: "Jamie",
          rating: { system: "lp", value: 23100, rank: null },
          observedAt: at(13),
        },
      ],
      favoriteCharacterKey: "ryu",
    });
    const s = toLiveSessionState("s2", summary, { characters: [], activeCharacterKey: null });
    const t = live(dashState(s));
    const jamie = t.indexOf("Jamie desde");
    const ryu = t.indexOf("Ryu desde");
    expect(jamie).toBeGreaterThan(-1);
    expect(ryu).toBeGreaterThan(jamie); // active (latest match) first
    expect(t).toMatch(/Jamie desde\s+23\.000\s+23\.100\s+LP\s+Cambio en la sesión\s*:\s+▲\s+\+100/);
    expect(t).toMatch(/Ryu desde\s+1571\s+1583\s+MR\s+Cambio en la sesión\s*:\s+▲\s+\+12/);
  });
  it("missing opponent is said; no per-match rating anywhere in the activity", () => {
    const s = engineSession({ results: ["win"], snapshot: { value: 1583, after: 0 } });
    const [m] = recentOf(s);
    const t = live(
      dashState(s, { recent: [{ ...m!, opponentCharacter: null, opponentName: null }] }),
    );
    expect(t).toContain("Victoria vs Rival desconocido");
    const activity = t.slice(t.indexOf("Última partida"));
    expect(activity).not.toMatch(/\d{4}\s*(MR|LP)/);
  });
  it("older payload without the projection: strip from the engine's recent form, no fake last match", () => {
    const s = engineSession({ results: ["win", "loss"], snapshot: { value: 1570, after: 1 } });
    const html = area(dashState(s));
    expect(text(html)).toContain("La última partida aún no está disponible.");
    expect(html).toContain('aria-label="Partida 2: Derrota"');
  });
  it("tracking unavailable (tracker degraded / Companion quiet) is said, the session stays active", () => {
    expect(live(dashState(SESSION.active(), { tracker: "degraded", recent: true }))).toContain(
      "Sin datos recientes",
    );
    expect(live(dashState(SESSION.active(), { signals: SIGNALS.quiet, recent: true }))).toContain(
      "Sin datos recientes",
    );
  });
});

describe("status strip", () => {
  it("authoritative fields only; overlays count + OBS sources; jump to overlays", () => {
    const html = render(dashState(SESSION.none()), <FightStatusStrip overlayCount={2} />);
    const t = text(html);
    // Phase 5.6D: one tracking answer; Companion/Buckler details live in the Companion module.
    expect(t).toMatch(/Seguimiento\s+● Listo para registrar/);
    expect(t).not.toContain("Ver diagnóstico");
    expect(t).toContain("2 overlays");
    expect(t).toContain("1 fuente en OBS");
    expect(html).toContain('href="#overlays"');
    // No clock on the server render: no invented "x s ago"; no live link warning before connecting.
    expect(t).not.toContain("hace");
    expect(t).not.toContain("Reconectando");
  });
  it("disconnected Companion is never shown as connected", () => {
    const t = text(
      render(
        dashState(SESSION.none(), { signals: SIGNALS.unpaired }),
        <FightStatusStrip overlayCount={0} />,
        "en",
      ),
    );
    expect(t).toMatch(/Needs attention\s*: Companion disconnected/);
    expect(t).toContain("View diagnostics");
    expect(t).not.toMatch(/\bConnected\b|Ready to track/);
  });
  it("tracking states: paired ≠ tracking; Buckler, stale data, silence and LIVE are each named", () => {
    const strip = (state: Parameters<typeof dashState>[0], signals: CompanionSignals) =>
      text(render(dashState(state, { signals }), <FightStatusStrip overlayCount={1} />));
    expect(strip(SESSION.none(), SIGNALS.bucklerNever)).toMatch(
      /Requiere atención\s*: Inicia sesión en Buckler/,
    );
    expect(strip(SESSION.none(), SIGNALS.stale)).toContain("Esperando sincronización");
    expect(strip(SESSION.none(), SIGNALS.quiet)).toContain("Companion sin señal");
    expect(strip(SESSION.active(), SIGNALS.ready)).toContain("Registrando partidas");
    expect(strip(SESSION.active(), SIGNALS.quiet)).not.toContain("Registrando partidas");
    for (const s of [SIGNALS.bucklerNever, SIGNALS.stale, SIGNALS.quiet])
      expect(strip(SESSION.none(), s)).toContain("Ver diagnóstico");
  });
});

describe("classic dashboard regression", () => {
  it("SessionPanel default keeps every classic action (incl. its own start-new button)", () => {
    const t = text(render(dashState(SESSION.active()), <SessionPanel />));
    expect(t).toContain("Finalizar sesión");
    expect(t).toContain("Iniciar nueva sesión");
  });
  it("classic PREPARE still renders its checklist and start button", () => {
    const html = render(dashState(SESSION.none()), <SessionPanel />);
    expect(text(html)).toContain("Iniciar sesión de juego");
    expect(html).toContain('id="session"');
  });
  it("statistics-only mode hides start/end controls and the checklist", () => {
    const active = text(render(dashState(SESSION.active()), <SessionPanel actions={false} />));
    expect(active).not.toContain("Finalizar sesión");
    expect(active).not.toContain("Iniciar nueva sesión");
    const idle = text(render(dashState(SESSION.none()), <SessionPanel actions={false} />));
    expect(idle).not.toContain("Iniciar sesión de juego");
  });
});
