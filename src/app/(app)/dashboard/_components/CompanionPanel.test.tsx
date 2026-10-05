import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({
  createCompanionCodeAction: vi.fn(),
  revokeCompanionDeviceAction: vi.fn(),
}));

const { CompanionPanel, PairingCodeBox } = await import("./CompanionPanel");

const devices = [
  { id: "d1", name: "Brave", lastSeenAt: "2026-10-04T10:00:00.000Z" },
  { id: "d2", name: "Edge", lastSeenAt: null },
];

function render() {
  return renderToString(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      <CompanionPanel devices={devices} ingestEnabled />
    </NextIntlClientProvider>,
  );
}

describe("CompanionPanel hydration", () => {
  afterEach(() => vi.useRealTimers());

  it("first render does not depend on the clock (server and client agree)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T10:00:03Z")); // "server" render: 3 s after lastSeen
    const server = render();
    vi.setSystemTime(new Date("2026-10-04T10:00:04Z")); // "client" hydration one second later
    const client = render();
    expect(client).toBe(server);
    expect(server).not.toMatch(/hace \d+ s/); // no clock-derived text before mount
    expect(server).toContain("sin actividad"); // device never seen: static label
  });
});

describe("pairing code box", () => {
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const box = (expiresInMs: number, now: number | null = NOW) =>
    renderToString(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <PairingCodeBox
          code={{ code: "ABCD-EFGH", expiresAt: new Date(NOW + expiresInMs).toISOString() }}
          now={now}
          onRegenerate={() => undefined}
          pending={false}
        />
      </NextIntlClientProvider>,
    );

  it("shows the code, a keyboard-reachable copy button and the real time left", () => {
    const markup = box(9 * 60_000 + 30_000);
    expect(markup).toContain("ABCD-EFGH");
    expect(markup).toMatch(
      /<button[^>]*aria-label="Copiar código de vinculación"[^>]*>Copiar código<\/button>/,
    );
    expect(markup).toContain("Caduca en 10 minutos");
  });

  it("last minute", () => {
    expect(box(30_000)).toContain("Caduca en menos de un minuto");
  });

  it("expired: hides the code and offers a new one without reloading", () => {
    const markup = box(-1);
    expect(markup).toContain("Código expirado");
    expect(markup).toContain("Generar nuevo código");
    expect(markup).not.toContain("ABCD-EFGH");
  });

  it("before the clock starts it states the fixed 10-minute validity (no invented countdown)", () => {
    expect(box(5 * 60_000, null)).toContain("Caduca en 10 minutos");
  });
});
