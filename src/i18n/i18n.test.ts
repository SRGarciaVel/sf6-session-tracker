import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAY_CONFIG, parseOverlayConfig } from "@/domain/overlay/config";
import { DEFAULT_LOCALE, isLocale, mergeMessages, resolveLocale, type Messages } from "./locale";
import { RAW_APP_CATALOGS, getAppMessages } from "./messages";
import { RAW_OVERLAY_CATALOGS, getOverlayMessages } from "./overlay-messages";

/** Concrete catalog shape so createTranslator can type-check keys. */
type AppCatalog = typeof import("./messages/en.json");
const typed = (m: Messages) => m as unknown as AppCatalog;

function keys(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe("locale resolution", () => {
  it("defaults to Spanish", () => {
    expect(DEFAULT_LOCALE).toBe("es");
    expect(resolveLocale({})).toBe("es");
    expect(resolveLocale({ userLocale: null, cookieLocale: null })).toBe("es");
  });

  it("switches to English from an explicit cookie choice", () => {
    expect(resolveLocale({ cookieLocale: "en" })).toBe("en");
  });

  it("the account preference wins over the cookie (persists across browsers)", () => {
    expect(resolveLocale({ userLocale: "en", cookieLocale: "es" })).toBe("en");
    expect(resolveLocale({ userLocale: "es", cookieLocale: "en" })).toBe("es");
  });

  it("ignores invalid / tampered values", () => {
    expect(resolveLocale({ userLocale: "fr", cookieLocale: "<script>" })).toBe("es");
    expect(isLocale("EN")).toBe(false);
  });
});

describe("catalogs", () => {
  it("es and en app catalogs have exactly the same keys", () => {
    expect(keys(RAW_APP_CATALOGS.es).sort()).toEqual(keys(RAW_APP_CATALOGS.en).sort());
  });

  it("es and en overlay catalogs have exactly the same keys", () => {
    expect(keys(RAW_OVERLAY_CATALOGS.es).sort()).toEqual(keys(RAW_OVERLAY_CATALOGS.en).sort());
  });

  it("uses natural Spanish for key UI strings", () => {
    const t = createTranslator({ locale: "es", messages: typed(getAppMessages("es")) });
    expect(t("Dashboard.session.title")).toBe("Sesión actual");
    expect(t("Dashboard.session.startNewSession")).toBe("Iniciar nueva sesión");
    expect(t("Dashboard.session.endSession")).toBe("Finalizar sesión");
    expect(t("Dashboard.history.title")).toBe("Historial de sesiones");
    expect(t("Dashboard.session.winRate")).toBe("Porcentaje de victorias");
    expect(t("Dashboard.session.games", { count: 1 })).toBe("1 partida");
    expect(t("Dashboard.session.games", { count: 3 })).toBe("3 partidas");
  });

  it("keeps official game terms untranslated", () => {
    const t = createTranslator({ locale: "es", messages: typed(getAppMessages("es")) });
    expect(t("Dashboard.session.ratingChange", { unit: "MR" })).toBe("Cambio de MR");
    expect(t("Landing.eyebrow")).toContain("Street Fighter 6");
    expect(t("Onboarding.cfnLabel")).toBe("CFN User ID");
  });
});

describe("fallback for missing translations", () => {
  it("mergeMessages falls back to the base catalog for missing keys", () => {
    const merged = mergeMessages(
      { A: { x: "base x", y: "base y" }, B: "base b" },
      { A: { x: "override x" } },
    );
    expect(merged).toEqual({ A: { x: "override x", y: "base y" }, B: "base b" });
  });

  it("a key missing in Spanish renders the English text, not the raw key", () => {
    const partialEs = structuredClone(RAW_APP_CATALOGS.es);
    const session = (partialEs.Dashboard as Messages).session as Messages;
    delete session.title;
    const t = createTranslator({
      locale: "es",
      messages: typed(mergeMessages(RAW_APP_CATALOGS.en, partialEs)),
    });
    expect(t("Dashboard.session.title")).toBe("Current session");
    expect(t("Dashboard.session.endSession")).toBe("Finalizar sesión");
  });

  it("every locale exposes every English key after merging", () => {
    const enKeys = keys(getAppMessages("en"));
    expect(keys(getAppMessages("es")).sort()).toEqual(enKeys.sort());
    expect(keys(getOverlayMessages("es")).sort()).toEqual(keys(getOverlayMessages("en")).sort());
  });
});

describe("overlay locale config", () => {
  it("defaults to Spanish and validates the value", () => {
    expect(DEFAULT_OVERLAY_CONFIG.locale).toBe("es");
    expect(parseOverlayConfig({ locale: "en" }).locale).toBe("en");
    expect(parseOverlayConfig({ locale: "jp" })).toEqual(DEFAULT_OVERLAY_CONFIG);
  });

  it("migrates pre-i18n configs: stored default title becomes the localized default", () => {
    const legacy = parseOverlayConfig({ theme: "competitive", title: "SESSION" });
    expect(legacy.locale).toBe("es");
    expect(legacy.title).toBe("");
    expect(legacy.showTitle).toBe(true);
    // A custom title is kept, and a new-style config keeps "SESSION" if the user typed it.
    expect(parseOverlayConfig({ title: "RANKED GRIND" }).title).toBe("RANKED GRIND");
    expect(parseOverlayConfig({ title: "SESSION", locale: "en" }).title).toBe("SESSION");
  });
});
