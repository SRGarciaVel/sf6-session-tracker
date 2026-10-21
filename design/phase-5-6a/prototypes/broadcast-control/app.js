/**
 * Direction A — BROADCAST CONTROL. SST as a live-production control surface: a program tally,
 * channel readouts, an event log and an output rack. Local fictional state only.
 */
import { DEMO, clock, derive, matchTime } from "../shared/engine.js";
import { boot } from "../shared/shell.js";
import { conceptTag, esc, fmt, labHtml, translator } from "../shared/ui.js";

const EXTRA = {
  es: {
    a: {
      program: "Programa",
      ready: "Listo",
      notReady: "No listo",
      onAir: "En directo",
      closed: "Sesión cerrada",
      monitor: "Monitor de sesión",
      signals: "Señales",
      outputs: "Salidas · overlays",
      log: "Registro",
      logEmpty: "Sin eventos todavía",
      report: "Informe de sesión",
      rundown: "Partida",
      spec: "Al iniciar",
      evStart: "Sesión iniciada",
      evMatch: "Partida",
      evPending: "MR pendiente",
      evRating: "MR confirmado",
      evEnd: "Sesión finalizada",
      allSignals: "4/4 señales correctas",
      someSignals: "Revisa las señales",
      openOverlays: "Gestionar overlays",
      outputsHint: "Cada overlay es una fuente de navegador en OBS. Se actualiza solo.",
      unitGames: "partidas",
      armed: "Armado",
      kindSession: "Sesión",
      kindRank: "Progreso de rango",
    },
  },
  en: {
    a: {
      program: "Program",
      ready: "Ready",
      notReady: "Not ready",
      onAir: "Live",
      closed: "Session closed",
      monitor: "Session monitor",
      signals: "Signals",
      outputs: "Outputs · overlays",
      log: "Log",
      logEmpty: "No events yet",
      report: "Session report",
      rundown: "Match",
      spec: "When you start",
      evStart: "Session started",
      evMatch: "Match",
      evPending: "MR pending",
      evRating: "MR confirmed",
      evEnd: "Session ended",
      allSignals: "4/4 signals OK",
      someSignals: "Check the signals",
      openOverlays: "Manage overlays",
      outputsHint: "Each overlay is an OBS browser source. It updates by itself.",
      unitGames: "games",
      armed: "Armed",
      kindSession: "Session",
      kindRank: "Rank progress",
    },
  },
};

/* ───────── pieces ───────── */

const led = (tone, label) =>
  `<span class="led led-${tone}" aria-hidden="true"></span><span class="sr-only">${esc(label)}</span>`;

function signals(s, t) {
  const tone = s.companion === "on" ? "ok" : s.companion === "quiet" ? "warn" : "off";
  const set = s.companion === "on" ? "ok" : s.companion === "quiet" ? "quiet" : "off";
  const rows = [
    ["companion", tone],
    ["buckler", tone],
    ["profile", s.companion === "off" ? "off" : "ok"],
    ["character", "ok"],
  ];
  return `
  <section class="rack-block" aria-labelledby="sig-h">
    <h2 class="block-h" id="sig-h"><span>${esc(t("a.signals"))}</span>
      <span class="mono ${tone === "ok" ? "ok" : "warn"}">${esc(tone === "ok" ? t("a.allSignals") : t("a.someSignals"))}</span></h2>
    <dl class="signals">
      ${rows
        .map(
          ([
            k,
            tn,
          ]) => `<div class="sig sig-${tn}"><dt>${led(tn, tn)}${esc(t(`readiness.${k}`))}</dt>
          <dd>${tn === "ok" ? "● " : tn === "warn" ? "⚠ " : "○ "}${esc(t(`readiness.${tn === "ok" ? "ok" : set}.${k}`))}</dd></div>`,
        )
        .join("")}
    </dl>
  </section>`;
}

function miniOverlay(o, d, f) {
  if (o.kind === "rank")
    return `<div class="mini mini-rank" aria-hidden="true"><b>MASTER</b><span>${f.int(d.current ?? DEMO.baseline)} MR</span><i style="width:62%"></i></div>`;
  return `<div class="mini mini-session" aria-hidden="true">
    <span class="w">${f.int(d.wins)}</span><span class="sl">/</span><span class="l">${f.int(d.losses)}</span>
    <span class="p">${f.pct(d.winRate)}</span><span class="r">${f.int(d.current)} <small>MR</small></span></div>`;
}

function outputs(s, d, f, t, full = false) {
  return `
  <section class="rack-block" aria-labelledby="out-h">
    <h2 class="block-h" id="out-h"><span>${esc(t("a.outputs"))}</span>
      ${full ? "" : `<button type="button" class="link" data-act="view:overlays" data-k="to-overlays">${esc(t("a.openOverlays"))} →</button>`}</h2>
    <ul class="outputs ${full ? "outputs-full" : ""}">
      ${DEMO.overlays
        .map(
          (o) => `<li class="out">
        ${miniOverlay(o, d, f)}
        <div class="out-meta">
          <p class="out-name">${esc(o.name)}</p>
          <p class="mono dim">${esc(o.kind === "rank" ? t("a.kindRank") : t("a.kindSession"))} · ${esc(o.theme)} · ${esc(o.size)}</p>
          <p class="mono ${o.obs ? "ok" : "dim"}">${led(o.obs ? "ok" : "off", "")}${esc(o.obs ? t("common.inObs") : t("common.notInObs"))}</p>
        </div>
        <div class="out-actions">
          <button type="button" class="btn btn-sm" data-act="copy" data-k="copy-${o.id}">${esc(t("common.copyUrl"))}</button>
          <button type="button" class="btn btn-sm btn-ghost" data-act="toast:${o.id}" data-k="cfg-${o.id}">${esc(t("common.configure"))}</button>
        </div></li>`,
        )
        .join("")}
    </ul>
    ${full ? `<button type="button" class="btn btn-ghost" data-act="toast:new" data-k="new-ov">+ ${esc(t("common.newOverlay"))}</button>` : ""}
    <p class="hint">${esc(t("a.outputsHint"))}</p>
  </section>`;
}

function tally(s, d, f, t) {
  const st =
    s.phase === "live"
      ? { cls: "air", label: t("a.onAir"), extra: f.duration(d.minutes) }
      : s.phase === "recap"
        ? { cls: "closed", label: t("a.closed"), extra: f.duration(d.minutes) }
        : s.companion === "on"
          ? { cls: "ready", label: t("a.ready"), extra: "" }
          : { cls: "blocked", label: t("a.notReady"), extra: "" };
  const sync = s.companion === "on" ? t("session.syncOk") : s.companion === "quiet" ? "6 min" : "—";
  return `
  <div class="tally tally-${st.cls}" role="status" aria-live="polite">
    <div class="tally-state"><span class="tally-lamp" aria-hidden="true"></span>
      <span class="mono dim">${esc(t("a.program"))}</span><strong>${esc(st.label)}</strong>
      ${st.extra ? `<span class="mono">${esc(st.extra)}</span>` : ""}</div>
    <div class="tally-char"><strong>${esc(DEMO.character.name)}</strong><span class="mono dim">${esc(DEMO.character.league)}</span>
      <span class="tabular">${f.int(d.current ?? DEMO.baseline)} <small>MR</small></span></div>
    <div class="tally-sync mono"><span>${esc(t("session.sync"))}</span>${led(s.companion === "on" ? "ok" : s.companion === "quiet" ? "warn" : "off", "")}<span>${esc(sync)}</span></div>
  </div>`;
}

function readout(label, value, cls, attrs = "") {
  return `<div class="ro ${cls}"><span class="ro-l">${esc(label)}</span><span class="ro-v tabular" ${attrs}>${value}</span></div>`;
}

function readouts(s, d, f, t) {
  const ev = s.event;
  const winBump = ev?.kind === "match" && d.last?.result === "win";
  const lossBump = ev?.kind === "match" && d.last?.result === "loss";
  const prevConfirmed =
    [...d.journey]
      .slice(0, -1)
      .reverse()
      .find((x) => x !== null) ?? DEMO.baseline;
  const mrBump = ev?.kind === "rating" && d.current !== null;
  const mrVal = d.current === null ? "—" : f.int(d.current);
  return `
  <div class="readouts">
    ${readout(t("common.wins"), f.int(d.wins), "ro-win", winBump ? `data-count-from="${d.wins - 1}" data-count-to="${d.wins}"` : "")}
    ${readout(t("common.losses"), f.int(d.losses), "ro-loss", lossBump ? `data-count-from="${d.losses - 1}" data-count-to="${d.losses}"` : "")}
    ${readout(t("common.winRate"), f.pct(d.winRate), "")}
    <div class="ro ro-mr${d.pending ? " is-pending" : ""}">
      <span class="ro-l">MR · ${esc(DEMO.character.name)}</span>
      <span class="ro-v tabular" ${mrBump ? `data-count-from="${prevConfirmed}" data-count-to="${d.current}"` : ""}>${mrVal}</span>
      <span class="ro-sub ${f.deltaTone(d.delta)}">${esc(f.delta(d.delta))} <span class="dim">${esc(t("session.from"))} ${f.int(DEMO.baseline)}</span></span>
      ${d.pending ? `<span class="pending mono" title="${esc(t("common.pendingLong"))}">⏳ ${esc(t("common.pending"))}</span>` : ""}
    </div>
  </div>
  <div class="ratio" role="img" aria-label="${esc(`${d.wins} ${t("common.wins")} · ${d.losses} ${t("common.losses")}`)}">
    ${d.games === 0 ? "" : `<span class="rw" style="flex:${d.wins}"></span><span class="rl" style="flex:${d.losses}"></span>`}
  </div>`;
}

function eventLog(s, d, f, t) {
  const rows = [];
  rows.push({ time: clock(DEMO.startMinute), text: t("a.evStart"), tone: "info" });
  s.matches.forEach((m, i) => {
    const resWord = m.result === "win" ? t("common.winWord") : t("common.lossWord");
    rows.push({
      id: m.id,
      time: matchTime(i),
      text: `${t("a.evMatch")} ${String(m.n).padStart(2, "0")} · <b class="${m.result}">${esc(m.result === "win" ? t("common.win") : t("common.loss"))}</b> ${esc(resWord)} ${esc(t("common.vs"))} ${esc(m.opp)}`,
      mr:
        m.mrAfter === null
          ? `<span class="warn">⏳ ${esc(t("a.evPending"))}</span>`
          : `MR ${f.int(m.mrAfter)}`,
      raw: true,
    });
  });
  const fresh = (id) =>
    s.event && s.event.matchId === id && (s.event.kind === "match" || s.event.kind === "rating");
  return `
  <section class="log" aria-labelledby="log-h">
    <h3 class="block-h" id="log-h"><span>${esc(t("a.log"))}${conceptTag(t)}</span><span class="mono dim">${s.matches.length} ${esc(t("a.unitGames"))}</span></h3>
    <ol class="log-list" aria-live="polite">
      ${rows
        .reverse()
        .map(
          (
            r,
          ) => `<li class="${r.id && fresh(r.id) ? "is-new" : ""}"><span class="mono dim">${esc(r.time)}</span>
          <span>${r.raw ? r.text : esc(r.text)}</span><span class="mono">${r.mr ?? ""}</span></li>`,
        )
        .join("")}
    </ol>
  </section>`;
}

/* ───────── screens ───────── */

function prepare(s, d, f, t) {
  const blocked = s.companion !== "on";
  const prev = s.lastRecap
    ? {
        games: s.lastRecap.games,
        wins: s.lastRecap.wins,
        losses: s.lastRecap.losses,
        from: DEMO.baseline,
        to: s.lastRecap.current,
        day: t("session.today"),
        winRate: s.lastRecap.winRate,
      }
    : {
        ...DEMO.previous,
        day: t("session.yesterday"),
        winRate: DEMO.previous.wins / DEMO.previous.games,
      };
  return `
  <section class="panel monitor" aria-labelledby="mon-h">
    <header class="panel-h"><h1 id="mon-h">${esc(t("a.monitor"))}</h1><span class="mono dim">${esc(DEMO.player.game.toUpperCase())}</span></header>
    ${
      blocked
        ? `<div class="alert" role="alert"><p class="alert-t">⚠ ${esc(t("readiness.fixTitle"))}</p><p>${esc(t("readiness.fixBody"))}</p>
           <div class="alert-a"><a class="link" href="#" data-act="toast:help" data-k="help">${esc(t("readiness.fixAction"))} →</a>
           <button type="button" class="btn btn-sm btn-ghost" data-act="companion:on" data-k="retry">${esc(t("readiness.retry"))}</button></div></div>`
        : ""
    }
    <div class="spec">
      <p class="mono dim">${esc(t("a.spec"))}</p>
      <dl class="spec-grid">
        <div><dt>${esc(t("session.tracked"))}</dt><dd>${esc(t("session.trackedRanked"))}</dd></div>
        <div><dt>${esc(DEMO.character.name)}</dt><dd>${esc(t("session.trackedFrom"))} <span class="tabular">${f.int(DEMO.baseline)}</span></dd></div>
        <div><dt>${esc(t("session.trackedOverlays"))}</dt><dd>${DEMO.overlays.length} · ${DEMO.overlays.map((o) => esc(o.name)).join(", ")}</dd></div>
      </dl>
    </div>
    <div class="go">
      <button type="button" class="btn-go${s.starting ? " is-starting" : ""}" data-act="start" data-k="start" ${blocked || s.starting ? "disabled" : ""}
        aria-describedby="go-help">
        <span class="go-lamp" aria-hidden="true"></span>
        <span>${esc(s.starting ? t("session.starting") : t("session.start"))}</span>
        <span class="mono go-state">${esc(blocked ? t("a.notReady") : t("a.armed"))}</span>
      </button>
      <p class="hint" id="go-help">${esc(t("session.startHelp"))}</p>
    </div>
    <div class="prev">
      <p class="block-h"><span>${esc(t("session.previous"))}</span></p>
      ${
        s.hasPrevious
          ? `<p class="prev-row"><span class="mono dim">${esc(prev.day)}</span>
             <span>${f.int(prev.games)} ${esc(t("a.unitGames"))}</span>
             <span><b class="win">${f.int(prev.wins)} ${esc(t("common.win"))}</b> · <b class="loss">${f.int(prev.losses)} ${esc(t("common.loss"))}</b></span>
             <span class="tabular">${f.pct(prev.winRate)}</span>
             <span class="tabular">Ryu ${f.int(prev.from)} → ${f.int(prev.to)} <b class="${f.deltaTone(prev.to - prev.from)}">${esc(f.delta(prev.to - prev.from))}</b></span></p>`
          : `<p class="dim">${esc(t("session.previousNone"))}</p>`
      }
    </div>
  </section>`;
}

function live(s, d, f, t) {
  const quiet = s.companion !== "on";
  return `
  <section class="panel monitor" aria-labelledby="mon-h">
    <header class="panel-h"><h1 id="mon-h">${esc(t("a.monitor"))}</h1>
      <div class="end">${
        s.confirmEnd
          ? `<span class="end-q">${esc(t("session.endHint"))}</span>
             <button type="button" class="btn btn-sm btn-ghost" data-act="cancelEnd" data-k="cancel-end">${esc(t("session.cancel"))}</button>
             <button type="button" class="btn btn-sm btn-danger" data-act="end" data-k="confirm-end">${esc(t("session.confirmEnd"))}</button>`
          : `<button type="button" class="btn btn-sm btn-danger-ghost" data-act="askEnd" data-k="ask-end">■ ${esc(t("session.end"))}</button>`
      }</div></header>
    ${quiet ? `<div class="alert alert-warn" role="status"><p class="alert-t">⚠ ${esc(t("readiness.quietTitle"))}</p><p>${esc(t("readiness.quietBody"))}</p></div>` : ""}
    ${s.event?.kind === "started" ? `<p class="flash" role="status">● ${esc(t("session.started"))}</p>` : ""}
    ${readouts(s, d, f, t)}
    ${d.games === 0 ? `<div class="waiting"><p>${esc(t("session.waiting"))}</p><p class="dim">${esc(t("session.waitingHint"))}</p></div>` : ""}
    ${eventLog(s, d, f, t)}
  </section>`;
}

function journeySvg(d, f, t) {
  const pts = d.journey;
  const known = pts.filter((x) => x !== null);
  if (known.length < 2) return `<p class="dim">${esc(t("session.journeyGap"))}</p>`;
  const W = 640;
  const H = 120;
  const min = Math.min(...known) - 6;
  const max = Math.max(...known) + 6;
  const x = (i) => 8 + (i * (W - 16)) / (pts.length - 1);
  const y = (v) => H - 10 - ((v - min) * (H - 20)) / (max - min);
  let path = "";
  pts.forEach((v, i) => {
    if (v === null) return;
    path += `${path && pts[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
  });
  const base = y(DEMO.baseline);
  return `<svg class="journey" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${t("session.journey")}: ${known.map((v) => f.int(v)).join(", ")}`)}">
    <line x1="0" x2="${W}" y1="${base}" y2="${base}" class="j-base"/>
    <text x="4" y="${base - 6}" class="j-t">${f.int(DEMO.baseline)}</text>
    <path d="${path}" class="j-line"/>
    ${pts.map((v, i) => (v === null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="3" class="j-dot"/>`)).join("")}
  </svg>`;
}

function recap(s, d, f, t) {
  const empty = d.games === 0;
  const actionsHtml = `<div class="rep-actions">
      <button type="button" class="btn btn-primary" data-act="prepareAnother" data-k="again">${esc(t("session.prepareAnother"))}</button>
      <button type="button" class="btn btn-ghost" data-act="toDashboard" data-k="back">${esc(t("session.backToPanel"))}</button>
    </div>`;
  const range = `${clock(DEMO.startMinute)}–${clock(DEMO.startMinute + d.minutes)}`;
  return `
  <section class="panel monitor report" aria-labelledby="rep-h">
    <header class="panel-h"><h1 id="rep-h">${esc(t("a.report"))}</h1><span class="mono dim">${esc(range)} · ${esc(f.duration(d.minutes))}</span></header>
    ${s.event?.kind === "ended" ? `<p class="flash flash-ok" role="status">✓ ${esc(t("session.recapEnded"))}</p>` : ""}
    ${
      empty
        ? `<div class="waiting"><p>${esc(t("session.emptyRecap"))}</p><p class="dim">${esc(t("session.emptyRecapBody"))}</p></div>`
        : `<div class="readouts readouts-5">
        ${readout(t("common.games"), f.int(d.games), "")}
        ${readout(t("common.wins"), f.int(d.wins), "ro-win")}
        ${readout(t("common.losses"), f.int(d.losses), "ro-loss")}
        ${readout(t("common.winRate"), f.pct(d.winRate), "")}
        <div class="ro ro-mr"><span class="ro-l">${esc(t("session.sessionDelta"))} · Ryu</span>
          ${
            d.delta === null
              ? `<span class="ro-v dim">—</span><span class="ro-sub warn">${esc(t("session.ratingUnavailable"))}</span>`
              : `<span class="ro-v tabular ${f.deltaTone(d.delta)}">${esc(f.delta(d.delta))}</span><span class="ro-sub dim tabular">${f.int(DEMO.baseline)} → ${f.int(d.current)} MR</span>`
          }</div>
      </div>
      ${d.delta === null ? `<p class="alert alert-warn">${esc(t("session.ratingUnavailableBody"))}</p>` : ""}
      ${actionsHtml}
      <div class="rep-grid">
        <div><p class="block-h"><span>${esc(t("session.journey"))}${conceptTag(t)}</span></p>${journeySvg(d, f, t)}</div>
        <div><p class="block-h"><span>${esc(t("session.matches"))}</span></p>
          <ol class="strip" aria-label="${esc(t("session.matches"))}">${s.matches
            .map(
              (m) =>
                `<li class="chip ${m.result}" title="${esc(`${m.n} · ${m.opp}`)}">${esc(m.result === "win" ? t("common.win") : t("common.loss"))}</li>`,
            )
            .join("")}</ol>
          <dl class="kv"><div><dt>${esc(t("common.bestStreak"))}</dt><dd>${f.int(d.bestStreak)} ${esc(t("common.win"))}</dd></div>
          <div><dt>${esc(t("common.duration"))}</dt><dd>${esc(f.duration(d.minutes))}</dd></div></dl></div>
      </div>
      ${eventLog(s, d, f, t)}`
    }
    ${empty ? actionsHtml : ""}
  </section>`;
}

function overlaysPage(s, d, f, t) {
  return `<section class="panel monitor" aria-labelledby="ovp-h"><header class="panel-h"><h1 id="ovp-h">${esc(t("nav.overlays"))}</h1>
    <button type="button" class="link" data-act="view:dashboard" data-k="back-dash">← ${esc(t("nav.panel"))}</button></header>
    ${outputs(s, d, f, t, true)}</section>`;
}

function app(s) {
  const t = translator(s.lang, EXTRA);
  const f = fmt(s.lang);
  const d = derive(s);
  const main =
    s.view === "overlays"
      ? overlaysPage(s, d, f, t)
      : s.phase === "prepare"
        ? prepare(s, d, f, t)
        : s.phase === "live"
          ? live(s, d, f, t)
          : recap(s, d, f, t);
  const mobileBar =
    s.view !== "dashboard"
      ? ""
      : s.phase === "prepare"
        ? `<div class="mbar"><button type="button" class="btn-go btn-go-sm" data-act="start" data-k="m-start" ${s.companion !== "on" || s.starting ? "disabled" : ""}><span class="go-lamp" aria-hidden="true"></span>${esc(s.starting ? t("session.starting") : t("session.start"))}</button></div>`
        : s.phase === "live" && s.confirmEnd
          ? `<div class="mbar mbar-confirm"><span class="end-q">${esc(t("session.endHint"))}</span>
             <button type="button" class="btn btn-sm btn-ghost" data-act="cancelEnd" data-k="m-cancel-end">${esc(t("session.cancel"))}</button>
             <button type="button" class="btn btn-sm btn-danger" data-act="end" data-k="m-confirm-end">${esc(t("session.confirmEnd"))}</button></div>`
          : s.phase === "live"
            ? `<div class="mbar mbar-live"><span class="mono"><b class="win">${f.int(d.wins)}</b>–<b class="loss">${f.int(d.losses)}</b> · ${f.pct(d.winRate)}</span>
             <button type="button" class="btn btn-sm btn-danger-ghost" data-act="askEnd" data-k="m-end">■ ${esc(t("session.end"))}</button></div>`
            : "";
  return `
  <header class="top">
    <a class="brand" href="#" aria-label="SST — Session Stats Tracker"><img src="/brand/sst-monogram.svg" alt="" width="66" height="19"/></a>
    <nav aria-label="Principal"><ul>
      <li><button type="button" data-act="view:dashboard" data-k="nav-dash" ${s.view === "dashboard" ? 'aria-current="page"' : ""}>${esc(t("nav.panel"))}</button></li>
      <li><button type="button" data-act="view:overlays" data-k="nav-ov" ${s.view === "overlays" ? 'aria-current="page"' : ""}>${esc(t("nav.overlays"))}</button></li>
      <li><button type="button" data-act="toast:analytics" data-k="nav-an">${esc(t("nav.analytics"))}</button></li>
    </ul></nav>
    <span class="demo-tag mono">${esc(t("common.demo"))}</span>
  </header>
  ${tally(s, d, f, t)}
  <div class="grid">
    <main class="col-main">${main}</main>
    <aside class="col-rack" aria-label="${esc(t("a.signals"))}">${signals(s, t)}${s.view === "overlays" ? "" : outputs(s, d, f, t)}</aside>
  </div>
  ${mobileBar}
  ${s.toast ? `<div class="toast" role="status">${esc(s.toast)}</div>` : ""}
  ${labHtml(s, t, s.lang)}`;
}

boot({ root: document.getElementById("app"), extra: EXTRA, view: app });
