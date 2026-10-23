// @vitest-environment happy-dom
/**
 * M2A — SST interactive controls: SVG icon accessibility, ActionLink semantics (links stay
 * links), destinations unchanged, no improvised control glyphs left, motion-token contract and
 * the copy → check feedback.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { ActionLink } from "./ActionLink";
import { CopyButton } from "./CopyButton";
import { ICON_NAMES, Icon } from "./Icon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wrap = (node: React.ReactNode, locale: "es" | "en" = "es") =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("Icon", () => {
  it("is decorative by default: aria-hidden, not focusable, no title", () => {
    const svg = dom(renderToString(<Icon name="arrow-right" />)).querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("role")).toBeNull();
  });
  it("a standalone icon gets an accessible name", () => {
    const svg = dom(renderToString(<Icon name="copy" label="Copiar" />)).querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Copiar");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });
  it("one consistent drawing style: 24-unit grid, 2 px square-capped stroke, text-sized", () => {
    for (const name of ICON_NAMES) {
      const svg = dom(renderToString(<Icon name={name} />)).querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg.getAttribute("stroke-width")).toBe("2");
      expect(svg.getAttribute("stroke-linecap")).toBe("square");
      expect(svg.getAttribute("width")).toBe("1em");
      expect(svg.getAttribute("fill")).toBe("none");
    }
  });
});

describe("ActionLink", () => {
  it("app navigation is an anchor (Next Link) with a trailing forward icon — never a button", () => {
    const a = dom(
      wrap(<ActionLink href="/dashboard#overlays">Gestionar</ActionLink>),
    ).querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/dashboard#overlays");
    expect(a.getAttribute("role")).toBeNull();
    expect(a.querySelector("button")).toBeNull();
    expect(a.lastElementChild?.getAttribute("data-icon")).toBe("arrow-right");
    expect(a.textContent).toBe("Gestionar");
  });
  it("back puts the icon first; down/in-page jumps are plain anchors", () => {
    const back = dom(
      wrap(
        <ActionLink href="/dashboard" kind="back">
          Panel
        </ActionLink>,
      ),
    ).querySelector("a")!;
    expect(back.firstElementChild?.getAttribute("data-icon")).toBe("arrow-left");
    const down = dom(
      wrap(
        <ActionLink href="#companion" kind="down">
          Ir
        </ActionLink>,
      ),
    ).querySelector("a")!;
    expect(down.getAttribute("href")).toBe("#companion");
    expect(down.querySelector('[data-icon="arrow-down"]')).not.toBeNull();
  });
  it("external links open a new tab safely and say so to screen readers (ES/EN)", () => {
    for (const [locale, hint] of [
      ["es", "se abre en una pestaña nueva"],
      ["en", "opens in a new tab"],
    ] as const) {
      const a = dom(
        wrap(
          <ActionLink href="https://example.org" kind="external">
            Buckler
          </ActionLink>,
          locale,
        ),
      ).querySelector("a")!;
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noreferrer");
      expect(a.querySelector(".sr-only")?.textContent).toContain(hint);
      expect(a.querySelector('[data-icon="external"]')).not.toBeNull();
    }
  });
});

describe("CopyButton feedback", () => {
  afterEach(() => vi.unstubAllGlobals());
  async function click(writeText: () => Promise<void>) {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <NextIntlClientProvider locale="es" messages={es} timeZone="UTC">
          <CopyButton value="https://sst.example/overlay/t" label="Copiar URL para OBS" />
        </NextIntlClientProvider>,
      ),
    );
    const button = host.querySelector("button")!;
    expect(button.querySelector('[data-icon="copy"]')).not.toBeNull();
    await act(async () => button.click());
    const out = {
      status: button.getAttribute("data-copy-status"),
      icon: button.querySelector("svg")?.getAttribute("data-icon"),
    };
    act(() => root.unmount());
    host.remove();
    return out;
  }
  it("copy → check icon on success", async () => {
    expect(await click(vi.fn().mockResolvedValue(undefined))).toEqual({
      status: "copied",
      icon: "check",
    });
  });
  it("failure keeps the copy icon (never a false confirmation)", async () => {
    const r = await click(vi.fn().mockRejectedValue(new Error("denied")));
    expect(r.icon).toBe("copy");
    expect(r.status).not.toBe("copied");
  });
});

describe("no improvised control glyphs", () => {
  const CONTROL_GLYPH = /[←→↗↓›‹]|-->|->/;
  /** Content, not controls: data transitions and instruction paths stay as text. */
  const CONTENT_KEYS = new Set([
    "Landing.step3Body",
    "Onboarding.help",
    "Dashboard.obs.step1",
    "Builder.moreTypography",
    "Builder.obsHint",
    "Builder.simulation.done.win",
    "Builder.simulation.done.loss",
    "Builder.rotation.modes.session-all.hint",
    "Builder.brandFlag.slotHidden",
    "Analytics.review.replays.helpPath",
  ]);
  it("message catalogs (ES/EN): arrows only in content strings", () => {
    for (const catalog of [es, en]) {
      const bad: string[] = [];
      const walk = (o: unknown, path: string) => {
        if (typeof o === "string") {
          if (CONTROL_GLYPH.test(o) && !CONTENT_KEYS.has(path)) bad.push(`${path}: ${o}`);
        } else if (o && typeof o === "object") {
          for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
        }
      };
      walk(catalog, "");
      expect(bad).toEqual([]);
    }
  });
  it("components: no arrow/chevron glyph used as a control decoration", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory()
          ? files(p)
          : p.endsWith(".tsx") && !p.includes(".test.")
            ? [p]
            : [];
      });
    const offenders: string[] = [];
    for (const f of [...files("src/app"), ...files("src/components")]) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // A glyph alone in JSX text, or right after a translated label, is a control decoration.
          if (
            /^\s*[→↗↓›‹]\s*$/.test(line) ||
            /\}\s*[→↗↓›]\s*</.test(line) ||
            /aria-hidden>\s*[→↗↓›]/.test(line)
          )
            offenders.push(`${f}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("motion tokens", () => {
  const css = readFileSync("src/app/(app)/globals.css", "utf8");
  it("documented duration and easing tokens exist", () => {
    for (const token of [
      "--motion-instant",
      "--motion-quick",
      "--motion-standard",
      "--motion-panel",
      "--motion-stage",
      "--motion-ease-out",
      "--motion-ease-in-out",
      "--motion-ease-emphasis",
      "--motion-nudge",
    ])
      expect(css).toContain(`${token}:`);
  });
  it("reduced motion zeroes the icon nudge (no jump) and the global rule collapses durations", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*:root\s*{\s*--motion-nudge: 0px;/,
    );
    expect(css).toMatch(
      /animation-duration: 1ms !important;[\s\S]*transition-duration: 1ms !important;/,
    );
  });
  it("controls only animate transform (compositor-friendly)", () => {
    const block = css.slice(css.indexOf(".sst-icon {"), css.indexOf("/* ActionLink"));
    expect(block).toMatch(/transition: transform/);
    expect(block).not.toMatch(/width|height|margin|padding/);
  });
});
