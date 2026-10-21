/**
 * Shared prototype shell: store + render loop + event delegation. Both directions plug in a
 * pure view(state) → HTML and their extra catalog; behaviour (actions, lab, focus) is identical.
 */
import { actions, createStore, scenario } from "./engine.js";
import { animateCounts, fmt, mount, readHash, translator } from "./ui.js";

export function boot({ root, extra, view }) {
  const h = readHash();
  const store = createStore({
    ...scenario(h.scenario),
    view: h.view,
    lang: h.lang,
    labOpen: h.lab,
    toast: null,
  });
  const act = actions(store);

  function render() {
    const s = store.get();
    document.documentElement.lang = s.lang;
    mount(root, view(s));
    if (s.event) animateCounts(root, fmt(s.lang).int);
  }
  store.subscribe(render);
  render();

  let toastTimer = 0;
  function toast(msg) {
    store.set({ toast: msg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => store.set({ toast: null }), 2200);
  }
  const focusSoon = (k) =>
    requestAnimationFrame(() => root.querySelector(`[data-k="${k}"]`)?.focus());

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act],[data-lab]");
    if (!el) return;
    const s = store.get();
    const t = translator(s.lang, extra);
    if (el.dataset.lab) {
      const [k, v] = el.dataset.lab.split(":");
      if (k === "phase")
        store.set({
          ...scenario(v),
          lang: s.lang,
          companion: s.companion,
          labOpen: true,
          view: "dashboard",
        });
      if (k === "companion") act.setCompanion(v);
      if (k === "ingest") act.ingest(v);
      if (k === "lang") store.set({ lang: v });
      return;
    }
    const [a, arg] = el.dataset.act.split(":");
    if (el.tagName === "A") e.preventDefault();
    if (a === "view") return act.setView(arg);
    if (a === "companion") return act.setCompanion(arg);
    if (a === "copy") return toast(t("common.copied"));
    if (a === "toast") return toast(t("common.outOfScope"));
    if (a === "prepareAnother") {
      act.prepareAnother();
      return focusSoon("start");
    }
    if (a === "askEnd") {
      act.askEnd();
      return focusSoon(el.dataset.k === "m-end" ? "m-cancel-end" : "cancel-end");
    }
    act[a]?.();
  });
  root.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-lab-scenario]");
    if (sel) store.set({ ...scenario(sel.value), lang: store.get().lang, labOpen: true });
  });
  root.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches?.("[data-lab-root]")) store.get().labOpen = e.target.open;
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.get().confirmEnd) act.cancelEnd();
  });
  return { store, act };
}
