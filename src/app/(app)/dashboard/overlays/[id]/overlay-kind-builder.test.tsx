/**
 * Phase 5.4A — builder dispatch by kind: a legacy config (no kind) and `kind: "session"` open the
 * SAME Session builder (identical markup); the kind is never editable and Session presets stay in
 * the Session builder.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BRAND_FLAG } from "@/domain/overlay/brand-flag";
import {
  DEFAULT_OVERLAY_CONFIG,
  applyThemeDefaults,
  parseOverlayConfig,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { sampleLiveState } from "@/domain/overlay/state";
import es from "@/i18n/messages/es.json";

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
  saveOverlayAction: vi.fn(),
  deleteOverlayAction: vi.fn(),
  rotateOverlayTokenAction: vi.fn(),
}));
vi.mock("../../_components/LiveDashboard", () => ({
  useLiveDashboard: () => ({ state: { live: sampleLiveState() }, stream: "open" }),
}));

const { OverlayBuilder } = await import("./OverlayBuilder");

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

const render = (config: OverlayConfig) =>
  renderToString(
    <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
      <OverlayBuilder
        overlayId="00000000-0000-4000-8000-0000000000aa"
        initialName="Overlay de juego"
        initialConfig={config}
        url="https://sst.example/overlay/tok"
        access={CREATOR}
        presets={presets}
      />
    </NextIntlClientProvider>,
  );

const withoutKind = (c: OverlayConfig) => {
  const raw: Record<string, unknown> = { ...c };
  delete raw.kind;
  return raw;
};

describe("builder dispatch by kind", () => {
  const configs: OverlayConfig[] = [
    DEFAULT_OVERLAY_CONFIG,
    applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "minimal"),
    {
      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "rank-card"),
      creator: {
        ...DEFAULT_CREATOR_CUSTOMIZATION,
        motion: DEFAULT_CREATOR_MOTION,
        brandFlag: { ...DEFAULT_BRAND_FLAG, enabled: true },
      },
    },
  ];

  it("legacy (no kind) and kind: session open the identical Session builder", () => {
    for (const cfg of configs) {
      const legacyHtml = render(parseOverlayConfig(withoutKind(cfg)));
      const explicitHtml = render(parseOverlayConfig({ ...withoutKind(cfg), kind: "session" }));
      expect(legacyHtml).toBe(explicitHtml);
      // The Session builder: its four tabs, preview and OBS output.
      expect(legacyHtml.match(/role="tab"/g)?.length).toBe(4);
      expect(legacyHtml).toContain('data-testid="overlay-preview"');
    }
  });

  it("no kind picker / future-kind field in the Session editor; Session presets are shown", () => {
    const html = render(DEFAULT_OVERLAY_CONFIG);
    expect(html).not.toMatch(/rank-progress|rankProgress|Progreso de rango|name="kind"/);
    expect(html).toContain("Gold look");
  });
});
