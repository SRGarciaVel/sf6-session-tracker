import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  applyThemeDefaults,
  type OverlayConfig,
} from "@/domain/overlay/config";
import { DEFAULT_CREATOR_CUSTOMIZATION } from "@/domain/overlay/creator";
import { DEFAULT_CREATOR_MOTION } from "@/domain/overlay/motion";
import { DEFAULT_CHARACTER_ROTATION } from "@/domain/overlay/rotation";
import { sampleLiveState } from "@/domain/overlay/state";
import { OVERLAY_THEMES } from "@/domain/overlay/config";
import en from "@/i18n/messages/en.json";
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

const { ThemePicker } = await import("./ThemePicker");
const { PresetsSection } = await import("./PresetsSection");
const { CreatorPanel } = await import("./CreatorPanel");
const { OverlayBuilder } = await import("./OverlayBuilder");

const wrap = (locale: "es" | "en", node: ReactNode) =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
const radio = (html: string, theme: string) =>
  html.match(new RegExp(`<input[^>]*value="${theme}"[^>]*>`))?.[0] ?? "";
const presets = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Gold look", theme: "prestige" as const },
  { id: "00000000-0000-4000-8000-000000000002", name: "Old", theme: null },
];
const FREE = {
  advancedCustomization: false,
  premiumThemes: false,
  creatorPresets: false,
  motionEffects: false,
  characterRotation: false,
};
const CREATOR = {
  advancedCustomization: true,
  premiumThemes: true,
  creatorPresets: true,
  motionEffects: true,
  characterRotation: true,
};

describe("ThemePicker", () => {
  it("is a real radio group; every registered theme present once", () => {
    const html = wrap(
      "en",
      <ThemePicker value="competitive" locale="en" premiumThemes onSelect={() => {}} />,
    );
    expect(html).toContain('role="radiogroup"');
    for (const t of OVERLAY_THEMES) expect(radio(html, t), t).toContain('type="radio"');
    expect(html.match(/type="radio"/g)?.length).toBe(OVERLAY_THEMES.length);
    expect(radio(html, "competitive")).toContain("checked");
  });

  it("Free: Free themes selectable, Creator themes visible but disabled, ONE badge + ONE note", () => {
    const html = wrap(
      "en",
      <ThemePicker value="competitive" locale="en" premiumThemes={false} onSelect={() => {}} />,
    );
    for (const t of ["minimal", "competitive", "fighter"])
      expect(radio(html, t)).not.toMatch(/disabled/);
    for (const t of ["rank-card", "broadcast", "prestige"])
      expect(radio(html, t)).toMatch(/disabled/);
    expect(html.match(/Creator Beta/g)?.length).toBe(2); // group badge + the note
    expect(html).toContain(en.Builder.creatorThemesNote);
  });

  it("stored Creator theme after downgrade: saved message naming the fallback", () => {
    const html = wrap(
      "es",
      <ThemePicker value="prestige" locale="es" premiumThemes={false} onSelect={() => {}} />,
    );
    expect(html).toContain("Tu tema Creator «Prestige» está guardado");
  });
});

describe("Presets (compact selector)", () => {
  const props = {
    overlayId: "00000000-0000-4000-8000-0000000000aa",
    config: DEFAULT_OVERLAY_CONFIG,
    dirty: false,
    onApplied: () => {},
  };
  it("downgraded: presets kept and listed, only delete offered, no create form", () => {
    const html = wrap("en", <PresetsSection {...props} presets={presets} enabled={false} />);
    expect(html).toContain("Gold look");
    expect(html).not.toContain(">Apply<");
    expect(html).not.toContain(">More<");
    expect(html).not.toContain("Save current look");
    expect(html).toContain(">Delete<");
  });
  it("entitled: selector + Apply + Update + More menu + create form", () => {
    const html = wrap("es", <PresetsSection {...props} presets={presets} enabled />);
    for (const s of [
      ">Aplicar<",
      ">Actualizar con el actual<",
      ">Más<",
      "Guardar aspecto actual",
      "2/20",
    ]) {
      expect(html, s).toContain(s);
    }
  });
});

describe("CreatorPanel", () => {
  const base = {
    update: () => {},
    overlayId: "00000000-0000-4000-8000-0000000000aa",
    dirty: false,
    onPresetApplied: () => {},
    rotationCharacters: { names: ["Ryu", "Chun-Li", "Jamie"], sample: true },
  };
  it("Free with stored Creator data: ONE notice with both saved messages; controls disabled", () => {
    const config: OverlayConfig = {
      ...DEFAULT_OVERLAY_CONFIG,
      creator: DEFAULT_CREATOR_CUSTOMIZATION,
    };
    const html = wrap(
      "en",
      <CreatorPanel
        {...base}
        config={config}
        presets={presets}
        advancedCustomization={false}
        creatorPresets={false}
        motionEffects={false}
        characterRotation={false}
      />,
    );
    expect(html.match(/data-testid="creator-notice"/g)?.length).toBe(1);
    expect(html).toContain("Your Creator customization is saved");
    expect(html).toContain(
      "Your Creator presets are saved. Renew Creator access to use them again.",
    );
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="creator-customization"/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="creator-motion"/);
    expect(html.match(/class="hud-tag[^"]*">Creator Beta</g)?.length).toBe(1); // one badge
  });

  it("Movement: stored motion stays visible (disabled) for Free; one notice covers it", () => {
    const config: OverlayConfig = {
      ...DEFAULT_OVERLAY_CONFIG,
      creator: {
        ...DEFAULT_CREATOR_CUSTOMIZATION,
        motion: { ...DEFAULT_CREATOR_MOTION, updateStyle: "impact" },
      },
    };
    const html = wrap(
      "es",
      <CreatorPanel
        {...base}
        config={config}
        presets={[]}
        advancedCustomization={false}
        creatorPresets={false}
        motionEffects={false}
        characterRotation={false}
      />,
    );
    expect(html.match(/data-testid="creator-notice"/g)?.length).toBe(1);
    expect(html).toContain("Movimiento");
    expect(html).toMatch(/<option value="impact" selected="">Impacto<\/option>/);
  });

  it("Movement: rank reaction disabled with a note on themes without the emblem", () => {
    const motionOn = (theme: OverlayConfig["theme"]): OverlayConfig => ({
      ...applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme),
      creator: { ...DEFAULT_CREATOR_CUSTOMIZATION, motion: DEFAULT_CREATOR_MOTION },
    });
    const render = (theme: OverlayConfig["theme"]) =>
      wrap(
        "en",
        <CreatorPanel
          {...base}
          config={motionOn(theme)}
          presets={[]}
          advancedCustomization
          creatorPresets
          motionEffects
          characterRotation
        />,
      );
    const minimal = render("minimal");
    expect(minimal).toContain("This theme doesn&#x27;t show the rank emblem.");
    expect(minimal).toMatch(
      /aria-checked="false"[^>]*disabled=""[^>]*>Emphasized|disabled=""[^>]*>Emphasized/,
    );
    const rankCard = render("rank-card");
    expect(rankCard).not.toContain("rank emblem.");
    expect(rankCard).not.toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="creator-motion"/);
  });
  it("Creator: no notice, controls enabled", () => {
    const html = wrap(
      "en",
      <CreatorPanel
        {...base}
        config={DEFAULT_OVERLAY_CONFIG}
        presets={[]}
        advancedCustomization
        creatorPresets
        motionEffects
        characterRotation
      />,
    );
    expect(html).not.toContain("creator-notice");
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""/);
  });
});

describe("OverlayBuilder", () => {
  const render = (access: typeof FREE, config: OverlayConfig = DEFAULT_OVERLAY_CONFIG) =>
    wrap(
      "es",
      <OverlayBuilder
        overlayId="00000000-0000-4000-8000-0000000000aa"
        initialName="Overlay de juego"
        initialConfig={config}
        url="https://sst.example/overlay/tok"
        access={access}
        presets={[]}
      />,
    );

  it("renders header, four tabs (all panels present), preview and OBS output", () => {
    const html = render(FREE);
    expect(html.match(/role="tab"/g)?.length).toBe(4);
    expect(html.match(/role="tabpanel"/g)?.length).toBe(4);
    for (const id of ["appearance", "content", "style", "creator"])
      expect(html).toContain(`id="panel-${id}"`);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-testid="overlay-preview"');
    expect(html).toContain('data-testid="obs-output"');
    expect(html).toMatch(
      /href="https:\/\/sst\.example\/overlay\/tok"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });

  it("preview offers a local Play update (Victory | Loss), outside the saved config", () => {
    const html = render(FREE);
    expect(html).toContain('data-testid="play-update"');
    expect(html).toContain("Reproducir actualización");
    expect(Object.keys(DEFAULT_OVERLAY_CONFIG)).not.toContain("simulation");
  });

  it("starts saved (not dirty), no mobile save bar", () => {
    const html = render(FREE);
    expect(html).toContain('data-state="saved"');
    expect(html).not.toContain("mobile-save-bar");
    expect(html).toMatch(
      /data-testid="save-button"[^>]*disabled|disabled[^>]*data-testid="save-button"/,
    );
  });

  it("desktop: sticky preview column; mobile: preview first without sticky", () => {
    const html = render(CREATOR);
    const col = html.match(/<div class="([^"]*)" data-testid="preview-column"/)?.[1] ?? "";
    expect(col).toContain("lg:sticky");
    expect(col).not.toMatch(/(^| )sticky( |$)/); // only from lg up
    expect(col).toContain("lg:order-2");
    // Preview column comes first in source order (mobile), editor second.
    expect(html.indexOf("preview-column")).toBeLessThan(html.indexOf('data-testid="editor"'));
  });

  it("preview state (zoom/background/sample) is not part of the overlay config", () => {
    // The builder passes the EFFECTIVE config to the preview and keeps preview state local:
    // the config schema has no zoom/background/sample keys.
    for (const k of ["zoom", "previewBg", "useSample", "sampleRank"]) {
      expect(Object.keys(DEFAULT_OVERLAY_CONFIG)).not.toContain(k);
    }
  });

  it("Free owner with a stored premium theme: preview renders the Free fallback", () => {
    const html = render(FREE, applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, "rank-card"));
    const preview = html.slice(html.indexOf('data-testid="overlay-preview"'));
    expect(preview).toContain("ov-theme-competitive");
    expect(preview.slice(0, 2000)).not.toContain("ov-theme-rank-card");
  });

  it("Phase 5.1: Contenido has a session-stats group: scope select (2 options + hint) and the character select", () => {
    const html = render(FREE);
    const content = html.slice(html.indexOf('id="panel-content"'));
    expect(content).toContain("Estadísticas de sesión");
    const select =
      content.match(/<select[^>]*data-testid="stats-scope"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select.match(/<option/g)?.length).toBe(2);
    expect(select).toContain("Sesión completa");
    expect(select).toContain("Personaje mostrado");
    expect(select).toMatch(/aria-describedby="[^"]+"/);
    expect(content).toContain(es.Builder.statsScopes.session.hint);
    expect(content).toContain('data-testid="rating-character"');
  });

  it("Phase 5.1: character scope switches the hints; sample-character picker is preview-only", () => {
    const html = render(FREE, { ...DEFAULT_OVERLAY_CONFIG, statsScope: "character" });
    expect(html).toContain(es.Builder.statsScopes.character.hint);
    expect(html).toContain(es.Builder.ratingCharacterHintScoped);
    // Live data with games ⇒ sample mode off ⇒ no sample-character picker (it lives with sample data).
    expect(html).not.toContain('data-testid="sample-character"');
    expect(Object.keys(DEFAULT_OVERLAY_CONFIG)).not.toContain("sampleCharacter");
  });
});

describe("Phase 5.2: character rotation (builder)", () => {
  const base = {
    update: () => {},
    overlayId: "00000000-0000-4000-8000-0000000000aa",
    dirty: false,
    onPresetApplied: () => {},
    presets: [],
    rotationCharacters: { names: ["Ryu", "Chun-Li", "Jamie"], sample: true },
  };
  const withRotation = (over: Partial<typeof DEFAULT_CHARACTER_ROTATION> = {}): OverlayConfig => ({
    ...DEFAULT_OVERLAY_CONFIG,
    creator: {
      ...DEFAULT_CREATOR_CUSTOMIZATION,
      characterRotation: { ...DEFAULT_CHARACTER_ROTATION, enabled: true, ...over },
    },
  });
  const panel = (config: OverlayConfig, entitled: boolean) =>
    wrap(
      "es",
      <CreatorPanel
        {...base}
        config={config}
        advancedCustomization={entitled}
        creatorPresets={entitled}
        motionEffects={entitled}
        characterRotation={entitled}
      />,
    );
  const group = (html: string) =>
    html.slice(html.indexOf('data-testid="creator-rotation"'), html.lastIndexOf("</fieldset>"));

  it("64/66. Creator tab shows the rotation group, enabled for Creator", () => {
    const html = panel(DEFAULT_OVERLAY_CONFIG, true);
    expect(html).toContain("Rotación de personajes");
    expect(html).toContain("Rotación automática");
    expect(html).not.toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="creator-rotation"/);
    expect(html).not.toContain("Creator Beta requerido");
  });

  it("65. Free: group disabled with the requirement; stored rotation covered by the ONE notice", () => {
    const html = panel(withRotation(), false);
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*data-testid="creator-rotation"/);
    expect(html).toContain("Creator Beta requerido.");
    expect(html.match(/data-testid="creator-notice"/g)?.length).toBe(1);
    expect(html).toContain(es.Builder.creator.savedButInactive);
  });

  it("68. off: progressive disclosure — only the switch", () => {
    const html = group(panel(DEFAULT_OVERLAY_CONFIG, true));
    expect(html).not.toContain('data-testid="rotation-interval"');
    expect(html).not.toContain('data-testid="rotation-order"');
    expect(html).not.toContain('data-testid="rotation-priority"');
  });

  it("67. on: interval, transition, order, priority and included characters (no Cammy)", () => {
    const html = group(panel(withRotation(), true));
    const interval =
      html.match(/<select[^>]*data-testid="rotation-interval"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(interval.match(/<option/g)?.length).toBe(5);
    expect(interval).toContain('value="10" selected=""');
    expect(html).toContain("Fundido");
    expect(html).toContain("Deslizamiento");
    expect(html).toContain("Instantánea");
    const order =
      html.match(/<select[^>]*data-testid="rotation-order"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(order).toContain("Más recientes primero");
    expect(order).toContain("Más jugados primero");
    expect(order).toContain("Alfabético");
    const priority = html.match(/<select[^>]*data-testid="rotation-priority"[^>]*>/)?.[0] ?? "";
    expect(priority).not.toContain(`disabled=""`);
    expect(html).toContain("Priorizar personaje de la última partida");
    expect(html).toContain("Ryu · Chun-Li · Jamie (datos de ejemplo)");
    expect(html).not.toContain("Cammy");
  });

  it("priority off ⇒ its duration is disabled with an explanation", () => {
    const html = group(panel(withRotation({ prioritizeLatestMatch: false }), true));
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*data-testid="rotation-priority"/);
    expect(html).toContain(es.Builder.rotation.priorityOffHint);
  });

  it("pinned character + rotation: the precedence is explained (both places)", () => {
    const pinned = { ...withRotation(), ratingCharacterKey: "jamie" };
    expect(group(panel(pinned, true))).toContain(es.Builder.rotation.pinnedNote);
    expect(group(panel(withRotation(), true))).not.toContain("rotation-pinned-note");
  });

  it("no eligible characters ⇒ explicit empty state", () => {
    const html = wrap(
      "en",
      <CreatorPanel
        {...base}
        rotationCharacters={{ names: [], sample: false }}
        config={withRotation()}
        advancedCustomization
        creatorPresets
        motionEffects
        characterRotation
      />,
    );
    expect(html).toContain(en.Builder.rotation.noCharacters);
  });

  it("74. the preview offers “Probar rotación” to Creator only; Content explains the override", () => {
    const builder = (access: typeof FREE, config: OverlayConfig) =>
      wrap(
        "es",
        <OverlayBuilder
          overlayId="00000000-0000-4000-8000-0000000000aa"
          initialName="Overlay"
          initialConfig={config}
          url="https://sst.example/overlay/tok"
          access={access}
          presets={[]}
        />,
      );
    const creator = builder(CREATOR, withRotation());
    expect(creator).toContain('data-testid="rotation-test"');
    expect(creator).toContain("Probar rotación");
    expect(creator).toContain('data-testid="rotation-overrides-hint"');
    const free = builder(FREE, withRotation());
    expect(free).not.toContain('data-testid="rotation-test"');
    // Free: effective config has no rotation ⇒ no override hint, overlay renders normally.
    expect(free).not.toContain('data-testid="rotation-overrides-hint"');
    expect(free).not.toContain("ov-rot-stage");
  });

  it("75–76. the preview has no server, DB or SSE path (source check)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const f of ["./PreviewPane.tsx", "./rotation-preview.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      expect(src).not.toMatch(/actions|fetch\(|EventSource|@\/server\//);
    }
  });
});
