/**
 * Shared prototype runtime: i18n (ES/EN), number formatting (Intl, like src/domain/format.ts),
 * a re-render helper that keeps keyboard focus, and the "prototype controls" drawer.
 */
import { SCENARIOS, reducedMotion } from "./engine.js";

/* ───────── i18n ───────── */

const ES = {
  nav: { panel: "Panel", overlays: "Overlays", analytics: "Analíticas" },
  common: {
    wins: "Victorias",
    losses: "Derrotas",
    winRate: "% de victorias",
    games: "Partidas",
    noGames: "Sin partidas",
    streak: "Racha",
    bestStreak: "Mejor racha",
    duration: "Duración",
    win: "V",
    loss: "D",
    winWord: "Victoria",
    lossWord: "Derrota",
    vs: "vs",
    copyUrl: "Copiar URL para OBS",
    copied: "URL copiada",
    configure: "Configurar",
    preview: "Vista previa",
    inObs: "En OBS",
    notInObs: "Sin conectar",
    newOverlay: "Nuevo overlay",
    unknown: "—",
    min: "min",
    pending: "MR pendiente",
    pendingLong: "Esperando tu perfil para confirmar el MR de la última partida",
    ratingConfirmed: "MR confirmado",
    demo: "Datos de demostración",
    outOfScope: "Fuera del alcance de este prototipo",
  },
  readiness: {
    companion: "Companion",
    buckler: "Buckler",
    profile: "Perfil",
    character: "Personaje",
    ok: {
      companion: "Conectado",
      buckler: "Sesión iniciada",
      profile: "Sincronizado",
      character: "Ryu detectado",
    },
    off: {
      companion: "Sin conexión",
      buckler: "Sin datos recientes",
      profile: "Desactualizado",
      character: "Ryu detectado",
    },
    quiet: {
      companion: "Sin señal hace 6 min",
      buckler: "Sin datos hace 6 min",
      profile: "Sincronizado",
      character: "Ryu detectado",
    },
    fixTitle: "No recibimos datos del Companion",
    fixBody:
      "Abre el navegador donde instalaste el Companion e inicia sesión en Buckler. El panel se actualizará solo.",
    fixAction: "Ver cómo conectarlo",
    retry: "Simular reconexión",
    quietTitle: "El Companion lleva 6 min sin enviar datos",
    quietBody:
      "Tu sesión sigue activa. Las partidas que juegues ahora aparecerán cuando vuelva a conectar.",
  },
  session: {
    start: "Iniciar sesión de juego",
    starting: "Iniciando…",
    end: "Finalizar sesión",
    confirmEnd: "Sí, finalizar",
    cancel: "Seguir jugando",
    endHint: "Se guardará con las partidas registradas hasta ahora.",
    tracked: "Se registrará",
    trackedRanked: "Partidas Ranked",
    trackedFrom: "MR desde",
    trackedOverlays: "Overlays que se actualizan",
    startHelp: "Puedes empezar sin configurar overlays.",
    started: "Sesión iniciada · juega cuando quieras",
    waiting: "Esperando tu primera partida Ranked…",
    waitingHint: "Las partidas aparecen solas unos 30 s después de terminar.",
    lastMatch: "Última partida",
    newMatch: "Partida registrada",
    sync: "Sincronización",
    syncOk: "Hace 12 s",
    previous: "Sesión anterior",
    previousNone: "Aún no has jugado ninguna sesión con SST.",
    yesterday: "Ayer",
    today: "Hoy",
    recap: "Resumen de la sesión",
    recapEnded: "Sesión finalizada y guardada",
    ratingUnavailable: "MR final no disponible",
    ratingUnavailableBody:
      "No recibimos tu perfil después de la última partida, así que no mostramos el cambio de MR. Las victorias y derrotas sí están completas.",
    emptyRecap: "Sesión sin partidas",
    emptyRecapBody: "No se registró ninguna partida Ranked entre el inicio y el final.",
    backToPanel: "Volver al panel",
    prepareAnother: "Preparar otra sesión",
    matches: "Partidas",
    journey: "Recorrido de MR",
    journeyGap: "Sin dato",
    concept: "Concepto",
    conceptLong:
      "MR por partida: hoy SST solo guarda el MR inicial y final de la sesión. Requiere guardar cada observación.",
    sessionDelta: "Cambio en la sesión",
    from: "desde",
    of: "de",
  },
  lab: {
    title: "Controles del prototipo",
    note: "Estado local y ficticio. No llama a SST.",
    phase: "Momento",
    prepare: "Preparar",
    live: "En directo",
    recap: "Resumen",
    companion: "Companion",
    on: "Conectado",
    quiet: "Sin señal",
    off: "Desconectado",
    simulate: "Simular partida",
    win: "Victoria",
    loss: "Derrota",
    scenario: "Escenario",
    lang: "Idioma",
    open: "Prototipo",
  },
};

const EN = {
  nav: { panel: "Dashboard", overlays: "Overlays", analytics: "Analytics" },
  common: {
    wins: "Wins",
    losses: "Losses",
    winRate: "Win rate",
    games: "Games",
    noGames: "No games",
    streak: "Streak",
    bestStreak: "Best streak",
    duration: "Duration",
    win: "W",
    loss: "L",
    winWord: "Win",
    lossWord: "Loss",
    vs: "vs",
    copyUrl: "Copy URL for OBS",
    copied: "URL copied",
    configure: "Configure",
    preview: "Preview",
    inObs: "In OBS",
    notInObs: "Not connected",
    newOverlay: "New overlay",
    unknown: "—",
    min: "min",
    pending: "MR pending",
    pendingLong: "Waiting for your profile to confirm the last match's MR",
    ratingConfirmed: "MR confirmed",
    demo: "Demo data",
    outOfScope: "Outside the scope of this prototype",
  },
  readiness: {
    companion: "Companion",
    buckler: "Buckler",
    profile: "Profile",
    character: "Character",
    ok: {
      companion: "Connected",
      buckler: "Logged in",
      profile: "Synced",
      character: "Ryu detected",
    },
    off: {
      companion: "Offline",
      buckler: "No recent data",
      profile: "Out of date",
      character: "Ryu detected",
    },
    quiet: {
      companion: "No signal for 6 min",
      buckler: "No data for 6 min",
      profile: "Synced",
      character: "Ryu detected",
    },
    fixTitle: "We're not receiving Companion data",
    fixBody:
      "Open the browser where you installed the Companion and log in to Buckler. The dashboard updates by itself.",
    fixAction: "How to connect it",
    retry: "Simulate reconnection",
    quietTitle: "The Companion hasn't sent data for 6 min",
    quietBody: "Your session is still active. Games you play now will appear once it reconnects.",
  },
  session: {
    start: "Start game session",
    starting: "Starting…",
    end: "End session",
    confirmEnd: "Yes, end it",
    cancel: "Keep playing",
    endHint: "It will be saved with the games recorded so far.",
    tracked: "Will be tracked",
    trackedRanked: "Ranked matches",
    trackedFrom: "MR from",
    trackedOverlays: "Overlays that update",
    startHelp: "You can start without setting up overlays.",
    started: "Session started · play whenever you're ready",
    waiting: "Waiting for your first Ranked match…",
    waitingHint: "Matches show up by themselves about 30 s after they end.",
    lastMatch: "Last match",
    newMatch: "Match recorded",
    sync: "Sync",
    syncOk: "12 s ago",
    previous: "Previous session",
    previousNone: "You haven't played a session with SST yet.",
    yesterday: "Yesterday",
    today: "Today",
    recap: "Session recap",
    recapEnded: "Session ended and saved",
    ratingUnavailable: "Final MR unavailable",
    ratingUnavailableBody:
      "We didn't receive your profile after the last match, so the MR change isn't shown. Wins and losses are complete.",
    emptyRecap: "Session with no games",
    emptyRecapBody: "No Ranked match was recorded between start and end.",
    backToPanel: "Back to dashboard",
    prepareAnother: "Prepare another session",
    matches: "Matches",
    journey: "MR journey",
    journeyGap: "No data",
    concept: "Concept",
    conceptLong:
      "Per-match MR: today SST only stores the session's initial and final MR. Needs each observation stored.",
    sessionDelta: "Session change",
    from: "from",
    of: "of",
  },
  lab: {
    title: "Prototype controls",
    note: "Local, fictional state. Never calls SST.",
    phase: "Moment",
    prepare: "Prepare",
    live: "Live",
    recap: "Recap",
    companion: "Companion",
    on: "Connected",
    quiet: "No signal",
    off: "Disconnected",
    simulate: "Simulate match",
    win: "Win",
    loss: "Loss",
    scenario: "Scenario",
    lang: "Language",
    open: "Prototype",
  },
};

export const CATALOGS = { es: ES, en: EN };
export function translator(lang, extra = {}) {
  const cat = deepMerge(CATALOGS[lang] ?? ES, extra[lang] ?? {});
  return (path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), cat) ?? path;
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a[k] ?? {}, v) : v;
  return out;
}

/* ───────── formatting ───────── */

export const fmt = (lang) => {
  const loc = lang === "en" ? "en-US" : "es-ES";
  const int = new Intl.NumberFormat(loc, { maximumFractionDigits: 0, useGrouping: false });
  const pct = new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 1 });
  return {
    int: (n) => (n === null || n === undefined ? "—" : int.format(n)),
    pct: (r) => (r === null ? "—" : pct.format(r)),
    /** Signed delta with a glyph (never color alone): ▲ +32 · ▼ −8 · ±0. */
    delta: (d) =>
      d === null ? "—" : d > 0 ? `▲ +${int.format(d)}` : d < 0 ? `▼ −${int.format(-d)}` : "±0",
    deltaTone: (d) => (d === null ? "muted" : d > 0 ? "up" : d < 0 ? "down" : "flat"),
    duration: (m) =>
      m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`,
  };
};

export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/* ───────── rendering ───────── */

/** Re-render root from a template, keeping focus on the element with the same data-k. */
export function mount(root, html) {
  const active = document.activeElement;
  const key = active && root.contains(active) ? active.getAttribute("data-k") : null;
  root.innerHTML = html;
  if (key) root.querySelector(`[data-k="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
}

/** Animate [data-count-from][data-count-to] numbers (rAF, easeOutCubic). Skipped with reduced motion. */
export function animateCounts(root, format) {
  if (reducedMotion()) return;
  root.querySelectorAll("[data-count-to]").forEach((el) => {
    const from = Number(el.dataset.countFrom);
    const to = Number(el.dataset.countTo);
    if (!Number.isFinite(from) || from === to) return;
    const t0 = performance.now();
    const dur = 550;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(Math.round(from + (to - from) * e));
      if (k < 1) requestAnimationFrame(tick);
    };
    el.textContent = format(from);
    requestAnimationFrame(tick);
  });
}

/* ───────── prototype controls drawer (identical in both directions) ───────── */

export function labHtml(state, t, lang) {
  if (state.labOpen === "hide") return "";
  const b = (k, label, on, extra = "") =>
    `<button type="button" class="lab-btn${on ? " on" : ""}" data-k="lab-${k}" data-lab="${k}" aria-pressed="${on}" ${extra}>${esc(label)}</button>`;
  const live = state.phase === "live";
  return `
  <details class="lab" ${state.labOpen ? "open" : ""} data-lab-root>
    <summary data-k="lab-summary"><span class="lab-dot" aria-hidden="true"></span>${esc(t("lab.title"))}</summary>
    <div class="lab-body">
      <p class="lab-note">${esc(t("lab.note"))}</p>
      <div class="lab-row"><span>${esc(t("lab.phase"))}</span>
        ${b("phase:prepare", t("lab.prepare"), state.phase === "prepare")}
        ${b("phase:live", t("lab.live"), state.phase === "live")}
        ${b("phase:recap", t("lab.recap"), state.phase === "recap")}</div>
      <div class="lab-row"><span>${esc(t("lab.companion"))}</span>
        ${b("companion:on", t("lab.on"), state.companion === "on")}
        ${b("companion:quiet", t("lab.quiet"), state.companion === "quiet")}
        ${b("companion:off", t("lab.off"), state.companion === "off")}</div>
      <div class="lab-row"><span>${esc(t("lab.simulate"))}</span>
        ${b("ingest:win", `+ ${t("lab.win")}`, false, live ? "" : "disabled")}
        ${b("ingest:loss", `+ ${t("lab.loss")}`, false, live ? "" : "disabled")}</div>
      <div class="lab-row"><span>${esc(t("lab.lang"))}</span>
        ${b("lang:es", "ES", lang === "es")}${b("lang:en", "EN", lang === "en")}</div>
      <label class="lab-row"><span>${esc(t("lab.scenario"))}</span>
        <select data-k="lab-scenario" data-lab-scenario>
          ${Object.keys(SCENARIOS)
            .map(
              (k) => `<option value="${k}" ${k === state.scenario ? "selected" : ""}>${k}</option>`,
            )
            .join("")}
        </select></label>
    </div>
  </details>`;
}

/** Hash ⇄ state: #scenario=live&lang=en&view=overlays&lab=1 (screenshots, deep links). */
export function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    scenario: p.get("scenario") ?? "prepare",
    lang: p.get("lang") === "en" ? "en" : "es",
    view: p.get("view") === "overlays" ? "overlays" : "dashboard",
    lab: p.get("lab") === "hide" ? "hide" : p.get("lab") !== "0",
  };
}

/** Marks UI that needs data SST does not store yet (never presented as a current feature). */
export const conceptTag = (t) =>
  `<span class="concept" title="${esc(t("session.conceptLong"))}">${esc(t("session.concept"))}<span class="sr-only">: ${esc(t("session.conceptLong"))}</span></span>`;
