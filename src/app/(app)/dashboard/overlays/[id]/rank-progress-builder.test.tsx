// @vitest-environment happy-dom
/**
 * Phase 5.4B — Rank Progress builder: OverlayBuilder dispatches by kind, the Session builder is
 * untouched, and the Rank Progress builder edits ONLY its own config (character, goal per rating
 * system, style, display toggles, appearance) with the shared dirty / save rules. Free: no
 * Creator tab, no presets.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import {
  DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG,
  type RankProgressOverlayConfig,
} from "@/domain/overlay/rank-progress";
import { sampleLiveState, type PlayerLiveState } from "@/domain/overlay/state";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const saveOverlayAction = vi.fn();
let live: PlayerLiveState = sampleLiveState({ rank: "Diamond 3", system: "lp", value: 21950 });

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
  useLiveDashboard: () => ({ state: { live }, stream: "open" }),
}));

const { OverlayBuilder } = await import("./OverlayBuilder");

const RP = DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG;
const CREATOR = {
  advancedCustomization: true,
  premiumThemes: true,
  creatorPresets: true,
  motionEffects: true,
  characterRotation: true,
  brandFlag: true,
};
const presets = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Gold look", theme: "prestige" as const },
];

const element = (
  config: RankProgressOverlayConfig | typeof DEFAULT_OVERLAY_CONFIG,
  locale = "en",
) => (
  <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
    <OverlayBuilder
      overlayId="00000000-0000-4000-8000-0000000000aa"
      initialName="Road to Master"
      initialConfig={config}
      url="https://sst.example/overlay/tok"
      access={CREATOR}
      presets={presets}
    />
  </NextIntlClientProvider>
);

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => {
  live = sampleLiveState({ rank: "Diamond 3", system: "lp", value: 21950 });
  saveOverlayAction.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
});

function mount(config: RankProgressOverlayConfig = RP, locale = "en") {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(element(config, locale));
  });
  const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const state = () => q("save-state")?.getAttribute("data-state");
  return { q, state };
}

describe("dispatch", () => {
  it("a Rank Progress config opens the Rank Progress builder (no tabs, no Creator, no presets)", () => {
    const html = renderToString(element(RP));
    expect(html).toContain('data-testid="rank-progress-builder"');
    expect(html).not.toMatch(/role="tab"/);
    expect(html).not.toMatch(/Creator|creator-presets|Gold look|data-testid="canvas-select"/);
    expect(html).toContain('data-testid="obs-output"');
    expect(html).toContain('data-testid="overlay-preview"');
    expect(html).toContain('data-kind="rank-progress"'); // real renderer in the preview
  });

  it("a Session config still opens the unchanged Session builder", () => {
    const html = renderToString(element(DEFAULT_OVERLAY_CONFIG));
    expect(html).not.toContain("rank-progress-builder");
    expect(html.match(/role="tab"/g)?.length).toBe(4);
  });
});

describe("controls", () => {
  it("character: auto + the roster; goal options for an LP character", () => {
    const { q } = mount();
    const select = q("rp-character") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Active character (auto)",
      "Ryu",
    ]);
    const goal = q("rp-goal")!;
    expect(goal.getAttribute("data-system")).toBe("lp");
    expect([...goal.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      "Next division",
      "Road to Master",
    ]);
  });

  it("an MR character only offers the next Master tier; a stored 'master' goal is explained", () => {
    live = sampleLiveState({ rank: "High Master", system: "mr", value: 1642 });
    const { q } = mount({ ...RP, goal: "master" });
    const goal = q("rp-goal")!;
    expect(goal.getAttribute("data-system")).toBe("mr");
    const radios = [...goal.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(["Next Master tier"]);
    expect(radios[0]?.getAttribute("aria-checked")).toBe("true");
    expect(goal.textContent).toContain("Road to Master applies to LP characters");
  });

  it("style cards are a radio group with their canvases", () => {
    const { q } = mount();
    expect(q("rp-style-broadcast")?.getAttribute("aria-checked")).toBe("true");
    expect(q("rp-style-compact")?.getAttribute("aria-checked")).toBe("false");
    expect(q("rp-style-compact")?.textContent).toContain("400×140");
  });
});

describe("editing, dirty state and save", () => {
  it("each edit marks the overlay unsaved; Save sends the Rank Progress config only", async () => {
    saveOverlayAction.mockResolvedValue({ ok: true, data: undefined });
    const { q, state } = mount();
    expect(state()).toBe("saved");

    act(() => q("rp-style-compact")!.click());
    expect(state()).toBe("unsaved");
    const masterGoal = [...q("rp-goal")!.querySelectorAll<HTMLElement>('[role="radio"]')][1]!;
    act(() => masterGoal.click());
    const switches = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
    act(() => switches[0]!.click()); // show character name → off
    // The preview follows the edits (compact style).
    expect(host.querySelector(".ov-rp-compact")).not.toBeNull();

    await act(async () => q("save-button")!.click());
    expect(saveOverlayAction).toHaveBeenCalledTimes(1);
    const [overlayId, body] = saveOverlayAction.mock.calls[0] as [
      string,
      { name: string; config: RankProgressOverlayConfig },
    ];
    expect(overlayId).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(body.config).toEqual({
      ...RP,
      style: "compact",
      goal: "master",
      showCharacterName: false,
    });
    expect(Object.keys(body.config)).not.toContain("theme");
    expect(state()).toBe("saved");
  });

  it("a failed save keeps the edits and reports it", async () => {
    saveOverlayAction.mockResolvedValue({ ok: false, error: "nope" });
    const { q, state } = mount();
    act(() => q("rp-style-compact")!.click());
    await act(async () => q("save-button")!.click());
    expect(state()).toBe("failed");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("nope");
    expect(q("rp-style-compact")?.getAttribute("aria-checked")).toBe("true");
  });

  it("discard restores the saved config", () => {
    const { q, state } = mount();
    act(() => q("rp-style-compact")!.click());
    const discard = [...host.querySelectorAll("button")].find((b) => b.textContent === "Discard")!;
    act(() => discard.click());
    expect(state()).toBe("saved");
    expect(q("rp-style-broadcast")?.getAttribute("aria-checked")).toBe("true");
  });

  it("preview data is preview-only (never marks the overlay dirty)", () => {
    const { q, state } = mount();
    const source = q("rp-preview-source") as HTMLSelectElement;
    act(() => {
      source.value = "ultimate";
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelector('[data-rp-state="ultimate-master"]')).not.toBeNull();
    expect(state()).toBe("saved");
  });
});

describe("i18n", () => {
  it("ES copy", () => {
    const html = renderToString(element(RP, "es"));
    for (const s of [
      "Contenido",
      "Visualización",
      "Apariencia",
      "Personaje activo (auto)",
      "Siguiente división",
      "Camino a Master",
      "Mostrar cambio de la sesión",
      "Compacto",
    ]) {
      expect(html).toContain(s);
    }
  });
  it("EN copy", () => {
    const html = renderToString(element(RP, "en"));
    for (const s of ["Content", "Display", "Appearance", "Show points remaining", "Broadcast"]) {
      expect(html).toContain(s);
    }
  });
});
