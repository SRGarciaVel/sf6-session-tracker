// @vitest-environment happy-dom
/**
 * Phase 5.5 — Session builder: rating transition mode + count speed are real radio groups in the
 * Style tab, mark the overlay unsaved, are sent by the existing save action, and are restored
 * from the stored config (legacy configs show "Instant"). ES / EN.
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

describe("Session builder: rating transition", () => {
  it("new overlay: Count + Normal; speed only for Count; edits are saved", async () => {
    saveOverlayAction.mockResolvedValue({ ok: true, data: undefined });
    const b = mount(DEFAULT_OVERLAY_CONFIG);
    expect(b.radios("rating-transition").map((r) => r.textContent)).toEqual([
      "Count",
      "Fade",
      "Instant",
    ]);
    expect(b.checked("rating-transition")).toBe("Count");
    expect(b.checked("rating-transition-speed")).toBe("Normal");

    act(() => b.radios("rating-transition-speed")[2]!.click()); // Slow
    expect(b.state()).toBe("unsaved");
    act(() => b.radios("rating-transition")[1]!.click()); // Fade
    expect(b.q("rating-transition-speed")).toBeNull();

    await act(async () => b.q("save-button")!.click());
    const [, body] = saveOverlayAction.mock.calls[0] as [string, { config: SessionOverlayConfig }];
    expect(body.config).toMatchObject({ ratingTransition: "fade", ratingTransitionSpeed: "slow" });
    expect(b.state()).toBe("saved");
  });

  it("a stored config is restored as saved; a legacy one shows Instant (its real behaviour)", () => {
    const saved = mount({
      ...DEFAULT_OVERLAY_CONFIG,
      ratingTransition: "count",
      ratingTransitionSpeed: "fast",
    });
    expect(saved.checked("rating-transition")).toBe("Count");
    expect(saved.checked("rating-transition-speed")).toBe("Fast");
    act(() => root?.unmount());
    root = null;
    host.remove();

    const legacy: Record<string, unknown> = { ...DEFAULT_OVERLAY_CONFIG };
    delete legacy.ratingTransition;
    delete legacy.ratingTransitionSpeed;
    const b = mount(sessionConfigOf(parseOverlayConfig(legacy))!);
    expect(b.checked("rating-transition")).toBe("Instant");
    expect(b.state()).toBe("saved"); // reading it changes nothing
  });

  it("ES labels and the 'animations off' hint", () => {
    const b = mount({ ...DEFAULT_OVERLAY_CONFIG, animations: false }, "es");
    expect(b.radios("rating-transition").map((r) => r.textContent)).toEqual([
      "Contar",
      "Fundido",
      "Instantáneo",
    ]);
    expect(b.q("rating-transition")?.textContent).toContain("«Animar cambios» está desactivado");
    expect(b.q("rating-transition-speed")?.textContent).toContain("Velocidad del conteo");
  });
});
