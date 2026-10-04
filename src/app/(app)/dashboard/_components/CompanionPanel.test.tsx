import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({
  createCompanionCodeAction: vi.fn(),
  revokeCompanionDeviceAction: vi.fn(),
}));

const { CompanionPanel } = await import("./CompanionPanel");

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
