// @vitest-environment happy-dom
/**
 * Phase 5.6D — compact overlay console (Fight Session): every overlay keeps name, kind, preview,
 * «Copy OBS URL» (exact URL + token) and «Configure» (same route) in view; canvas, language,
 * style, the full URL and the preview link sit behind a native disclosure. No per-overlay OBS
 * status is claimed. The classic (detailed) presentation stays the default.
 */
import { NextIntlClientProvider } from "next-intl";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } from "@/domain/overlay/rank-progress";
import { sampleLiveState } from "@/domain/overlay/state";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions", () => ({ createOverlayAction: vi.fn(), redeemCreatorKeyAction: vi.fn() }));
const live = vi.hoisted(() => ({ overlayConnections: 0 }));
vi.mock("./LiveDashboard", () => ({
  useLiveDashboard: () => ({
    state: { live: sampleLiveState(), overlayConnections: live.overlayConnections },
  }),
}));
if (typeof ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

const { ObsGuide, OverlaysPanel } = await import("./OverlaysPanel");
const { CreatorBetaPanel } = await import("./CreatorBetaPanel");

const OVERLAYS = [
  {
    id: "s1",
    name: "Marcador de sesión",
    url: "https://sst.example/overlay/tok_SESSION_123",
    config: DEFAULT_OVERLAY_CONFIG,
  },
  {
    id: "r1",
    name: "Progreso de rango con un nombre larguísimo para la columna estrecha",
    url: "https://sst.example/overlay/tok_RANK_456",
    config: { ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, style: "compact" as const },
  },
];

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  live.overlayConnections = 0;
  window.location.hash = "";
});

function mount(node: ReactNode, locale: "es" | "en" = "es") {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}
const items = () => [...host.querySelectorAll<HTMLElement>("[data-overlay-item]")];

describe("compact overlay console", () => {
  it("each row: name, kind, preview, Copy OBS URL and Configure visible; details folded", () => {
    mount(<OverlaysPanel overlays={OVERLAYS} compact />);
    expect(items()).toHaveLength(2);
    const [session, rank] = items();
    expect(session!.querySelector('[data-testid="overlay-name"]')?.textContent).toBe(
      "Marcador de sesión",
    );
    expect(session!.querySelector('[data-testid="overlay-kind"]')?.textContent).toBe(
      "Estadísticas de sesión",
    );
    expect(rank!.querySelector('[data-testid="overlay-kind"]')?.textContent).toBe(
      "Progreso de rango",
    );
    const copy = session!.querySelector<HTMLButtonElement>("button[data-copy-status]")!;
    expect(copy.textContent).toBe("Copiar URL para OBS");
    expect(copy.getAttribute("aria-label")).toBe("Copiar URL para OBS de Marcador de sesión");
    const configure = session!.querySelector<HTMLAnchorElement>(
      '[data-testid="overlay-configure"]',
    )!;
    expect(configure.getAttribute("href")).toBe("/dashboard/overlays/s1");
    expect(configure.getAttribute("aria-label")).toBe("Configurar Marcador de sesión");
    const details = session!.querySelector<HTMLDetailsElement>('[data-testid="overlay-details"]')!;
    expect(details.tagName).toBe("DETAILS");
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Detalles");
  });

  it("Copy OBS URL writes the exact current URL (token included)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mount(<OverlaysPanel overlays={OVERLAYS} compact />);
    const copy = items()[1]!.querySelector<HTMLButtonElement>("button[data-copy-status]")!;
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith("https://sst.example/overlay/tok_RANK_456");
    expect(copy.getAttribute("data-copy-status")).toBe("copied");
    // «Copiado» (+ check icon) replaces the label in place; the idle label only reserves the width.
    const [idle, feedback] = [...copy.querySelectorAll("span > span")];
    expect(idle?.className).toContain("invisible");
    expect(idle?.getAttribute("aria-hidden")).toBe("true");
    expect(feedback?.textContent).toBe("Copiado");
    expect(copy.querySelector('svg[data-icon="check"]')).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("details: kind-aware readout, the full URL field and the same public preview", () => {
    mount(<OverlaysPanel overlays={OVERLAYS} compact />);
    const [session, rank] = items();
    for (const d of host.querySelectorAll("details")) d.open = true;
    expect(session!.textContent).toContain("800 × 180");
    expect(session!.textContent).toContain("Tema");
    expect(rank!.textContent).toContain("Estilo");
    expect(rank!.textContent).toContain("Compacto");
    expect(rank!.textContent).not.toContain("Tema");
    expect(rank!.querySelector("input")?.value).toBe("https://sst.example/overlay/tok_RANK_456");
    const preview = rank!.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    expect(preview.getAttribute("href")).toBe("https://sst.example/overlay/tok_RANK_456");
    expect(preview.getAttribute("rel")).toBe("noreferrer");
    expect(preview.getAttribute("aria-label")).toMatch(/^Abrir vista previa de Progreso de rango/);
  });

  it("OBS status: only the account-wide count; nothing per overlay", () => {
    live.overlayConnections = 1;
    mount(<OverlaysPanel overlays={OVERLAYS} compact />);
    expect(host.textContent).toContain("1 conectado");
    for (const item of items()) expect(item.textContent).not.toMatch(/conectad|en obs/i);
  });

  it("zero overlays: honest empty state and the create action", () => {
    mount(<OverlaysPanel overlays={[]} compact />);
    expect(items()).toHaveLength(0);
    expect(host.textContent).toContain("Aún no tienes overlays configurados.");
    expect(host.querySelector('[data-testid="new-overlay"]')).not.toBeNull();
  });

  it("English labels", () => {
    mount(<OverlaysPanel overlays={OVERLAYS} compact />, "en");
    const copy = items()[0]!.querySelector("button[data-copy-status]")!;
    expect(copy.getAttribute("aria-label")).toBe("Copy OBS URL for Marcador de sesión");
    expect(items()[0]!.querySelector("summary")?.textContent).toContain("Details");
  });

  it("classic (default) keeps the detailed presentation: readout + URL always visible", () => {
    mount(<OverlaysPanel overlays={OVERLAYS} />);
    expect(host.querySelector("details")).toBeNull();
    expect([...host.querySelectorAll("input")].map((i) => i.value)).toEqual(
      OVERLAYS.map((o) => o.url),
    );
  });
});

describe("folded console modules", () => {
  it("OBS guide: collapsible keeps all 5 steps behind its heading", () => {
    mount(<ObsGuide width={800} height={180} collapsible />);
    const d = host.querySelector<HTMLDetailsElement>('[data-testid="obs-guide"]')!;
    expect(d.open).toBe(false);
    expect(d.querySelector("summary h2")?.textContent).toBe("Añadir a OBS");
    expect(d.querySelectorAll("ol > li")).toHaveLength(5);
  });
  it("Creator beta: plan visible while folded; a #creator-beta link opens it", () => {
    window.location.hash = "#creator-beta";
    mount(<CreatorBetaPanel plan="free" activeUntil={null} collapsible />);
    const d = host.querySelector<HTMLDetailsElement>("details#creator-beta")!;
    expect(d.querySelector("summary")?.textContent).toContain("Free");
    expect(d.open).toBe(true);
    expect(d.querySelector("#creator-key")).not.toBeNull();
  });
});
