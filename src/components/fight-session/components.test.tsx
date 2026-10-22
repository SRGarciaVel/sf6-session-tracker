/**
 * Phase 5.6B1 — Fight Session components rendered on the server path (renderToString) in Spanish
 * and English: statuses, scoreboard formatting, missing data, zero matches, MR/LP labels, long
 * names, disconnected Companion, button states, overlay actions, mobile and motion contracts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { ActivityList, LastMatch, RoundStrip } from "./Activity";
import { OverlayAccessCard, OverlayDock } from "./OverlayAccess";
import { CharacterLine, FightScoreboard, RatingSummary, SessionResults } from "./Scoreboard";
import { SessionStage } from "./SessionStage";
import { EndSessionControl, SessionActionBar, StartSessionButton } from "./SessionControls";
import { SessionStatusIndicator, StatusStrip } from "./SessionStatus";
import type { ActivityItem, SessionIndicatorStatus } from "./types";

const render = (node: ReactNode, locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const noop = vi.fn();

const STATUSES: SessionIndicatorStatus[] = ["ready", "blocked", "live", "degraded", "ended"];

describe("session status indicator", () => {
  it.each([
    [
      "es",
      [
        "Listo para jugar",
        "No listo",
        "Sesión en juego",
        "Sin datos recientes",
        "Sesión finalizada",
      ],
    ],
    ["en", ["Ready to play", "Not ready", "Session live", "No recent data", "Session ended"]],
  ] as const)("%s: every status has its own word (not colour alone)", (locale, words) => {
    STATUSES.forEach((status, i) => {
      const html = render(<SessionStatusIndicator status={status} duration="1h 04m" />, locale);
      expect(text(html)).toContain(words[i]!);
      expect(html).toContain(`data-status="${status}"`);
      expect(html).toContain('class="fs-lamp" aria-hidden="true"');
    });
  });
});

describe("status strip", () => {
  const overlays = { total: 2, inObs: 1 };
  it("disconnected Companion: says so, never 'connected', never a fake sync time", () => {
    const html = render(
      <StatusStrip
        status="blocked"
        companion={{ link: "notPaired", buckler: "never", lastSyncAt: null }}
        overlays={overlays}
        now={Date.parse("2026-10-21T20:00:00Z")}
      />,
    );
    const t = text(html);
    expect(t).toContain("Companion desconectado");
    expect(t).toContain("Inicia sesión en Buckler");
    expect(t).toContain("Sin sincronizar");
    expect(t).not.toContain("Conectado");
  });
  it("relative sync time from the supplied clock; none before mount", () => {
    const companion = {
      link: "connected" as const,
      buckler: "fresh" as const,
      lastSyncAt: "2026-10-21T20:00:00Z",
    };
    expect(
      text(
        render(
          <StatusStrip
            status="live"
            companion={companion}
            overlays={overlays}
            now={Date.parse("2026-10-21T20:00:12Z")}
          />,
        ),
      ),
    ).toContain("hace 12 s");
    expect(
      text(
        render(<StatusStrip status="live" companion={companion} overlays={overlays} now={null} />),
      ),
    ).not.toContain("hace");
  });
  it("only the session state is a live region (the ticking time is not announced)", () => {
    const html = render(
      <StatusStrip
        status="live"
        companion={{ link: "connected", buckler: "fresh", lastSyncAt: null }}
        overlays={overlays}
        now={0}
      />,
    );
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain("aria-live");
  });
  it("no Companion in this deployment ⇒ no Companion/Buckler items", () => {
    const t = text(
      render(
        <StatusStrip
          status="ready"
          companion={{ link: null, buckler: null, lastSyncAt: null }}
          overlays={null}
          now={0}
        />,
      ),
    );
    expect(t).not.toContain("Companion");
    expect(t).not.toContain("Buckler");
  });
  it("live link: a warning only while the dashboard stream is down", () => {
    const companion = { link: "connected" as const, buckler: "fresh" as const, lastSyncAt: null };
    const down = text(
      render(
        <StatusStrip
          status="live"
          companion={companion}
          overlays={null}
          now={0}
          realtime="reconnecting"
        />,
      ),
    );
    expect(down).toContain("Reconectando…");
    const open = text(
      render(
        <StatusStrip status="live" companion={companion} overlays={null} now={0} realtime="open" />,
      ),
    );
    expect(open).not.toContain("Reconectando");
  });
  it("English vocabulary", () => {
    const t = text(
      render(
        <StatusStrip
          status="degraded"
          companion={{ link: "quiet", buckler: "stale", lastSyncAt: null }}
          overlays={{ total: 1, inObs: 0 }}
          now={0}
        />,
        "en",
      ),
    );
    expect(t).toContain("No recent signal");
    expect(t).toContain("Not synced yet");
    expect(t).toContain("1 overlay");
    expect(t).toContain("none in OBS");
  });
});

describe("scoreboard", () => {
  it("formats with the app's formatters (ES / EN)", () => {
    const data = { wins: 5, losses: 2, draws: 0, games: 7, winRate: 71.4 };
    const es1 = text(render(<FightScoreboard data={data} />));
    expect(es1).toContain("71,4 %");
    expect(es1).toContain("7 partidas");
    expect(es1).toContain("5 victorias, 2 derrotas, 71,4 % de victorias en 7 partidas");
    const en1 = text(render(<FightScoreboard data={data} />, "en"));
    expect(en1).toContain("71.4%");
    expect(en1).toContain("5 wins, 2 losses, 71.4% win rate over 7 games");
  });
  it("zero matches: «—», no meter segments, «0 partidas»", () => {
    const html = render(
      <FightScoreboard data={{ wins: 0, losses: 0, draws: 0, games: 0, winRate: null }} />,
    );
    expect(html).toMatch(/data-testid="fs-winrate">—</);
    expect(html).not.toContain("flex-grow");
    expect(text(html)).toContain("0 partidas");
  });
  it("win/loss sides carry labels and the hit only on the changed side", () => {
    const html = render(
      <FightScoreboard
        data={{ wins: 1, losses: 0, draws: 0, games: 1, winRate: 100 }}
        highlight="win"
      />,
    );
    expect(html).toMatch(/class="fs-num text-win fs-hit" data-testid="fs-wins">1</);
    expect(html).toMatch(/class="fs-num text-loss" data-testid="fs-losses">0</);
    expect(text(html)).toContain("Victorias");
    expect(text(html)).toContain("Derrotas");
  });
  it("draws only: says no decided games instead of 0 %", () => {
    const t = text(
      render(<FightScoreboard data={{ wins: 0, losses: 0, draws: 1, games: 1, winRate: null }} />),
    );
    expect(t).toContain("Sin partidas decididas");
    expect(t).toContain("1 empate");
  });
});

describe("rating summary", () => {
  const base = {
    characterName: "Ryu",
    system: "mr" as const,
    initial: 1571,
    current: 1602,
    delta: 31,
    pending: false,
  };
  it("MR label, from → now and the session delta with a glyph", () => {
    const t = text(render(<RatingSummary rating={base} />));
    expect(t).toMatch(/Ryu desde\s+1571\s+1602\s+MR\s+Cambio en la sesión\s*:\s+▲\s+\+31/);
  });
  it("LP label (ES grouping from formatInteger) and EN", () => {
    const lp = { ...base, system: "lp" as const, initial: 21850, current: 21950, delta: 100 };
    expect(text(render(<RatingSummary rating={lp} />))).toContain("21.950 LP");
    expect(text(render(<RatingSummary rating={lp} />, "en"))).toContain("21,950 LP");
  });
  it("pending: last confirmed value, explicit tag and explanation", () => {
    const t = text(
      render(<RatingSummary rating={{ ...base, current: 1593, delta: 22, pending: true }} />),
    );
    expect(t).toContain("1593");
    expect(t).toContain("MR pendiente");
    expect(t).toContain("Esperando tu perfil para confirmar el MR de la última partida.");
  });
  it("missing final rating: «—» and why, no delta", () => {
    const t = text(render(<RatingSummary rating={{ ...base, current: null, delta: null }} />));
    expect(t).toContain("—");
    expect(t).toContain("MR final no disponible");
    expect(t).not.toContain("Cambio en la sesión");
  });
  it("unknown baseline: no arrow, explains the missing delta", () => {
    const t = text(
      render(<RatingSummary rating={{ ...base, initial: null, delta: null }} />, "en"),
    );
    expect(t).toContain("No starting MR");
    expect(t).not.toContain("from");
  });
  it("±0 for an unchanged rating", () => {
    expect(text(render(<RatingSummary rating={{ ...base, current: 1571, delta: 0 }} />))).toContain(
      "±0",
    );
  });
  it("character line for Prepare (no session delta)", () => {
    const t = text(
      render(
        <CharacterLine characterName="Ryu" rank="Master" rating={{ system: "mr", value: 1613 }} />,
      ),
    );
    expect(t).toContain("Ryu Master 1613 MR");
  });
});

describe("recap results bar", () => {
  const data = { wins: 7, losses: 3, draws: 0, games: 10, winRate: 70 };
  const rating = {
    characterName: "Ryu",
    system: "mr" as const,
    initial: 1571,
    current: 1613,
    delta: 42,
    pending: false,
  };
  it("games, W, L, % and the session change with its range", () => {
    const t = text(render(<SessionResults data={data} rating={rating} />));
    expect(t).toMatch(/Partidas\s+10\s+Victorias\s+7\s+Derrotas\s+3\s+% de victorias\s+70 %/);
    expect(t).toMatch(/Cambio en la sesión · Ryu\s+▲\s+\+42\s+1571 → 1613 MR/);
  });
  it("final rating unavailable is explained, never shown as 0", () => {
    const t = text(
      render(
        <SessionResults data={data} rating={{ ...rating, current: null, delta: null }} />,
        "en",
      ),
    );
    expect(t).toContain("Final MR unavailable");
    expect(t).not.toContain("±0");
  });
  it("zero games and no rating character", () => {
    const t = text(
      render(
        <SessionResults
          data={{ wins: 0, losses: 0, draws: 0, games: 0, winRate: null }}
          rating={null}
        />,
      ),
    );
    expect(t).toMatch(/Partidas\s+0/);
    expect(t).toContain("—");
    expect(t).not.toContain("Cambio en la sesión");
  });
});

describe("stage", () => {
  it("ghost name and slash are decorative (hidden from assistive tech)", () => {
    const html = render(
      <SessionStage ghost="Ryu" labelledBy="h">
        <h2 id="h">x</h2>
      </SessionStage>,
    );
    expect(html).toContain('<span class="fs-ghost" aria-hidden="true">Ryu</span>');
    expect(html).toContain('<span class="fs-slash" aria-hidden="true"></span>');
    expect(html).toContain('aria-labelledby="h"');
  });
});

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: "m1",
  result: "win",
  characterName: "Ryu",
  opponentCharacter: "Ken",
  opponentName: "Rival 1",
  playedAt: "2026-10-21T19:36:00Z",
  ...over,
});

describe("activity", () => {
  it("round strip: numbered, lettered markers with accessible names", () => {
    const html = render(<RoundStrip results={["win", "loss", "draw"]} newestIsNew />);
    expect(text(html)).toMatch(/1 V 2 D 3 E/);
    expect(html).toContain('aria-label="Partida 2: Derrota"');
    expect(html.match(/fs-round-new/g)).toHaveLength(1);
    expect(render(<RoundStrip results={[]} />)).toBe("");
    expect(text(render(<RoundStrip results={["win"]} titled />, "en"))).toMatch(/^\s*Matches/);
  });
  it("last match: result, opponent, time; announces only when new", () => {
    const fresh = render(<LastMatch item={item()} isNew />);
    expect(text(fresh)).toContain("Victoria vs Ken");
    expect(text(fresh)).toContain("Partida registrada: Victoria contra Ken");
    expect(fresh).toContain("19:36");
    const old = render(<LastMatch item={item()} />);
    expect(text(old)).not.toContain("Partida registrada");
  });
  it("long names truncate instead of overflowing", () => {
    const html = render(
      <LastMatch
        item={item({
          opponentCharacter: null,
          opponentName: "UnNombreDeRivalMuyLargoParaProbarElTruncado",
        })}
      />,
    );
    expect(html).toContain("UnNombreDeRivalMuyLargoParaProbarElTruncado");
    expect(html).toMatch(/class="m-0 truncate font-display/);
  });
  it("unknown opponent is said, not invented", () => {
    expect(
      text(
        render(<LastMatch item={item({ opponentCharacter: null, opponentName: null })} />, "en"),
      ),
    ).toContain("Win vs Unknown opponent");
  });
  it("empty vs waiting states; list never shows a per-match rating", () => {
    expect(text(render(<ActivityList items={[]} />))).toContain(
      "No se ha registrado ninguna partida",
    );
    expect(text(render(<ActivityList items={[]} waiting />, "en"))).toContain(
      "Waiting for your first Ranked match…",
    );
    const list = text(
      render(
        <ActivityList
          items={[item(), item({ id: "m2", result: "loss", opponentCharacter: "Juri" })]}
        />,
      ),
    );
    expect(list).toMatch(/2\s*\.\s*Ryu vs Juri.*1\s*\.\s*Ryu vs Ken/);
    expect(list).not.toMatch(/MR|LP/);
  });
});

describe("controls (presentational)", () => {
  const startButton = (html: string) => /<button[^>]*data-k="start"[^>]*>/.exec(html)?.[0] ?? "";
  it("start: enabled / pending (busy, label) / disabled, long labels in both languages", () => {
    expect(startButton(render(<StartSessionButton onStart={noop} />))).not.toContain("disabled");
    const pending = render(<StartSessionButton onStart={noop} pending />);
    expect(startButton(pending)).toContain('aria-busy="true"');
    expect(startButton(pending)).toContain("disabled");
    expect(text(pending)).toContain("Iniciando…");
    expect(
      startButton(render(<StartSessionButton onStart={noop} disabled describedBy="why" />)),
    ).toContain('aria-describedby="why"');
    expect(text(render(<StartSessionButton onStart={noop} />, "en"))).toContain(
      "Start game session",
    );
  });
  it("end: one button, then an inline confirm group (no modal)", () => {
    const idle = render(
      <EndSessionControl confirming={false} onAsk={noop} onCancel={noop} onConfirm={noop} />,
    );
    expect(text(idle)).toContain("Finalizar sesión");
    expect(idle).not.toContain("confirm-end");
    const confirming = render(
      <EndSessionControl confirming onAsk={noop} onCancel={noop} onConfirm={noop} />,
      "en",
    );
    expect(confirming).toContain('role="group"');
    expect(text(confirming)).toContain("It will be saved with the matches recorded so far.");
    expect(text(confirming)).toContain("Keep playing");
    expect(text(confirming)).toContain("Yes, end session");
    const ending = render(
      <EndSessionControl confirming pending onAsk={noop} onCancel={noop} onConfirm={noop} />,
    );
    expect(text(ending)).toContain("Finalizando…");
  });
  it("all session controls are native buttons (keyboard-operable)", () => {
    const html = render(
      <>
        <StartSessionButton onStart={noop} />
        <EndSessionControl confirming onAsk={noop} onCancel={noop} onConfirm={noop} />
      </>,
    );
    expect(html.match(/<button type="button"/g)).toHaveLength(3);
  });
  it("mobile: the action bar is fixed to the bottom below `sm` only", () => {
    const html = render(
      <SessionActionBar>
        <StartSessionButton onStart={noop} />
      </SessionActionBar>,
    );
    expect(html).toContain("max-sm:fixed");
    expect(html).toContain("max-sm:bottom-0");
    expect(html).not.toMatch(/(^|\s)fixed(\s|")/);
  });
});

describe("overlay access", () => {
  const card = (locale: "es" | "en" = "es") =>
    render(
      <OverlayAccessCard
        name="Marcador principal para los directos de los viernes por la noche"
        kind="session"
        canvas={{ width: 800, height: 180 }}
        url="https://sst.example/overlay/tok"
        configureHref="/dashboard/overlays/1"
        previewHref="https://sst.example/overlay/tok"
        inObs
      />,
      locale,
    );
  it("configure, copy and preview with unambiguous accessible names", () => {
    const html = card();
    expect(html).toContain(
      'aria-label="Copiar URL para OBS de Marcador principal para los directos de los viernes por la noche"',
    );
    expect(html).toContain('href="/dashboard/overlays/1"');
    expect(html).toMatch(/target="_blank" rel="noopener noreferrer"/);
    expect(text(html)).toContain("Sesión · 800 × 180");
    expect(text(html)).toContain("En OBS");
    expect(html).toContain("truncate");
  });
  it("English and unknown OBS state (nothing claimed)", () => {
    expect(text(card("en"))).toContain("Copy URL for OBS");
    const unknown = render(
      <OverlayAccessCard
        name="R"
        kind="rankProgress"
        canvas={{ width: 640, height: 140 }}
        url="u"
        configureHref="c"
        previewHref="p"
      />,
    );
    expect(text(unknown)).toContain("Progreso de rango");
    expect(text(unknown)).not.toMatch(/En OBS|Sin conectar/);
  });
  it("dock: manage link and honest empty state", () => {
    const t = text(render(<OverlayDock count={0} manageHref="/dashboard#overlays" />, "en"));
    expect(t).toContain("Manage overlays");
    expect(t).toContain("You don't have any overlays yet.");
  });
});

describe("rollout scope: only the gated Fight Session dashboard uses the foundation", () => {
  // Phase 5.6B2: the experimental dashboard (behind server/features/fight-session.ts) is the only
  // consumer; the classic dashboard, recap and every other route stay untouched.
  const PAGE = join("src/app", "(app)/dashboard/page.tsx");
  const FIGHT_DIR = join("src/app", "(app)/dashboard/_components/fight") + "/";
  // Phase 5.6B3: the dashboard stream asks the gate whether to build the recent-match projection.
  const STREAM = join("src/app", "api/me/stream/route.ts");
  it("no other route or component imports it or uses fs-* classes", () => {
    const files = (readdirSync("src/app", { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.tsx"))
      .map((f) => join("src/app", f))
      .filter((f) => f !== PAGE && f !== STREAM && !f.startsWith(FIGHT_DIR));
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("fight-session") || /["'\s]fs-[a-z]/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe("style contracts", () => {
  const css = readFileSync("src/app/(app)/globals.css", "utf8");
  it("clipped controls draw focus inside the shape", () => {
    expect(css).toMatch(
      /\.fs-cta:focus-visible,\s*\.fs-btn:focus-visible \{\s*outline: none;\s*box-shadow:/,
    );
  });
  it("reduced motion flattens every animation (global rule still last)", () => {
    const reduce = css.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(reduce).toBeGreaterThan(css.indexOf("@keyframes fs-hit"));
    expect(css.slice(reduce)).toContain("animation-duration: 1ms !important");
  });
  it("the scoreboard recomposes below 40rem (W | L, win rate underneath)", () => {
    expect(css).toMatch(
      /@media \(max-width: 40rem\) \{\s*\.fs-versus \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    );
  });
});
