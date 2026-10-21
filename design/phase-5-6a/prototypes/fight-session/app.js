/**
 * Direction B — FIGHT SESSION. SST as the stage of the player's session: a versus scoreboard,
 * round-style result strip, big typographic moments for start and end. Local fictional state.
 */
import { DEMO, clock, derive, matchTime } from "../shared/engine.js";
import { boot } from "../shared/shell.js";
import { conceptTag, esc, fmt, labHtml, translator } from "../shared/ui.js";

const EXTRA = {
  es: {
    b: {
      readyEyebrow: "Preparación",
      readyTitle: "Listo para la sesión",
      blockedTitle: "Conecta el Companion",
      liveTag: "Sesión en juego",
      endedTitle: "Sesión terminada",
      overlaysTitle: "Tus overlays",
      newBadge: "Nueva",
      waitingTitle: "Esperando tu primera partida",
      trackedLine:
        "Se registrarán tus partidas Ranked con Ryu desde 1571 MR · 2 overlays se actualizarán solos",
      previousTitle: "Tu última sesión",
      kindSession: "Sesión",
      kindRank: "Progreso de rango",
      vs: "VS",
      manage: "Gestionar overlays",
      dockNote:
        "Cada overlay es una fuente de navegador en OBS y se actualiza solo. No hace falta configurarlos para empezar.",
    },
  },
  en: {
    b: {
      readyEyebrow: "Prepare",
      readyTitle: "Ready for the session",
      blockedTitle: "Connect the Companion",
      liveTag: "Session in play",
      endedTitle: "Session over",
      overlaysTitle: "Your overlays",
      newBadge: "New",
      waitingTitle: "Waiting for your first match",
      trackedLine:
        "Your Ranked matches with Ryu will be tracked from 1571 MR · 2 overlays will update by themselves",
      previousTitle: "Your last session",
      kindSession: "Session",
      kindRank: "Rank progress",
      vs: "VS",
      manage: "Manage overlays",
      dockNote:
        "Each overlay is an OBS browser source and updates by itself. You don't need them to start.",
    },
  },
};

const chipLabel = (r, t) => (r === "win" ? t("common.win") : t("common.loss"));

function readiness(s, t) {
  const set = s.companion === "on" ? "ok" : s.companion === "quiet" ? "quiet" : "off";
  const tone = (k) =>
    k === "character" || (k === "profile" && set !== "off")
      ? "ok"
      : set === "ok"
        ? "ok"
        : set === "quiet"
          ? "warn"
          : "off";
  return `<ul class="ready-chips" aria-label="${esc(t("readiness.companion"))}">
    ${["companion", "buckler", "profile", "character"]
      .map((k) => {
        const tn = tone(k);
        return `<li class="rc rc-${tn}"><span aria-hidden="true">${tn === "ok" ? "●" : tn === "warn" ? "⚠" : "○"}</span>
          <b>${esc(t(`readiness.${k}`))}</b><span>${esc(t(`readiness.${tn === "ok" ? "ok" : set}.${k}`))}</span></li>`;
      })
      .join("")}</ul>`;
}

function strip(s, t, big = false) {
  const fresh = (m) => s.event?.kind === "match" && s.event.matchId === m.id;
  return `<ol class="rounds${big ? " rounds-big" : ""}" aria-label="${esc(t("session.matches"))}">
    ${s.matches
      .map(
        (
          m,
        ) => `<li class="round ${m.result}${fresh(m) ? " is-new" : ""}" title="${esc(`${m.n} · ${t("common.vs")} ${m.opp}`)}">
        <span class="round-n">${m.n}</span><span class="round-r">${esc(chipLabel(m.result, t))}</span></li>`,
      )
      .join("")}</ol>`;
}

function miniOverlay(o, d, f) {
  if (o.kind === "rank")
    return `<div class="mini mini-rank" aria-hidden="true"><b>MASTER</b><span>${f.int(d.current ?? DEMO.baseline)} MR</span><i></i></div>`;
  return `<div class="mini" aria-hidden="true"><span class="w">${f.int(d.wins)}</span><span class="sl">/</span><span class="l">${f.int(d.losses)}</span>
    <span class="p">${f.pct(d.winRate)}</span><span class="r">${f.int(d.current)}<small>MR</small></span></div>`;
}

function overlayDock(s, d, f, t, full = false) {
  return `<section class="dock${full ? " dock-full" : ""}" aria-labelledby="dock-h">
    <h2 class="sec-h" id="dock-h">${esc(t("b.overlaysTitle"))}</h2>
    <ul class="dock-list">
      ${DEMO.overlays
        .map(
          (o) => `<li class="ov">
        <div class="ov-prev">${miniOverlay(o, d, f)}</div>
        <div class="ov-body"><p class="ov-name">${esc(o.name)}</p>
          <p class="ov-meta">${esc(o.kind === "rank" ? t("b.kindRank") : t("b.kindSession"))} · ${esc(o.size)}</p>
          <p class="ov-obs ${o.obs ? "on" : ""}">${o.obs ? "●" : "○"} ${esc(o.obs ? t("common.inObs") : t("common.notInObs"))}</p></div>
        <div class="ov-actions"><button type="button" class="b-btn b-btn-sm" data-act="copy" data-k="copy-${o.id}">${esc(t("common.copyUrl"))}</button>
          <button type="button" class="b-btn b-btn-sm b-ghost" data-act="toast" data-k="cfg-${o.id}">${esc(t("common.configure"))}</button></div></li>`,
        )
        .join("")}
      <li class="ov ov-new"><button type="button" class="b-btn b-ghost" data-act="${full ? "toast" : "view:overlays"}" data-k="ov-new">${esc(full ? `+ ${t("common.newOverlay")}` : `${t("b.manage")} →`)}</button></li>
    </ul>
    <p class="note">${esc(t("b.dockNote"))}</p>
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
        delta: s.lastRecap.delta,
        winRate: s.lastRecap.winRate,
        day: t("session.today"),
      }
    : {
        ...DEMO.previous,
        delta: DEMO.previous.to - DEMO.previous.from,
        winRate: DEMO.previous.wins / DEMO.previous.games,
        day: t("session.yesterday"),
      };
  return `
  <section class="stage stage-prepare${s.event?.kind === "prepare" ? " is-arrive" : ""}" aria-labelledby="stage-h">
    <span class="ghost" aria-hidden="true">${esc(DEMO.character.name)}</span>
    <div class="stage-main">
      <p class="eyebrow">${esc(t("b.readyEyebrow"))} · ${esc(DEMO.player.game)}</p>
      <h1 class="display" id="stage-h">${esc(blocked ? t("b.blockedTitle") : t("b.readyTitle"))}</h1>
      <p class="charline"><b>${esc(DEMO.character.name)}</b><span>${esc(DEMO.character.league)}</span><span class="tabular">${f.int(DEMO.baseline)} <small>MR</small></span></p>
      ${readiness(s, t)}
      ${
        blocked
          ? `<div class="fix" role="alert"><p><b>${esc(t("readiness.fixTitle"))}.</b> ${esc(t("readiness.fixBody"))}</p>
             <p class="fix-a"><a href="#" class="b-link" data-act="toast" data-k="help">${esc(t("readiness.fixAction"))} →</a>
             <button type="button" class="b-btn b-btn-sm b-ghost" data-act="companion:on" data-k="retry">${esc(t("readiness.retry"))}</button></p></div>`
          : ""
      }
      <div class="cta-wrap">
        <button type="button" class="cta${s.starting ? " is-starting" : ""}" data-act="start" data-k="start" ${blocked || s.starting ? "disabled" : ""} aria-describedby="cta-line">
          <span>${esc(s.starting ? t("session.starting") : t("session.start"))}</span><span class="cta-arrow" aria-hidden="true">→</span>
        </button>
        <p class="cta-line" id="cta-line">${esc(t("b.trackedLine"))}. ${esc(t("session.startHelp"))}</p>
      </div>
    </div>
    <aside class="prev-card" aria-labelledby="prev-h">
      <h2 class="sec-h" id="prev-h">${esc(t("b.previousTitle"))}</h2>
      ${
        s.hasPrevious
          ? `<p class="prev-day">${esc(prev.day)}</p>
             <p class="prev-score tabular"><b class="win">${f.int(prev.wins)}</b><span>–</span><b class="loss">${f.int(prev.losses)}</b></p>
             <dl class="prev-kv"><div><dt>${esc(t("common.winRate"))}</dt><dd class="tabular">${f.pct(prev.winRate)}</dd></div>
             <div><dt>MR · Ryu</dt><dd class="tabular ${f.deltaTone(prev.delta)}">${esc(f.delta(prev.delta))}</dd></div>
             <div><dt>${esc(t("common.games"))}</dt><dd class="tabular">${f.int(prev.games)}</dd></div></dl>`
          : `<p class="muted">${esc(t("session.previousNone"))}</p>`
      }
    </aside>
  </section>
  ${overlayDock(s, d, f, t)}`;
}

function scoreboard(s, d, f, t) {
  const ev = s.event;
  const winBump = ev?.kind === "match" && d.last?.result === "win";
  const lossBump = ev?.kind === "match" && d.last?.result === "loss";
  return `<div class="versus" role="group" aria-label="${esc(`${d.wins} ${t("common.wins")}, ${d.losses} ${t("common.losses")}, ${f.pct(d.winRate)}`)}">
    <div class="vs-side vs-win${winBump ? " is-hit" : ""}"><span class="vs-l">${esc(t("common.wins"))}</span>
      <span class="vs-n tabular" ${winBump ? `data-count-from="${d.wins - 1}" data-count-to="${d.wins}"` : ""}>${f.int(d.wins)}</span></div>
    <div class="vs-mid"><span class="vs-l">${esc(t("common.winRate"))}</span><span class="vs-p tabular">${f.pct(d.winRate)}</span>
      <span class="meter" aria-hidden="true"><i style="width:${d.winRate === null ? 0 : Math.round(d.winRate * 100)}%"></i></span>
      <span class="vs-g">${f.int(d.games)} ${esc(t("common.games").toLowerCase())}</span></div>
    <div class="vs-side vs-loss${lossBump ? " is-hit" : ""}"><span class="vs-l">${esc(t("common.losses"))}</span>
      <span class="vs-n tabular" ${lossBump ? `data-count-from="${d.losses - 1}" data-count-to="${d.losses}"` : ""}>${f.int(d.losses)}</span></div>
  </div>`;
}

function mrLine(s, d, f, t) {
  const prevConfirmed =
    [...d.journey]
      .slice(0, -1)
      .reverse()
      .find((x) => x !== null) ?? DEMO.baseline;
  const bump = s.event?.kind === "rating" && d.current !== null;
  return `<div class="mrline${d.pending ? " is-pending" : ""}">
    <span class="mr-char">${esc(DEMO.character.name)}</span>
    <span class="mr-from tabular">${f.int(DEMO.baseline)}</span><span class="mr-arrow" aria-hidden="true"></span>
    <span class="mr-now tabular" ${bump ? `data-count-from="${prevConfirmed}" data-count-to="${d.current}"` : ""}>${d.current === null ? "—" : f.int(d.current)}</span><small>MR</small>
    <span class="mr-delta ${f.deltaTone(d.delta)}">${esc(f.delta(d.delta))}</span>
    ${d.pending ? `<span class="mr-pending" title="${esc(t("common.pendingLong"))}">⏳ ${esc(t("common.pending"))}</span>` : ""}
  </div>`;
}

function live(s, d, f, t) {
  const last = d.last;
  const quiet = s.companion !== "on";
  return `
  <section class="stage stage-live${s.event?.kind === "started" ? " is-start" : ""}" aria-labelledby="stage-h">
    <span class="ghost" aria-hidden="true">${esc(DEMO.character.name)}</span>
    <header class="live-h">
      <p class="live-tag" id="stage-h"><span class="dot" aria-hidden="true"></span>${esc(t("b.liveTag"))} · <span class="tabular">${esc(f.duration(d.minutes))}</span></p>
      <div class="end">${
        s.confirmEnd
          ? `<span class="end-q">${esc(t("session.endHint"))}</span>
             <button type="button" class="b-btn b-btn-sm b-ghost" data-act="cancelEnd" data-k="cancel-end">${esc(t("session.cancel"))}</button>
             <button type="button" class="b-btn b-btn-sm b-danger" data-act="end" data-k="confirm-end">${esc(t("session.confirmEnd"))}</button>`
          : `<button type="button" class="b-btn b-btn-sm b-ghost b-end" data-act="askEnd" data-k="ask-end">${esc(t("session.end"))}</button>`
      }</div>
    </header>
    ${s.event?.kind === "started" ? `<p class="banner" role="status">${esc(t("session.started"))}</p>` : ""}
    ${quiet ? `<div class="fix fix-quiet" role="status"><p><b>${esc(t("readiness.quietTitle"))}.</b> ${esc(t("readiness.quietBody"))}</p></div>` : ""}
    ${scoreboard(s, d, f, t)}
    ${mrLine(s, d, f, t)}
    ${
      d.games === 0
        ? `<div class="waiting"><p class="display-s">${esc(t("b.waitingTitle"))}</p><p class="muted">${esc(t("session.waitingHint"))}</p></div>`
        : `<div class="live-foot">
        <div class="last${s.event?.kind === "match" ? " is-new" : ""}" aria-live="polite">
          <span class="stamp ${last.result}" aria-hidden="true">${esc(chipLabel(last.result, t))}</span>
          <div><p class="sec-h">${esc(t("session.lastMatch"))}${s.event?.kind === "match" ? ` <span class="new">${esc(t("b.newBadge"))}</span>` : ""}</p>
          <p class="last-main">${esc(last.result === "win" ? t("common.winWord") : t("common.lossWord"))} ${esc(t("common.vs"))} ${esc(last.opp)}</p>
          <p class="muted tabular">${esc(matchTime(last.n - 1))} · ${last.mrAfter === null ? `<span class="warn">${esc(t("common.pending"))}</span>` : `MR ${f.int(last.mrAfter)}`}</p></div>
        </div>
        <div class="live-strip"><p class="sec-h">${esc(t("session.matches"))}</p>${strip(s, t)}</div>
      </div>`
    }
  </section>
  ${overlayDock(s, d, f, t)}`;
}

function journey(d, f, t) {
  const pts = d.journey;
  const known = pts.filter((x) => x !== null);
  if (known.length < 2) return `<p class="muted">${esc(t("session.journeyGap"))}</p>`;
  const W = 720;
  const H = 180;
  const min = Math.min(...known) - 8;
  const max = Math.max(...known) + 8;
  const x = (i) => 30 + (i * (W - 50)) / (pts.length - 1);
  const y = (v) => H - 16 - ((v - min) * (H - 32)) / (max - min);
  let path = "";
  pts.forEach((v, i) => {
    if (v !== null)
      path += `${path && pts[i - 1] !== null ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
  });
  return `<svg class="journey" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${t("session.journey")}: ${known.map((v) => f.int(v)).join(", ")}`)}">
    <line x1="30" x2="${W - 20}" y1="${y(DEMO.baseline)}" y2="${y(DEMO.baseline)}" class="j-base"/>
    <text x="0" y="${y(DEMO.baseline) + 4}" class="j-t">${f.int(DEMO.baseline)}</text>
    <path d="${path}" class="j-line"/>
    ${pts.map((v, i) => (v === null || i === 0 ? "" : `<rect x="${x(i) - 4}" y="${y(v) - 4}" width="8" height="8" class="j-dot ${d.resultAt?.[i - 1] ?? ""}" transform="rotate(45 ${x(i)} ${y(v)})"/>`)).join("")}
  </svg>`;
}

function recap(s, d, f, t) {
  const empty = d.games === 0;
  d.resultAt = s.matches.map((m) => m.result);
  const range = `${clock(DEMO.startMinute)}–${clock(DEMO.startMinute + d.minutes)}`;
  return `
  <section class="stage stage-recap${s.event?.kind === "ended" ? " is-end" : ""}" aria-labelledby="stage-h">
    <span class="ghost" aria-hidden="true">${esc(DEMO.character.name)}</span>
    <header class="recap-h">
      <div><p class="eyebrow">${esc(t("session.recapEnded"))} · ${esc(range)} · ${esc(f.duration(d.minutes))}</p>
      <h1 class="display" id="stage-h">${esc(empty ? t("session.emptyRecap") : t("b.endedTitle"))}</h1></div>
      <div class="recap-actions">
        <button type="button" class="cta cta-sm" data-act="prepareAnother" data-k="again"><span>${esc(t("session.prepareAnother"))}</span><span class="cta-arrow" aria-hidden="true">→</span></button>
        <button type="button" class="b-btn b-ghost" data-act="toDashboard" data-k="back">${esc(t("session.backToPanel"))}</button>
      </div>
    </header>
    ${
      empty
        ? `<p class="muted big-note">${esc(t("session.emptyRecapBody"))}</p>`
        : `<dl class="results">
      <div><dt>${esc(t("common.games"))}</dt><dd class="tabular">${f.int(d.games)}</dd></div>
      <div class="r-win"><dt>${esc(t("common.wins"))}</dt><dd class="tabular">${f.int(d.wins)}</dd></div>
      <div class="r-loss"><dt>${esc(t("common.losses"))}</dt><dd class="tabular">${f.int(d.losses)}</dd></div>
      <div><dt>${esc(t("common.winRate"))}</dt><dd class="tabular">${f.pct(d.winRate)}</dd></div>
      <div class="r-mr"><dt>${esc(t("session.sessionDelta"))} · Ryu</dt>${
        d.delta === null
          ? `<dd class="na">—</dd><p class="na-t">${esc(t("session.ratingUnavailable"))}</p>`
          : `<dd class="tabular ${f.deltaTone(d.delta)}">${esc(f.delta(d.delta))}</dd><p class="muted tabular">${f.int(DEMO.baseline)} → ${f.int(d.current)} MR</p>`
      }</div>
    </dl>
    ${d.delta === null ? `<p class="fix fix-quiet">${esc(t("session.ratingUnavailableBody"))}</p>` : ""}
    <div class="recap-grid">
      <div><p class="sec-h">${esc(t("session.journey"))}${conceptTag(t)}</p>${journey(d, f, t)}</div>
      <div><p class="sec-h">${esc(t("session.matches"))}</p>${strip(s, t, true)}
        <dl class="prev-kv"><div><dt>${esc(t("common.bestStreak"))}</dt><dd class="tabular">${f.int(d.bestStreak)} ${esc(t("common.win"))}</dd></div>
        <div><dt>${esc(t("common.duration"))}</dt><dd>${esc(f.duration(d.minutes))}</dd></div></dl></div>
    </div>
    <details class="matchlist"><summary data-k="ml">${esc(t("session.matches"))} · ${f.int(d.games)}${conceptTag(t)}</summary>
      <ol>${s.matches
        .map(
          (
            m,
            i,
          ) => `<li><span class="round ${m.result}"><span class="round-r">${esc(chipLabel(m.result, t))}</span></span>
          <span>${m.n}. ${esc(t("common.vs"))} ${esc(m.opp)}</span><span class="muted tabular">${esc(matchTime(i))}</span>
          <span class="tabular">${s.ratingKnown && m.mrAfter !== null ? `${f.int(m.mrAfter)} MR` : "—"}</span></li>`,
        )
        .join("")}</ol></details>`
    }
  </section>`;
}

function overlaysPage(s, d, f, t) {
  return `<section class="stage stage-ov"><header class="recap-h"><h1 class="display">${esc(t("nav.overlays"))}</h1>
    <button type="button" class="b-btn b-ghost" data-act="view:dashboard" data-k="back-dash">← ${esc(t("nav.panel"))}</button></header></section>
    ${overlayDock(s, d, f, t, true)}`;
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
  let bar = "";
  if (s.view === "dashboard" && s.phase === "prepare")
    bar = `<div class="mbar"><button type="button" class="cta" data-act="start" data-k="m-start" ${s.companion !== "on" || s.starting ? "disabled" : ""}><span>${esc(s.starting ? t("session.starting") : t("session.start"))}</span><span class="cta-arrow" aria-hidden="true">→</span></button></div>`;
  else if (s.view === "dashboard" && s.phase === "live")
    bar = s.confirmEnd
      ? `<div class="mbar mbar-confirm"><span class="end-q">${esc(t("session.endHint"))}</span>
         <button type="button" class="b-btn b-btn-sm b-ghost" data-act="cancelEnd" data-k="m-cancel-end">${esc(t("session.cancel"))}</button>
         <button type="button" class="b-btn b-btn-sm b-danger" data-act="end" data-k="m-confirm-end">${esc(t("session.confirmEnd"))}</button></div>`
      : `<div class="mbar mbar-live"><span class="tabular"><b class="win">${f.int(d.wins)}</b> – <b class="loss">${f.int(d.losses)}</b> · ${f.pct(d.winRate)}</span>
         <button type="button" class="b-btn b-btn-sm b-ghost b-end" data-act="askEnd" data-k="m-end">${esc(t("session.end"))}</button></div>`;
  return `
  <header class="top">
    <a class="brand" href="#" aria-label="SST — Session Stats Tracker"><img src="/brand/sst-monogram.svg" alt="" width="76" height="22"/></a>
    <nav aria-label="Principal"><ul>
      <li><button type="button" data-act="view:dashboard" data-k="nav-dash" ${s.view === "dashboard" ? 'aria-current="page"' : ""}>${esc(t("nav.panel"))}</button></li>
      <li><button type="button" data-act="view:overlays" data-k="nav-ov" ${s.view === "overlays" ? 'aria-current="page"' : ""}>${esc(t("nav.overlays"))}</button></li>
      <li><button type="button" data-act="toast" data-k="nav-an">${esc(t("nav.analytics"))}</button></li>
    </ul></nav>
    <span class="demo-tag">${esc(t("common.demo"))}</span>
  </header>
  <main class="wrap">${main}</main>
  ${bar}
  ${s.toast ? `<div class="toast" role="status">${esc(s.toast)}</div>` : ""}
  ${labHtml(s, t, s.lang)}`;
}

boot({ root: document.getElementById("app"), extra: EXTRA, view: app });
