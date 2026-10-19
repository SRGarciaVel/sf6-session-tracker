// @vitest-environment happy-dom
/**
 * Phase 5.4B — "New overlay" offers both kinds (real buttons) and creates the chosen one; cards
 * are kind-aware (Session: theme; Rank Progress: style), never assuming a Session theme.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OVERLAY_CONFIG } from "@/domain/overlay/config";
import { DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG } from "@/domain/overlay/rank-progress";
import { sampleLiveState } from "@/domain/overlay/state";
import es from "@/i18n/messages/es.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const createOverlayAction = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: () => undefined }) }));
vi.mock("../actions", () => ({
  createOverlayAction: (...args: unknown[]) => createOverlayAction(...args),
}));
vi.mock("./LiveDashboard", () => ({
  useLiveDashboard: () => ({ state: { live: sampleLiveState(), overlayConnections: 0 } }),
}));
if (typeof ResizeObserver === "undefined") {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
}

const { OverlaysPanel } = await import("./OverlaysPanel");

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  createOverlayAction.mockReset();
});

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host);
    root.render(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <OverlaysPanel
          overlays={[
            {
              id: "s1",
              name: "Sesión",
              url: "https://sst.example/overlay/a",
              config: DEFAULT_OVERLAY_CONFIG,
            },
            {
              id: "r1",
              name: "Rango",
              url: "https://sst.example/overlay/b",
              config: { ...DEFAULT_RANK_PROGRESS_OVERLAY_CONFIG, style: "compact" },
            },
          ]}
        />
      </NextIntlClientProvider>,
    );
  });
  return (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe("OverlaysPanel kinds", () => {
  it("cards are kind-aware: type tag, Session theme vs Rank Progress style", () => {
    mount();
    const tags = [...host.querySelectorAll('[data-testid="overlay-kind"]')].map(
      (t) => t.textContent,
    );
    expect(tags).toEqual(["Estadísticas de sesión", "Progreso de rango"]);
    const items = host.querySelectorAll("li");
    expect(items[0]?.textContent).toContain("Tema");
    expect(items[1]?.textContent).toContain("Estilo");
    expect(items[1]?.textContent).toContain("Compacto");
    expect(items[1]?.textContent).toContain("400 × 140");
    expect(items[1]?.textContent).not.toContain("Tema");
  });

  it("New overlay → choose Rank progress → creates that kind and opens its builder", async () => {
    createOverlayAction.mockResolvedValue({ ok: true, data: { overlayId: "new-id" } });
    const q = mount();
    expect(q("new-overlay-rank-progress")).toBeNull();
    act(() => q("new-overlay")!.click());
    const session = q("new-overlay-session")!;
    const rank = q("new-overlay-rank-progress")!;
    expect(session.tagName).toBe("BUTTON");
    expect(session.textContent).toContain("Victorias, derrotas, rating, rachas");
    expect(rank.textContent).toContain("Muestra tu rango actual");
    await act(async () => rank.click());
    expect(createOverlayAction).toHaveBeenCalledWith("Overlay 3", "minimal", "rank-progress");
    expect(push).toHaveBeenCalledWith("/dashboard/overlays/new-id");
  });

  it("choosing Session stats creates a Session overlay as before", async () => {
    createOverlayAction.mockResolvedValue({ ok: true, data: { overlayId: "s-id" } });
    const q = mount();
    act(() => q("new-overlay")!.click());
    await act(async () => q("new-overlay-session")!.click());
    expect(createOverlayAction).toHaveBeenCalledWith("Overlay 3", "minimal", "session");
  });
});
