// @vitest-environment happy-dom
/**
 * M2D — Session builder: the character plate setting is a labelled radio group (Content tab,
 * beside the rating character), marks the overlay unsaved, is sent by the existing owner save
 * action, is restored from the stored config, and a legacy config shows its real state (Off).
 * ES / EN.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  parseOverlayConfig,
  sessionConfigOf,
  type SessionOverlayConfig,
} from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saveOverlayAction = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("../../actions", () => ({
  applyPresetAction: vi.fn(),
  createPresetAction: vi.fn(),
  deletePresetAction: vi.fn(),
  duplicatePresetAction: vi.fn(),
  renamePresetAction: vi.fn(),
  updatePresetAction: vi.fn(),
  saveOverlayAction: (...args: unknown[]) => saveOverlayAction(...args),
  deleteOverlayAction: vi.fn(),
  rotateOverlayTokenAction: vi.fn(),
}));
vi.mock("../../_components/LiveDashboard", () => ({
  useLiveDashboard: () => ({ state: { live: sampleLiveState() }, stream: "open" }),
}));
if (typeof ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

const { OverlayBuilder } = await import("./OverlayBuilder");

const FREE = {
  advancedCustomization: false,
  premiumThemes: false,
  creatorPresets: false,
  motionEffects: false,
  characterRotation: false,
  brandFlag: false,
};

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => saveOverlayAction.mockReset());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

function mount(config: SessionOverlayConfig, locale: "es" | "en" = "en") {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
        <OverlayBuilder
          overlayId="00000000-0000-4000-8000-0000000000aa"
          initialName="Overlay"
          initialConfig={config}
          url="https://sst.example/overlay/tok"
          access={FREE}
          presets={[]}
        />
      </NextIntlClientProvider>,
    );
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const radios = (id: string) => [
    ...(q(id)?.querySelectorAll<HTMLElement>('[role="radio"]') ?? []),
  ];
  const checked = (id: string) =>
    radios(id).find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
  return { q, radios, checked, state: () => q("save-state")?.getAttribute("data-state") };
}

describe("Session builder: character plate", () => {
  it("new overlay: Automatic; switching to Off is saved through the existing action", async () => {
    saveOverlayAction.mockResolvedValue({ ok: true, data: undefined });
    const b = mount(DEFAULT_OVERLAY_CONFIG);
    expect(b.radios("identity-plate").map((r) => r.textContent)).toEqual(["Automatic", "Off"]);
    expect(b.checked("identity-plate")).toBe("Automatic");
    const group = b.q("identity-plate")?.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-labelledby")).toBe("identity-plate-label");
    expect(host.querySelector("#identity-plate-label")?.textContent).toBe("Character plate");

    act(() => b.radios("identity-plate")[1]!.click());
    expect(b.state()).toBe("unsaved");
    await act(async () => b.q("save-button")!.click());
    const [id, body] = saveOverlayAction.mock.calls[0] as [
      string,
      { config: SessionOverlayConfig },
    ];
    expect(id).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(body.config.identityPlate).toBe("off");
    expect(b.state()).toBe("saved");
  });

  it("a stored Off is restored; a legacy config (no setting) shows Off, its real behaviour", () => {
    const saved = mount({ ...DEFAULT_OVERLAY_CONFIG, identityPlate: "off" });
    expect(saved.checked("identity-plate")).toBe("Off");
    act(() => root?.unmount());
    root = null;
    host.remove();

    const legacy: Record<string, unknown> = { ...DEFAULT_OVERLAY_CONFIG };
    delete legacy.identityPlate;
    const b = mount(sessionConfigOf(parseOverlayConfig(legacy))!);
    expect(b.checked("identity-plate")).toBe("Off");
    expect(b.state()).toBe("saved"); // reading it changes nothing
  });

  it("ES labels, and the hint says it is not a character illustration", () => {
    const b = mount(DEFAULT_OVERLAY_CONFIG, "es");
    expect(b.radios("identity-plate").map((r) => r.textContent)).toEqual([
      "Automática",
      "Desactivada",
    ]);
    expect(host.querySelector("#identity-plate-label")?.textContent).toBe("Placa del personaje");
    expect(b.q("identity-plate")?.textContent).toContain("No es una ilustración del personaje.");
  });

  it("EN hint", () => {
    const b = mount(DEFAULT_OVERLAY_CONFIG);
    expect(b.q("identity-plate")?.textContent).toContain("It is not a character illustration.");
  });
});
