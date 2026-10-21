// @vitest-environment happy-dom
/**
 * Phase 5.6B1 — client behaviour: keyboard/focus management of the end-session confirm, button
 * callbacks and disabled states, and SSR → hydration of the full component set without
 * mismatches (server markup from renderToString, hydrated with hydrateRoot).
 */
import { NextIntlClientProvider } from "next-intl";
import { act, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";
import { ActivityList, LastMatch, RoundStrip } from "./Activity";
import { OverlayAccessCard, OverlayDock } from "./OverlayAccess";
import { FightScoreboard, RatingSummary } from "./Scoreboard";
import { EndSessionControl, SessionActionBar, StartSessionButton } from "./SessionControls";
import { StatusStrip } from "./SessionStatus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wrap = (node: ReactNode) => (
  <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});
function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(wrap(node)));
  return host;
}
const byK = (k: string) => host!.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

function EndHarness({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <EndSessionControl
      confirming={confirming}
      onAsk={() => setConfirming(true)}
      onCancel={() => setConfirming(false)}
      onConfirm={onConfirm}
    />
  );
}

describe("end session: keyboard and focus", () => {
  it("asking moves focus to «Seguir jugando»; Esc cancels and returns focus to «Finalizar»", () => {
    const onConfirm = vi.fn();
    mount(<EndHarness onConfirm={onConfirm} />);
    act(() => byK("end")!.click());
    expect(document.activeElement).toBe(byK("cancel-end"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(byK("confirm-end")).toBeNull();
    expect(document.activeElement).toBe(byK("end"));
    expect(onConfirm).not.toHaveBeenCalled();
  });
  it("confirm calls back once; Esc does nothing when not confirming", () => {
    const onConfirm = vi.fn();
    mount(<EndHarness onConfirm={onConfirm} />);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(byK("end")).not.toBeNull();
    act(() => byK("end")!.click());
    act(() => byK("confirm-end")!.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("start button states", () => {
  it("click starts; disabled and pending do not", () => {
    const onStart = vi.fn();
    mount(
      <>
        <StartSessionButton onStart={onStart} />
      </>,
    );
    act(() => byK("start")!.click());
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => root!.render(wrap(<StartSessionButton onStart={onStart} disabled />)));
    expect(byK("start")!.disabled).toBe(true);
    act(() => root!.render(wrap(<StartSessionButton onStart={onStart} pending />)));
    expect(byK("start")!.disabled).toBe(true);
    expect(byK("start")!.getAttribute("aria-busy")).toBe("true");
  });
  it("is focusable by keyboard (native button, tabIndex 0)", () => {
    mount(<StartSessionButton onStart={vi.fn()} />);
    byK("start")!.focus();
    expect(document.activeElement).toBe(byK("start"));
    expect(byK("start")!.tabIndex).toBe(0);
  });
});

describe("SSR → hydration", () => {
  it("the whole set hydrates the server markup without mismatches", () => {
    const tree = wrap(
      <main>
        <StatusStrip
          status="live"
          duration="1h 04m"
          companion={{ link: "connected", buckler: "fresh", lastSyncAt: "2026-10-21T20:00:00Z" }}
          overlays={{ total: 2, inObs: 1 }}
          now={Date.parse("2026-10-21T20:00:12Z")}
        />
        <FightScoreboard
          data={{ wins: 5, losses: 2, draws: 0, games: 7, winRate: 71.4 }}
          highlight="win"
        />
        <RatingSummary
          rating={{
            characterName: "Ryu",
            system: "mr",
            initial: 1571,
            current: 1593,
            delta: 22,
            pending: true,
          }}
        />
        <RoundStrip results={["win", "loss", "win"]} newestIsNew />
        <LastMatch
          item={{
            id: "m3",
            result: "win",
            characterName: "Ryu",
            opponentCharacter: "Ken",
            opponentName: "R",
            playedAt: "2026-10-21T19:48:00Z",
          }}
          isNew
        />
        <ActivityList items={[]} waiting />
        <SessionActionBar>
          <StartSessionButton onStart={() => undefined} />
          <EndSessionControl
            confirming={false}
            onAsk={() => undefined}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
        </SessionActionBar>
        <OverlayDock count={1} manageHref="/x">
          <OverlayAccessCard
            name="Marcador"
            kind="session"
            canvas={{ width: 800, height: 180 }}
            url="u"
            configureHref="/c"
            previewHref="/p"
            inObs={null}
          />
        </OverlayDock>
      </main>,
    );
    const html = renderToString(tree);
    host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a));
    act(() => {
      root = hydrateRoot(host!, tree, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(host.querySelector('[data-k="start"]')).not.toBeNull();
  });
});
