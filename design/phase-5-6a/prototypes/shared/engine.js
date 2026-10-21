/**
 * Phase 5.6A prototypes — fictional data + a tiny local store. NOTHING here talks to SST: no
 * fetch, no API, no storage beyond memory. The derivations mirror the production engine's
 * rules (src/domain/session/engine.ts) so the prototypes never show numbers SST would not:
 *   - win rate = wins / (wins + losses), unknown (null) with no decided games;
 *   - rating delta = current − session baseline, per character, null when either is unknown;
 *   - a match whose post-match rating has not been observed yet is "pending": the last confirmed
 *     rating is held (Phase 5.5) and labelled as such, never invented.
 */

export const DEMO = {
  player: { name: "Yasmine", cfn: "9990000200", game: "Street Fighter 6" },
  character: { key: "ryu", name: "Ryu", league: "MASTER", system: "MR" },
  baseline: 1571,
  /** The session script: [result, opponent character, MR after]. Fictional. */
  script: [
    ["win", "Ken", 1583],
    ["win", "Juri", 1594],
    ["loss", "Luke", 1581],
    ["win", "Cammy", 1591],
    ["loss", "JP", 1579],
    ["win", "Marisa", 1593],
    ["win", "Guile", 1602],
    ["loss", "Kimberly", 1591],
    ["win", "Ed", 1603],
    ["win", "Lily", 1613],
  ],
  /** Previous (ended) session, shown as context while preparing. Same numbers as the audit. */
  previous: { games: 6, wins: 4, losses: 2, from: 1532, to: 1571, minutes: 38, day: "yesterday" },
  overlays: [
    {
      id: "ov1",
      name: "Marcador",
      kind: "session",
      theme: "Competitivo",
      size: "800 × 180",
      obs: true,
    },
    {
      id: "ov2",
      name: "Progreso de rango",
      kind: "rank",
      theme: "Broadcast",
      size: "640 × 140",
      obs: false,
    },
  ],
  /** Simulated clock: the session starts at 19:30 and each match takes 6 minutes. */
  startMinute: 19 * 60 + 30,
  matchMinutes: 6,
};

/* ───────── derivations (pure) ───────── */

export function derive(s) {
  const wins = s.matches.filter((m) => m.result === "win").length;
  const losses = s.matches.filter((m) => m.result === "loss").length;
  const decided = wins + losses;
  const confirmed = [...s.matches].reverse().find((m) => m.mrAfter !== null);
  const last = s.matches[s.matches.length - 1] ?? null;
  const pending = last !== null && last.mrAfter === null && s.ratingKnown;
  const current = !s.ratingKnown ? null : confirmed ? confirmed.mrAfter : DEMO.baseline;
  let streak = { kind: null, count: 0 };
  for (let i = s.matches.length - 1; i >= 0; i--) {
    const r = s.matches[i].result;
    if (streak.kind === null) streak = { kind: r, count: 1 };
    else if (r === streak.kind) streak.count++;
    else break;
  }
  let best = 0;
  let run = 0;
  for (const m of s.matches) {
    run = m.result === "win" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const minutes = s.phase === "prepare" ? 0 : Math.max(1, s.matches.length * DEMO.matchMinutes + 4);
  return {
    wins,
    losses,
    games: s.matches.length,
    winRate: decided === 0 ? null : wins / decided,
    current,
    pending,
    delta: current === null ? null : current - DEMO.baseline,
    last,
    streak,
    bestStreak: best,
    minutes,
    /** MR after each match, null where unknown: never interpolated. */
    journey: [DEMO.baseline, ...s.matches.map((m) => (s.ratingKnown ? m.mrAfter : null))],
  };
}

export const clock = (minute) =>
  `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export const matchTime = (i) => clock(DEMO.startMinute + (i + 1) * DEMO.matchMinutes);

/* ───────── store ───────── */

function matchFromScript(i, pending) {
  const [result, opp, mr] = DEMO.script[i % DEMO.script.length];
  return { id: `m${i + 1}`, n: i + 1, result, opp, mrAfter: pending ? null : mr, scriptMr: mr };
}

/** Named, reproducible starting points (also used by the screenshot QA via the URL hash). */
export const SCENARIOS = {
  "prepare-first": { phase: "prepare", hasPrevious: false },
  prepare: { phase: "prepare" },
  "prepare-offline": { phase: "prepare", companion: "off" },
  "live-empty": { phase: "live", games: 0 },
  live: { phase: "live", games: 7 },
  "live-pending": { phase: "live", games: 7, pendingLast: true },
  "live-offline": { phase: "live", games: 7, companion: "quiet" },
  recap: { phase: "recap", games: 10 },
  "recap-norating": { phase: "recap", games: 10, ratingKnown: false },
  "recap-empty": { phase: "recap", games: 0 },
};

export function scenario(name) {
  const sc = SCENARIOS[name] ?? SCENARIOS.prepare;
  const games = sc.games ?? 0;
  return {
    scenario: name in SCENARIOS ? name : "prepare",
    phase: sc.phase,
    view: "dashboard",
    companion: sc.companion ?? "on", // on | quiet | off
    hasPrevious: sc.hasPrevious ?? true,
    ratingKnown: sc.ratingKnown ?? true,
    matches: Array.from({ length: games }, (_, i) =>
      matchFromScript(i, sc.pendingLast && i === games - 1),
    ),
    confirmEnd: false,
    starting: false,
    event: null, // { id, kind } — drives one-shot feedback
    toast: null,
  };
}

export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  let seq = 0;
  const api = {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      subs.forEach((f) => f(state));
    },
    subscribe: (f) => (subs.add(f), () => subs.delete(f)),
    /** One-shot UI event (new match, rating confirmed…), cleared after its feedback plays. */
    emit(kind, extra = {}) {
      const id = ++seq;
      api.set({ event: { id, kind, ...extra } });
      setTimeout(() => {
        if (state.event?.id === id) api.set({ event: null });
      }, 1600);
    },
  };
  return api;
}

/* ───────── actions (local only) ───────── */

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function actions(store) {
  const s = () => store.get();
  return {
    start() {
      if (s().companion !== "on" || s().starting) return;
      // Feedback only: the real action is one server call; no countdown, no artificial wait.
      store.set({ starting: true });
      setTimeout(
        () => {
          store.set({
            phase: "live",
            matches: [],
            starting: false,
            confirmEnd: false,
            ratingKnown: true,
          });
          store.emit("started");
        },
        reducedMotion() ? 0 : 450,
      );
    },
    /** Battlelog first (rating pending), then the profile confirms the MR. */
    ingest(result) {
      if (s().phase !== "live") return;
      const i = s().matches.length;
      const m = matchFromScript(i, true);
      if (result) m.result = result;
      store.set({ matches: [...s().matches, m] });
      store.emit("match", { matchId: m.id });
      setTimeout(
        () => {
          const cur = s();
          if (cur.phase === "live" && cur.matches.some((x) => x.id === m.id && x.mrAfter === null))
            this.confirmRating(m.id);
        },
        reducedMotion() ? 900 : 1800,
      );
    },
    confirmRating(id) {
      store.set({
        matches: s().matches.map((x) => (x.id === id ? { ...x, mrAfter: x.scriptMr } : x)),
      });
      store.emit("rating", { matchId: id });
    },
    askEnd: () => store.set({ confirmEnd: true }),
    cancelEnd: () => store.set({ confirmEnd: false }),
    end() {
      store.set({ phase: "recap", confirmEnd: false });
      store.emit("ended");
    },
    toDashboard() {
      // Back to PREPARE: the just-finished session becomes the "previous session" context.
      const d = derive(s());
      store.set({
        phase: "prepare",
        view: "dashboard",
        hasPrevious: true,
        lastRecap: d.games > 0 ? d : null,
        matches: [],
      });
    },
    prepareAnother() {
      this.toDashboard();
      store.emit("prepare");
    },
    setCompanion: (v) => store.set({ companion: v }),
    setView: (v) => store.set({ view: v }),
  };
}
