import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("../../actions", () => ({
  applyPresetAction: vi.fn(),
  createPresetAction: vi.fn(),
  deletePresetAction: vi.fn(),
  duplicatePresetAction: vi.fn(),
  renamePresetAction: vi.fn(),
  updatePresetAction: vi.fn(),
}));

const { ThemePicker } = await import("./ThemePicker");
const { PresetsSection } = await import("./PresetsSection");

const wrap = (locale: "es" | "en", node: ReactNode) =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
const button = (html: string, theme: string) =>
  html.match(new RegExp(`<button[^>]*data-theme="${theme}"[^>]*>`))?.[0] ?? "";

describe("ThemePicker", () => {
  it("Free: every Free theme selectable, Creator themes visible but disabled, one discreet note", () => {
    const html = wrap(
      "en",
      <ThemePicker value="competitive" locale="en" premiumThemes={false} onSelect={() => {}} />,
    );
    for (const t of ["minimal", "competitive", "fighter"])
      expect(button(html, t)).not.toMatch(/ disabled=""/);
    for (const t of ["rank-card", "broadcast", "prestige"]) {
      expect(button(html, t)).toMatch(/ disabled=""/);
      expect(button(html, t)).toContain('aria-disabled="true"');
    }
    expect(html.match(/Creator Beta/g)?.length).toBe(3 + 1); // 3 badges + the note
    expect(html).toContain(en.Builder.creatorThemesNote);
    expect(html).not.toMatch(/🔒|padlock|lock-icon/i);
  });

  it("Creator: all six selectable; no note", () => {
    const html = wrap(
      "es",
      <ThemePicker value="rank-card" locale="es" premiumThemes onSelect={() => {}} />,
    );
    for (const t of ["minimal", "competitive", "fighter", "rank-card", "broadcast", "prestige"]) {
      expect(button(html, t)).not.toMatch(/ disabled=""/);
    }
    expect(button(html, "rank-card")).toContain('aria-pressed="true"');
    expect(html).not.toContain(es.Builder.creatorThemesNote);
  });

  it("downgraded with a stored Creator theme: saved message naming the Free fallback", () => {
    const html = wrap(
      "es",
      <ThemePicker value="prestige" locale="es" premiumThemes={false} onSelect={() => {}} />,
    );
    expect(html).toContain("Tu tema Creator «Prestige» está guardado");
    expect(html).toContain("muestran Street");
  });
});

describe("PresetsSection", () => {
  const presets = [
    { id: "00000000-0000-4000-8000-000000000001", name: "Gold look", theme: "prestige" as const },
    { id: "00000000-0000-4000-8000-000000000002", name: "Old", theme: null },
  ];
  const props = {
    overlayId: "00000000-0000-4000-8000-0000000000aa",
    config: DEFAULT_OVERLAY_CONFIG,
    dirty: false,
    onApplied: () => {},
  };

  it("downgraded: presets kept and listed, required message, only delete offered", () => {
    const html = wrap("en", <PresetsSection {...props} presets={presets} enabled={false} />);
    expect(html).toContain(
      "Your Creator presets are saved. Renew Creator access to use them again.",
    );
    expect(html).toContain("Gold look");
    expect(html).not.toContain(">Apply<");
    expect(html).not.toContain(">Rename<");
    expect(html).not.toContain(">Duplicate<");
    expect(html).not.toContain("Save current look");
    expect(html.match(/>Delete</g)?.length).toBe(2);
  });

  it("entitled: create form and all actions; invalid stored preset can only be deleted", () => {
    const html = wrap("es", <PresetsSection {...props} presets={presets} enabled />);
    expect(html).toContain("Guardar aspecto actual");
    expect(html.match(/>Aplicar</g)?.length).toBe(1);
    expect(html).toContain("No se puede aplicar (no válido)");
    expect(html).toContain("2/20");
  });

  it("Free without presets: invite note, no empty-state list, no create form", () => {
    const html = wrap("en", <PresetsSection {...props} presets={[]} enabled={false} />);
    expect(html).not.toContain("Your Creator presets are saved");
    expect(html).toContain(en.Builder.creator.inviteOnly);
    expect(html).not.toContain("preset-list");
  });
});
