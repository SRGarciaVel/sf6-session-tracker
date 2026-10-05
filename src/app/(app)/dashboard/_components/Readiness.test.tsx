import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assessCompanion, type CompanionSignals } from "@/domain/companion/readiness";
import es from "@/i18n/messages/es.json";
import { CompanionStatusRows, StartChecklist } from "./Readiness";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const base: CompanionSignals = {
  required: true,
  deviceCount: 1,
  lastSeenAt: ago(10_000),
  profileObservedAt: ago(20_000),
  matchesObservedAt: ago(20_000),
  hasProfile: true,
  characterCount: 2,
  maxAgeMs: 300_000,
  serverTime: new Date(NOW).toISOString(),
};

const html = (node: ReactNode) =>
  renderToString(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );

const checklist = (signals: CompanionSignals) =>
  html(
    <StartChecklist
      readiness={assessCompanion(signals, NOW)}
      onStart={vi.fn()}
      pending={false}
      startLabel="Iniciar sesión de juego"
      pendingLabel="Iniciando…"
    />,
  );

/** The start button's opening tag. */
const startButton = (markup: string) =>
  /<button[^>]*>Iniciar sesión de juego<\/button>/.exec(markup)?.[0] ?? "";

describe("pre-session checklist", () => {
  it("everything ready ⇒ start enabled, all items checked", () => {
    const markup = checklist(base);
    expect(startButton(markup)).not.toContain("disabled");
    expect(markup).toContain("Todo listo");
    expect(markup.match(/✓/g)).toHaveLength(4);
  });

  it("companion not paired ⇒ start disabled and says exactly what to do", () => {
    const markup = checklist({
      ...base,
      deviceCount: 0,
      lastSeenAt: null,
      profileObservedAt: null,
      matchesObservedAt: null,
      hasProfile: false,
      characterCount: 0,
    });
    expect(startButton(markup)).toContain("disabled");
    expect(markup).toContain("Conectar Companion");
    expect(markup).not.toContain("Error");
  });

  it("never logged in to Buckler ⇒ disabled with the Buckler step", () => {
    const markup = checklist({ ...base, profileObservedAt: null, matchesObservedAt: null });
    expect(startButton(markup)).toContain("disabled");
    expect(markup).toContain("Probar conexión con Buckler");
  });

  it("stale data ⇒ disabled, asks for a sync", () => {
    const markup = checklist({ ...base, matchesObservedAt: ago(400_000) });
    expect(startButton(markup)).toContain("disabled");
    expect(markup).toContain("Sincronizar ahora");
  });

  it("no character yet is not blocking", () => {
    const markup = checklist({ ...base, characterCount: 0 });
    expect(startButton(markup)).not.toContain("disabled");
    expect(markup).toContain("no impide jugar");
  });

  it("pending start shows progress and blocks double clicks", () => {
    const markup = html(
      <StartChecklist
        readiness={assessCompanion(base, NOW)}
        onStart={vi.fn()}
        pending
        startLabel="Iniciar sesión de juego"
        pendingLabel="Iniciando…"
      />,
    );
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Iniciando…<\/button>/);
  });
});

describe("companion status rows", () => {
  const rows = (signals: CompanionSignals) =>
    html(<CompanionStatusRows readiness={assessCompanion(signals, NOW)} />);

  it("connected + logged in", () => {
    const markup = rows(base);
    expect(markup).toContain("Conectado");
    expect(markup).toContain("Sesión iniciada");
  });
  it("not paired hides Buckler (nothing to say yet)", () => {
    const markup = rows({ ...base, deviceCount: 0, lastSeenAt: null });
    expect(markup).toContain("Companion no conectado");
    expect(markup).not.toContain("Buckler");
  });
  it("quiet companion / never logged in / stale sync", () => {
    expect(rows({ ...base, lastSeenAt: ago(600_000) })).toContain(
      "Sin datos recientes del Companion",
    );
    expect(rows({ ...base, matchesObservedAt: null })).toContain("Inicia sesión en Buckler");
    expect(rows({ ...base, matchesObservedAt: ago(400_000) })).toContain(
      "Esperando una sincronización reciente",
    );
  });
  it("states carry a glyph, not only a color", () => {
    expect(rows(base)).toContain("●");
    expect(rows({ ...base, matchesObservedAt: null })).toContain("⚠");
  });
});
