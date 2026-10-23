// @vitest-environment happy-dom
/**
 * M2B — Fight Session motion through the REAL LiveDashboardProvider + useEventStream (fake
 * EventSource): cues fire only for genuine events — PREPARE → LIVE observed on the page, a new
 * match (by stable id), a confirmed rating change — and never for a page load, a return to the
 * dashboard, a duplicate / reordered / resynced snapshot, a session switch, a pending rating or a
 * failed start.
 */
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineSession } from "@/components/fight-session/test-support";
import es from "@/i18n/messages/es.json";
import type { DashboardLiveState } from "@/server/dashboard/state";
import { LiveDashboardProvider } from "../LiveDashboard";
import { FightSessionArea } from "./FightSessionDashboard";
import { NOW, SESSION, dashState, recentOf } from "./test-fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ startSessionAction: vi.fn(), endSessionAction: vi.fn() }));
vi.mock("../../actions", () => actions);

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
  actions.startSessionAction.mockReset();
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
function remount(state: DashboardLiveState) {
  act(() => root?.unmount());
  host?.remove();
  mount(state);
}
const stream = () => FakeEventSource.instances.at(-1)!;
let clock = NOW;
const live = (
  results: Array<"win" | "loss" | "draw">,
  extra: Parameters<typeof engineSession>[0] = { results },
) =>
  dashState(engineSession({ ...extra, results }), { recent: true, generatedAt: (clock += 1_000) });
const push = (state: DashboardLiveState) => act(() => stream().emit("dashboard", state));

const q = (sel: string) => host!.querySelector(sel);
const qa = (sel: string) => Array.from(host!.querySelectorAll(sel));
const newMarkers = () => qa("li.fs-round-new").map((li) => li.getAttribute("aria-label"));
const announcement = () => q("[aria-live='polite']")?.textContent ?? "";
const anyCue = () =>
  qa(".fs-hit, .fs-side-flash, .fs-round-new, .fs-stamp-in, .fs-rating-confirmed").length;

describe("match arrival cues", () => {
  it("a page load is the baseline: no cue, badge or announcement", () => {
    mount(live(["win", "loss"]));
    expect(anyCue()).toBe(0);
    expect(announcement()).toBe("");
  });

  it("a new match: its side hits, its marker pops, its stamp lands, one announcement", () => {
    mount(live(["win"]));
    push(live(["win", "loss"]));
    expect(q('[data-testid="fs-losses"]')?.classList.contains("fs-hit")).toBe(true);
    expect(q('[data-testid="fs-wins"]')?.classList.contains("fs-hit")).toBe(false);
    expect(qa(".fs-side-loss .fs-side-flash")).toHaveLength(1);
    expect(qa(".fs-side-win .fs-side-flash")).toHaveLength(0);
    expect(newMarkers()).toEqual(["Partida 2: Derrota"]);
    expect(q(".fs-stamp")?.classList.contains("fs-stamp-in")).toBe(true);
    expect(announcement()).toBe("Partida registrada: Derrota contra Ken");
  });

  it("win then win: the second arrival replays the accent (fresh elements), never stacks", () => {
    mount(live(["loss"]));
    push(live(["loss", "win"]));
    const firstHit = q('[data-testid="fs-wins"]');
    const firstStamp = q(".fs-stamp");
    push(live(["loss", "win", "win"]));
    const secondHit = q('[data-testid="fs-wins"]');
    expect(secondHit?.classList.contains("fs-hit")).toBe(true);
    expect(secondHit).not.toBe(firstHit); // remounted ⇒ the CSS animation plays again
    expect(q(".fs-stamp")).not.toBe(firstStamp);
    expect(qa(".fs-side-flash")).toHaveLength(1); // one accent at a time
    expect(newMarkers()).toEqual(["Partida 3: Victoria"]);
  });

  it("a batch is one event: every new marker, both sides, one summarized announcement", () => {
    mount(live(["win"]));
    push(live(["win", "win", "loss", "loss"]));
    expect(newMarkers()).toEqual([
      "Partida 2: Victoria",
      "Partida 3: Derrota",
      "Partida 4: Derrota",
    ]);
    expect(qa(".fs-side-flash")).toHaveLength(2);
    expect(announcement()).toBe("3 partidas registradas. La última: Derrota contra Ken");
    // The cascade is capped (newest first, at most two steps of delay).
    const delays = qa("li.fs-round-new").map((li) => (li as HTMLElement).style.animationDelay);
    expect(delays).toEqual(["120ms", "60ms", ""]);
  });

  it("duplicate snapshot / SSE reconnect resync with the same matches: no new cue", () => {
    mount(live(["win"]));
    push(live(["win", "loss"]));
    const before = q('[data-testid="fs-losses"]');
    push(live(["win", "loss"])); // duplicate (newer generatedAt, same matches)
    act(() => {
      stream().readyState = FakeEventSource.CLOSED;
      stream().onerror?.();
    });
    expect(q('[data-testid="fs-losses"]')).toBe(before); // nothing replayed
    expect(newMarkers()).toEqual(["Partida 2: Derrota"]); // still just the one arrival
  });

  it("reordered data with the same matches is not an event", () => {
    const session = engineSession({ results: ["win", "loss", "win"] });
    mount(dashState(session, { recent: true, generatedAt: (clock += 1_000) }));
    push(
      dashState(session, { recent: recentOf(session).reverse(), generatedAt: (clock += 1_000) }),
    );
    expect(anyCue()).toBe(0);
  });

  it("returning to the dashboard (remount) does not re-animate existing matches", () => {
    mount(live(["win"]));
    push(live(["win", "loss"]));
    expect(anyCue()).toBeGreaterThan(0);
    remount(live(["win", "loss"]));
    expect(anyCue()).toBe(0);
    expect(announcement()).toBe("");
  });

  it("a different session id re-seeds: its matches are not arrivals", () => {
    mount(live(["win"]));
    const other = engineSession({ results: ["win", "loss"] });
    push(dashState({ ...other, sessionId: "s2" }, { recent: true, generatedAt: (clock += 1_000) }));
    expect(anyCue()).toBe(0);
  });
});

describe("rating cues", () => {
  const rated = (results: Array<"win" | "loss">, snapshot: { value: number; after: number }) =>
    live(results, { results, snapshot });
  const value = () => q(".fs-rating .fs-num");

  it("pending ratings never get the confirmed accent; a later confirmed value does, once", () => {
    mount(rated(["win"], { value: 1583, after: 0 }));
    expect(value()?.classList.contains("fs-rating-confirmed")).toBe(false);
    // The match arrived, its rating is not observed yet: held last-confirmed value, no accent.
    push(rated(["win", "loss"], { value: 1583, after: 0 }));
    expect(host!.textContent).toContain("MR pendiente");
    expect(value()?.classList.contains("fs-rating-confirmed")).toBe(false);
    // The rating is observed: a separate, confirmed transition.
    push(rated(["win", "loss"], { value: 1570, after: 1 }));
    expect(host!.textContent).not.toContain("MR pendiente");
    expect(value()?.classList.contains("fs-rating-confirmed")).toBe(true);
    expect(value()?.textContent).toBe("1570");
    // The same confirmed value again is not a new transition (element kept, no replay).
    const el = value();
    push(rated(["win", "loss"], { value: 1570, after: 1 }));
    expect(value()).toBe(el);
  });

  it("a rating on page load is never animated", () => {
    mount(rated(["win", "loss"], { value: 1570, after: 1 }));
    expect(value()?.classList.contains("fs-rating-confirmed")).toBe(false);
  });
});

describe("PREPARE → LIVE stage reveal", () => {
  const stage = () => q("section#session");

  it("plays once when this page observes the session becoming active", () => {
    mount(dashState(SESSION.none(), { recent: true, generatedAt: (clock += 1_000) }));
    expect(stage()?.classList.contains("fs-stage-reveal")).toBe(false);
    push(live([]));
    expect(stage()?.classList.contains("fs-stage-reveal")).toBe(true);
    expect(q("#fs-active-title")?.classList.contains("fs-enter")).toBe(true);
    expect(document.activeElement?.id).toBe("fs-active-title");
  });

  it("a page load / refresh straight into LIVE is not a transition", () => {
    mount(live(["win"]));
    expect(stage()?.classList.contains("fs-stage-reveal")).toBe(false);
    expect(q("#fs-active-title")?.classList.contains("fs-enter")).toBe(false);
  });

  it("a failed start never shows a LIVE stage (no optimistic transition)", async () => {
    actions.startSessionAction.mockResolvedValue({ ok: false, error: "No se pudo iniciar." });
    mount(dashState(SESSION.none(), { recent: true, generatedAt: (clock += 1_000) }));
    const start = q('[data-k="start"]') as HTMLButtonElement;
    await act(async () => start.click());
    expect(q(".fs-stage-reveal")).toBeNull();
    expect(q("#fs-active-title")).toBeNull();
    expect(host!.textContent).toContain("No se pudo iniciar.");
  });
});
