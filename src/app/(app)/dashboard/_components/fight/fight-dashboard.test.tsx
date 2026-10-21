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
import type { DashboardLiveState } from "@/server/dashboard/state";
import { LiveDashboardProvider } from "../LiveDashboard";
import { SessionPanel } from "../SessionPanel";
import { FightSessionArea, FightStatusStrip } from "./FightSessionDashboard";
import { SESSION, SIGNALS, dashState } from "./test-fixtures";

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

describe("ACTIVE (intermediate B2 view)", () => {
  it("session active: status, End control, classic statistics without a second start action", () => {
    const html = area(dashState(SESSION.active()));
    const t = text(html);
    expect(t).toContain("Sesión activa");
    expect(t).toContain("Sesión en juego");
    expect(html).toContain('data-k="end"');
    expect(t).not.toContain("Iniciar nueva sesión");
    expect(t).not.toContain("Iniciar sesión de juego");
    expect(t).toContain("Porcentaje de victorias"); // the classic stats panel
    expect(html.match(/id="session"/g)).toHaveLength(1);
  });
  it("tracking unavailable (tracker degraded / Companion quiet) is said, the session stays active", () => {
    expect(text(area(dashState(SESSION.active(), { tracker: "degraded" })))).toContain(
      "Sin datos recientes",
    );
    expect(text(area(dashState(SESSION.active(), { signals: SIGNALS.quiet })))).toContain(
      "Sin datos recientes",
    );
  });
});

describe("status strip", () => {
  it("authoritative fields only; overlays count + OBS sources; jump to overlays", () => {
    const html = render(dashState(SESSION.none()), <FightStatusStrip overlayCount={2} />);
    const t = text(html);
    expect(t).toContain("Companion");
    expect(t).toContain("Conectado");
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
    expect(t).toContain("Companion disconnected");
    expect(t).toContain("Not synced yet");
    expect(t).not.toMatch(/\bConnected\b/);
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
