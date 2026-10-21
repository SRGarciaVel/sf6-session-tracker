// @vitest-environment happy-dom
/**
 * Phase 5.6B2 — the Fight Session controls call the EXISTING server actions (mocked here at the
 * module boundary): one request per intent, pending/error states, Esc/cancel, the classic
 * post-session redirect, and no local "session started" state before the server confirms.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";
import type { DashboardLiveState } from "@/server/dashboard/state";
import { LiveDashboardProvider } from "../LiveDashboard";
import { FightSessionArea } from "./FightSessionDashboard";
import { NOW, SESSION, SIGNALS, dashState } from "./test-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ startSessionAction: vi.fn(), endSessionAction: vi.fn() }));
vi.mock("../../actions", () => actions);

class NoopEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  // Readiness is re-assessed against the client clock: pin it to the fixtures' "now".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("EventSource", NoopEventSource);
  push.mockReset();
  actions.startSessionAction.mockReset();
  actions.endSessionAction.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(state: DashboardLiveState) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <LiveDashboardProvider initial={state}>
          <FightSessionArea />
        </LiveDashboardProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const byK = (k: string) => host!.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);
const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe("start (existing startSessionAction)", () => {
  it("double click ⇒ ONE request; pending state while it runs; no local 'active' state", async () => {
    let resolve: (v: { ok: true; data: undefined }) => void = () => undefined;
    actions.startSessionAction.mockReturnValue(new Promise((r) => (resolve = r)));
    mount(dashState(SESSION.none()));
    act(() => {
      byK("start")!.click();
      byK("start")!.click();
    });
    await flush();
    expect(actions.startSessionAction).toHaveBeenCalledTimes(1);
    expect(byK("start")!.disabled).toBe(true);
    expect(byK("start")!.getAttribute("aria-busy")).toBe("true");
    expect(host!.textContent).toContain("Iniciando…");
    // Until the server's state says "active", the UI stays in PREPARE.
    expect(byK("end")).toBeNull();
    await act(async () => resolve({ ok: true, data: undefined }));
    expect(byK("start")!.disabled).toBe(false);
    expect(byK("end")).toBeNull();
  });
  it("server refusal (e.g. Companion data too old) is shown as returned, CTA usable again", async () => {
    actions.startSessionAction.mockResolvedValue({
      ok: false,
      error: "Faltan datos recientes del Companion.",
    });
    mount(dashState(SESSION.none()));
    act(() => byK("start")!.click());
    await flush();
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe(
      "Faltan datos recientes del Companion.",
    );
    expect(byK("start")!.disabled).toBe(false);
  });
  it("blocked readiness ⇒ the action is never called", async () => {
    mount(dashState(SESSION.none(), { signals: SIGNALS.unpaired }));
    act(() => byK("start")!.click());
    await flush();
    expect(actions.startSessionAction).not.toHaveBeenCalled();
  });
});

describe("end (existing endSessionAction)", () => {
  it("ask → Esc cancels (focus back on End) → nothing sent", async () => {
    mount(dashState(SESSION.active()));
    act(() => byK("end")!.click());
    expect(document.activeElement).toBe(byK("cancel-end"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(byK("confirm-end")).toBeNull();
    expect(document.activeElement).toBe(byK("end"));
    expect(actions.endSessionAction).not.toHaveBeenCalled();
  });
  it("confirm ⇒ one request, then the classic recap redirect", async () => {
    actions.endSessionAction.mockResolvedValue({ ok: true, data: { sessionId: "s-123" } });
    mount(dashState(SESSION.active()));
    act(() => byK("end")!.click());
    act(() => {
      byK("confirm-end")!.click();
      byK("confirm-end")!.click();
    });
    await flush();
    expect(actions.endSessionAction).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/dashboard/sessions/s-123?ended=1");
  });
  it("failure keeps the session and the confirm open, with the error", async () => {
    actions.endSessionAction.mockResolvedValue({ ok: false, error: "Tu sesión ha caducado." });
    mount(dashState(SESSION.active()));
    act(() => byK("end")!.click());
    act(() => byK("confirm-end")!.click());
    await flush();
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe("Tu sesión ha caducado.");
    expect(byK("confirm-end")).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("state is read, never rewritten", () => {
  it("the provider's session object is not mutated by the Fight Session view", () => {
    const state = dashState(SESSION.active());
    const before = JSON.stringify(state);
    mount(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
