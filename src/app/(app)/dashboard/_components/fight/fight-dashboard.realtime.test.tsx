// @vitest-environment happy-dom
/**
 * Phase 5.6B3 — the LIVE view through the REAL LiveDashboardProvider + useEventStream, with a
 * fake EventSource standing in for /api/me/stream: one connection, full-state snapshots update
 * scoreboard + last match + strip together, older snapshots are dropped, a reconnect resyncs,
 * and a session ending while updates arrive goes back to PREPARE.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineSession } from "@/components/fight-session/test-support";
import es from "@/i18n/messages/es.json";
import type { DashboardLiveState } from "@/server/dashboard/state";
import { LiveDashboardProvider } from "../LiveDashboard";
import { FightSessionArea, FightStatusStrip } from "./FightSessionDashboard";
import { NOW, dashState } from "./test-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../actions", () => ({ startSessionAction: vi.fn(), endSessionAction: vi.fn() }));

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(e: { data: string }) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, cb: (e: { data: string }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), cb]);
  }
  emit(name: string, data: unknown) {
    for (const cb of this.listeners.get(name) ?? []) cb({ data: JSON.stringify(data) });
  }
  close() {
    this.readyState = 2;
  }
}

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
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
          <FightStatusStrip overlayCount={1} />
          <FightSessionArea />
        </LiveDashboardProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const stream = () => FakeEventSource.instances.at(-1)!;
const push = (state: DashboardLiveState) => act(() => stream().emit("dashboard", state));
const summary = () =>
  host!.querySelector("section[aria-label='Marcador de la sesión'] p")?.textContent;
const strip = () =>
  Array.from(host!.querySelectorAll("ol[aria-label='Partidas de la sesión'] li")).map((li) =>
    li.getAttribute("aria-label"),
  );
const t0 = NOW;

describe("LIVE realtime (existing provider + stream)", () => {
  it("one stream; a new match updates scoreboard, last match and strip together", () => {
    mount(dashState(engineSession({ results: [] }), { recent: true, generatedAt: t0 }));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(stream().url).toBe("/api/me/stream");
    expect(host!.textContent).toContain("Esperando tu primera partida Ranked…");

    push(
      dashState(engineSession({ results: ["win"], snapshot: { value: 1583, after: 0 } }), {
        recent: true,
        generatedAt: t0 + 1_000,
      }),
    );
    expect(summary()).toContain("1 victorias, 0 derrotas");
    expect(host!.textContent).toContain("Victoria vs Ken");
    expect(host!.textContent).toContain("Nueva");
    expect(host!.querySelector("[aria-live='polite']")?.textContent).toBe(
      "Partida registrada: Victoria contra Ken",
    );
    expect(strip()).toEqual(["Partida 1: Victoria"]);

    push(
      dashState(engineSession({ results: ["win", "loss"], snapshot: { value: 1570, after: 1 } }), {
        recent: true,
        generatedAt: t0 + 2_000,
      }),
    );
    expect(summary()).toMatch(/^1 victorias, 1 derrotas, 50\s% de victorias en 2 partidas$/);
    expect(host!.textContent).toContain("Derrota vs Ken");
    expect(strip()).toEqual(["Partida 1: Victoria", "Partida 2: Derrota"]);
    expect(FakeEventSource.instances).toHaveLength(1); // still the one stream
  });

  it("an older snapshot arriving late is ignored (out of order)", () => {
    mount(
      dashState(engineSession({ results: ["win", "loss"] }), {
        recent: true,
        generatedAt: t0 + 5_000,
      }),
    );
    push(dashState(engineSession({ results: ["win"] }), { recent: true, generatedAt: t0 + 1_000 }));
    expect(summary()).toContain("en 2 partidas");
    expect(strip()).toHaveLength(2);
  });

  it("reconnect: the new stream's full state resyncs everything", () => {
    mount(dashState(engineSession({ results: ["win"] }), { recent: true, generatedAt: t0 }));
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.setSystemTime(t0 + 10_000);
    act(() => {
      stream().readyState = FakeEventSource.CLOSED;
      stream().onerror?.();
    });
    act(() => vi.advanceTimersByTime(5_000)); // backoff ⇒ connect() again
    expect(FakeEventSource.instances).toHaveLength(2);
    push(
      dashState(engineSession({ results: ["win", "win", "loss"] }), {
        recent: true,
        generatedAt: t0 + 20_000,
      }),
    );
    expect(summary()).toContain("en 3 partidas");
    expect(strip()).toHaveLength(3);
  });

  it("session ended while updates arrive: back to PREPARE, a late active snapshot cannot revive it", () => {
    mount(dashState(engineSession({ results: ["win"] }), { recent: true, generatedAt: t0 }));
    push(
      dashState(
        engineSession({
          results: ["win", "win"],
          status: "ended",
          snapshot: { value: 1594, after: 1 },
        }),
        { recent: true, generatedAt: t0 + 2_000 },
      ),
    );
    expect(host!.querySelector('[data-k="start"]')).not.toBeNull();
    expect(host!.querySelector('[data-k="end"]')).toBeNull();
    push(
      dashState(engineSession({ results: ["win", "win"] }), {
        recent: true,
        generatedAt: t0 + 1_500,
      }),
    );
    expect(host!.querySelector('[data-k="end"]')).toBeNull();
  });

  it("a page load is not an event: no 'new' badge or announcement on first render", () => {
    mount(dashState(engineSession({ results: ["win"] }), { recent: true, generatedAt: t0 }));
    expect(host!.textContent).not.toContain("Nueva");
    expect(host!.querySelector("[aria-live='polite']")?.textContent ?? "").toBe("");
  });

  it("a dropped stream is said on the strip until it reopens (never on the first connect)", () => {
    mount(dashState(engineSession({ results: ["win"] }), { recent: true, generatedAt: t0 }));
    expect(host!.textContent).not.toContain("Reconectando…"); // connecting for the first time
    act(() => stream().onopen?.());
    expect(host!.textContent).not.toContain("Reconectando…");
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.setSystemTime(t0 + 10_000);
    act(() => {
      stream().readyState = FakeEventSource.CLOSED;
      stream().onerror?.();
    });
    expect(host!.textContent).toContain("Reconectando…");
    act(() => vi.advanceTimersByTime(5_000));
    act(() => stream().onopen?.());
    expect(host!.textContent).not.toContain("Reconectando…");
    expect(FakeEventSource.instances).toHaveLength(2); // one stream at a time
  });
});
