import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import { CompanionDownload } from "./CompanionDownload";

const URL_ = "https://github.com/o/r/releases/latest/download/sf6-session-companion-beta.zip";
const render = (props: Parameters<typeof CompanionDownload>[0]) =>
  renderToString(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      <CompanionDownload {...props} />
    </NextIntlClientProvider>,
  );

describe("help: companion download", () => {
  it("configured URL ⇒ download button, available version and checksum link", () => {
    const html = render({
      downloadUrl: URL_,
      checksumUrl: URL_.replace(/\.zip$/, ".sha256"),
      latestVersion: "0.1.1",
    });
    expect(html).toContain(`href="${URL_}"`);
    expect(html).toContain("↓ Descargar Companion");
    expect(html).toContain("Versión disponible: v0.1.1");
    expect(html).toContain("sf6-session-companion-beta.sha256");
  });

  it("no version configured ⇒ button only, no invented version", () => {
    const html = render({ downloadUrl: URL_, checksumUrl: null, latestVersion: null });
    expect(html).toContain("↓ Descargar Companion");
    expect(html).not.toContain("Versión disponible");
  });

  it("no URL ⇒ current fallback", () => {
    const html = render({ downloadUrl: null, checksumUrl: null, latestVersion: "0.1.1" });
    expect(html).toContain("Pide el archivo ZIP");
    expect(html).not.toContain("<a");
  });
});
