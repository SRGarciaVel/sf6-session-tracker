import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../actions", () => ({ redeemCreatorKeyAction: vi.fn() }));

const { CreatorBetaPanel } = await import("./CreatorBetaPanel");

const render = (
  locale: "es" | "en",
  props: { plan: "free" | "creator_beta"; activeUntil: string | null },
) =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <CreatorBetaPanel {...props} />
    </NextIntlClientProvider>,
  );

describe("CreatorBetaPanel", () => {
  it("free account: plan, intro without promises, redeem form (ES)", () => {
    const html = render("es", { plan: "free", activeUntil: null });
    expect(html).toContain('data-testid="plan-name">Free<');
    expect(html).toContain("Las funciones Creator irán llegando durante la beta");
    expect(html).toContain('placeholder="SST-XXXX-XXXX-XXXX-XXXX-XXXX"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/); // empty input
    expect(html).not.toMatch(/premium|tema/i);
  });

  it("creator_beta account shows the active-until date (EN)", () => {
    const html = render("en", { plan: "creator_beta", activeUntil: "2027-01-03T12:00:00.000Z" });
    expect(html).toContain('data-testid="plan-name">Creator Beta<');
    expect(html).toContain("Active until");
    expect(html).toContain('dateTime="2027-01-03T12:00:00.000Z"');
  });

  it("generic error copy exists in both languages and reveals no key state", () => {
    for (const msg of [es.Errors.creatorKeyInvalid, en.Errors.creatorKeyInvalid]) {
      expect(msg).not.toMatch(/expir|revoc|revok|usad|used|not found|no existe/i);
    }
  });
});
