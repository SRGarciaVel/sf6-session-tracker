import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({
  createCompanionCodeAction: vi.fn(),
  revokeCompanionDeviceAction: vi.fn(),
}));

const { CompanionPanel, CompanionVersionStatus, PairingCodeBox } = await import("./CompanionPanel");

const devices = [
  { id: "d1", name: "Brave", lastSeenAt: "2026-10-04T10:00:00.000Z", clientVersion: "0.1.0" },
  { id: "d2", name: "Edge", lastSeenAt: null, clientVersion: null },
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

describe("companion version / update notice", () => {
  const DL = "https://github.com/o/r/releases/latest/download/sf6-session-companion-beta.zip";
  const status = (
    installed: string | null,
    latestVersion: string | null,
    downloadUrl: string | null = DL,
  ) =>
    renderToString(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <CompanionVersionStatus installed={installed} release={{ latestVersion, downloadUrl }} />
      </NextIntlClientProvider>,
    );

  it("up to date", () => {
    const html = status("0.1.1", "0.1.1");
    expect(html).toContain("Versión instalada: v0.1.1");
    expect(html).toContain("✓ Companion actualizado");
    expect(html).not.toContain("Nueva versión");
  });

  it("older installed ⇒ update CTA with the stable download URL and the how-to link", () => {
    const html = status("0.1.9", "0.1.10");
    expect(html).toContain("⚡ Nueva versión disponible: v0.1.10");
    expect(html).toContain(`href="${DL}"`);
    expect(html).toContain("↓ Descargar actualización");
    expect(html).toContain('href="/help/companion#actualizar"');
  });

  it("no download URL ⇒ still explains how to update", () => {
    const html = status("0.1.0", "0.1.1", null);
    expect(html).toContain("Nueva versión disponible");
    expect(html).not.toContain("Descargar actualización");
    expect(html).toContain("Ver cómo actualizar");
  });

  it("newer installed, invalid or missing latest ⇒ no update CTA", () => {
    for (const [installed, latest] of [
      ["0.2.0", "0.1.9"],
      ["0.1.0", "latest"],
      ["0.1.0", null],
    ] as const) {
      const html = status(installed, latest);
      expect(html, `${installed} vs ${latest}`).not.toContain("Nueva versión");
      expect(html).toContain(`Versión instalada: v${installed}`);
    }
  });

  it("unknown installed version is calm, not an error", () => {
    const html = status(null, "0.1.1");
    expect(html).toContain("Versión instalada no disponible todavía.");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Nueva versión");
  });
});
