// @vitest-environment happy-dom
/**
 * M2B — motion contracts outside the live provider: the RECAP entrance (only right after
 * ending, focus on the summary heading), reduced-motion and token rules of the Fight Session
 * cues, and isolation: the OBS overlay documents and the classic dashboard never get them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FightSessionRecap } from "@/app/(app)/dashboard/sessions/[id]/FightSessionRecap";
import es from "@/i18n/messages/es.json";
import { FocusTarget } from "./FocusTarget";
import { START, engineSession } from "./test-support";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recap = (justEnded: boolean, status: "ended" | "active" = "ended") =>
  new DOMParser().parseFromString(
    renderToString(
      <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
        <FightSessionRecap
          session={engineSession({ results: ["win", "loss"], status })}
          ratingModel="per_character"
          startedAt={START.toISOString()}
          endedAt={
            status === "ended" ? new Date(START.getTime() + 20 * 60_000).toISOString() : null
          }
          matches={[]}
          justEnded={justEnded}
        />
      </NextIntlClientProvider>,
    ),
    "text/html",
  );

describe("LIVE → RECAP entrance", () => {
  it("only right after ending: the stage settles in, the summary is already in the document", () => {
    const doc = recap(true);
    const stage = doc.querySelector("section[aria-labelledby='fs-recap-title']")!;
    expect(stage.classList.contains("fs-recap-in")).toBe(true);
    // Nothing waits for motion: the final values are server-rendered in the same document.
    expect(stage.textContent).toContain("Sesión terminada");
    expect(doc.querySelector("#fs-recap-title")?.getAttribute("tabindex")).toBe("-1");
  });
  it("a recap opened from history (or an active session) does not animate", () => {
    expect(recap(false).querySelector(".fs-recap-in")).toBeNull();
    expect(recap(true, "active").querySelector(".fs-recap-in")).toBeNull();
  });
  it("FocusTarget moves focus to the heading once mounted (not to <body>)", () => {
    const host = document.createElement("div");
    host.innerHTML = '<h1 id="t" tabindex="-1">Sesión terminada</h1>';
    document.body.append(host);
    const slot = document.createElement("div");
    document.body.append(slot);
    const root = createRoot(slot);
    act(() => root.render(<FocusTarget id="t" />));
    expect(document.activeElement?.id).toBe("t");
    act(() => root.unmount());
    host.remove();
    slot.remove();
  });
});

describe("Fight Session motion CSS", () => {
  const css = readFileSync("src/app/(app)/globals.css", "utf8");
  const block = css.slice(
    css.indexOf("Motion (state feedback only"),
    css.indexOf("M1 — loading skeletons"),
  );
  const keyframes = (name: string) => {
    const at = block.indexOf(`@keyframes ${name} {`);
    expect(at, name).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = block.indexOf("{", at); i < block.length; i++) {
      if (block[i] === "{") depth++;
      if (block[i] === "}" && --depth === 0) return block.slice(at, i + 1);
    }
    return "";
  };

  it("uses the M2 tokens and an ease-out curve without overshoot", () => {
    expect(block).not.toMatch(/\d+ms cubic-bezier|1\.15\)|--motion-ease-emphasis/);
    for (const cls of [".fs-hit", ".fs-pop", ".fs-stamp-in", ".fs-enter", ".fs-recap-in"])
      expect(block.slice(block.indexOf(`${cls} {`)).split("}")[0]).toMatch(/var\(--motion-/);
  });
  it("animates only transform / translate and opacity (no layout properties)", () => {
    for (const name of [
      "fs-enter",
      "fs-hit",
      "fs-flash",
      "fs-pop",
      "fs-stamp",
      "fs-underline",
      "fs-slash-in",
      "fs-cut-left",
      "fs-cut-right",
      "fs-fade",
      "fs-settle",
    ]) {
      const props = [...keyframes(name).matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(
        props.every((p) => ["transform", "translate", "opacity"].includes(p ?? "")),
        name,
      ).toBe(true);
    }
  });
  it("accents end invisible: nothing lingers (or is hidden) once the cue is over", () => {
    expect(keyframes("fs-flash")).toMatch(/100% {\s*opacity: 0;/);
    expect(keyframes("fs-underline")).toMatch(/100% {\s*transform: none;\s*opacity: 0;/);
    // Entrances end fully visible, in place.
    for (const name of ["fs-pop", "fs-cut-left", "fs-cut-right", "fs-settle"])
      expect(keyframes(name)).toMatch(/100% {\s*transform: none;\s*opacity: 1;/);
    expect(keyframes("fs-enter")).toMatch(/100% {\s*translate: none;\s*opacity: 1;/);
  });
  it("the headline entrance keeps the −6° lean (never overrides .fs-display's transform)", () => {
    expect(keyframes("fs-enter")).not.toMatch(/transform:/);
  });
  it("no continuous motion: every Fight Session cue runs once", () => {
    expect(block).not.toMatch(/infinite/);
  });
  it("reduced motion: the global rule collapses durations; staggered waits drop to zero", () => {
    expect(block).toMatch(
      /prefers-reduced-motion: reduce\)\s*{\s*\.fs-stage-reveal \*,\s*\.fs-recap-in \*,\s*\.fs-round-new\s*{\s*animation-delay: 0ms !important;/,
    );
    expect(css).toMatch(/animation-duration: 1ms !important;/);
  });
});

describe("isolation", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(p) ? [p] : [];
    });
  const CUES =
    /fs-stage-reveal|fs-side-flash|fs-rating-confirmed|fs-recap-in|use-session-motion|fight-session\/motion/;

  it("OBS overlay documents and renderer never carry the Fight Session cues", () => {
    for (const f of [...files("src/app/(overlay)"), ...files("src/components/overlay")])
      expect(CUES.test(readFileSync(f, "utf8")), f).toBe(false);
  });
  it("the classic dashboard does not use the Fight Session motion triggers", () => {
    const users = files("src")
      .filter((f) => !f.includes(".test."))
      .filter((f) => /use-session-motion/.test(readFileSync(f, "utf8")));
    expect(users).toEqual(["src/app/(app)/dashboard/_components/fight/FightSessionDashboard.tsx"]);
  });
});
