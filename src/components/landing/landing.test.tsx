import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OVERLAY_THEMES } from "@/domain/overlay/config";
import { overlayConfigSchema } from "@/domain/overlay/config";
import { THEME_REGISTRY } from "@/domain/overlay/themes";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { BuiltForFightingGames } from "./BuiltForFightingGames";
import { CreatorPreview } from "./CreatorPreview";
import { FinalCta } from "./FinalCta";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { LandingMotion } from "./LandingMotion";
import { LiveSessionStory } from "./LiveSessionStory";
import { OverlayShowcase } from "./OverlayShowcase";
import {
  CREATOR_SEQUENCE,
  SHOWCASE_THEMES,
  STORY_STATS,
  STORY_STEPS,
  creatorPreviewConfig,
  landingLiveState,
  landingOverlayConfig,
} from "./demo-state";

const render = (locale: "es" | "en", node: ReactNode) =>
  renderToString(
    <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en} timeZone="UTC">
      <LandingMotion>{node}</LandingMotion>
    </NextIntlClientProvider>,
  );
const keys = (o: object, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v ? keys(v as object, `${p}${k}.`) : [`${p}${k}`],
  );
const primary = { href: "/signup", label: "CTA" };

describe("landing content", () => {
  it("ES/EN Landing catalogs have identical keys", () => {
    expect(keys(es.Landing).sort()).toEqual(keys(en.Landing).sort());
  });

  it("showcase covers every registered theme, each with a name and tagline in both languages", () => {
    expect([...SHOWCASE_THEMES].sort()).toEqual([...OVERLAY_THEMES].sort());
    expect([...SHOWCASE_THEMES].sort()).toEqual(Object.keys(THEME_REGISTRY).sort());
    for (const m of [es, en]) {
      for (const id of SHOWCASE_THEMES) {
        expect(m.Landing.showcase.taglines[id], id).toBeTruthy();
        expect(m.Builder.themes[id].name, id).toBeTruthy();
      }
    }
  });

  it("demo configs are valid overlay configs (the real renderer's contract)", () => {
    for (const id of SHOWCASE_THEMES) {
      expect(overlayConfigSchema.safeParse(landingOverlayConfig(id, "es")).success, id).toBe(true);
    }
    for (const step of CREATOR_SEQUENCE) {
      expect(overlayConfigSchema.safeParse(creatorPreviewConfig(step, "en")).success, step).toBe(
        true,
      );
    }
  });

  it("the live story shows exactly the advertised update (demo values, static)", () => {
    const before = landingLiveState(STORY_STATS.live).session;
    const after = landingLiveState(STORY_STATS.updated).session;
    expect([before.wins, before.losses, before.currentWinStreak]).toEqual([11, 5, 3]);
    expect([after.wins, after.losses, after.currentWinStreak]).toEqual([12, 5, 4]);
    expect(before.characters[0]?.current?.value).toBe(1588);
    expect(after.characters[0]?.current?.value).toBe(1684);
    expect(after.characters[0]?.delta).toBe(96);
    expect(STORY_STEPS.indexOf("updated")).toBeGreaterThan(STORY_STEPS.indexOf("victory"));
  });
});

describe("landing scenes render on the server (content never depends on JS)", () => {
  it.each(["es", "en"] as const)(
    "%s: every scene, headings and copy present and not hidden",
    (locale) => {
      const m = locale === "es" ? es : en;
      const html = render(
        locale,
        <>
          <Hero locale={locale} primary={primary} />
          <LiveSessionStory locale={locale} />
          <HowItWorks />
          <OverlayShowcase locale={locale} />
          <CreatorPreview locale={locale} />
          <BuiltForFightingGames />
          <FinalCta primary={primary} />
        </>,
      );
      const decode = (s: string) =>
        s
          .replace(/&#x27;|&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"');
      const text = decode(html.replace(/<!-- -->/g, ""));
      for (const s of [
        m.Landing.titleLine1,
        m.Landing.titleLine2,
        m.Landing.supportedGame,
        m.Landing.story.title,
        m.Landing.how.title,
        m.Landing.step1Title,
        m.Landing.step3Body,
        m.Landing.showcase.title,
        m.Landing.creator.title,
        m.Landing.built.supported,
        m.Landing.final.line3,
        ...STORY_STEPS.map((s) => m.Landing.story.steps[s].title),
        ...SHOWCASE_THEMES.map((id) => m.Landing.showcase.taglines[id]),
      ]) {
        expect(text, s).toContain(s);
      }
      expect((html.match(/<h1/g) ?? []).length).toBe(1);
      expect((html.match(/<h2/g) ?? []).length).toBe(6);
      expect(html).toContain('href="#how"');
      expect(html).toContain('id="how"');
      // Text is never shipped hidden in the server HTML (reveals only apply after hydration).
      expect(html).not.toMatch(/<(h1|h2|h3|p)[^>]*style="[^"]*opacity:\s*0/);
      // Real product renderer, real themes.
      expect(html).toContain("ov-theme-competitive");
      expect(html).toContain("ov-theme-fighter");
    },
  );

  it("the reveal hidden state is gated on hydration and reduced motion in CSS", () => {
    const css = readFileSync("src/components/landing/landing.css", "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const hidden = css
      .split("\n")
      .filter((l) => /\[data-reveal="[a-z]+"\]:not\(\[data-inview\]\)/.test(l));
    expect(hidden.length).toBeGreaterThan(0);
    for (const line of hidden) expect(line).toContain('[data-motion="ready"]');
    // Every hidden state lives inside the no-preference media block (reduced motion: never hidden).
    const open = css.indexOf("@media (prefers-reduced-motion: no-preference)");
    let depth = 0;
    let end = open;
    for (let i = css.indexOf("{", open); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    const block = css.slice(open, end);
    for (const line of hidden) expect(block).toContain(line.trim());
    expect(css.slice(0, open)).not.toContain('[data-motion="ready"]');
    expect(css.slice(end)).not.toContain('[data-motion="ready"]');
  });
});

describe("landing boundaries", () => {
  const dir = "src/components/landing";
  const sources = readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const);

  it("no server-only, network or data access from landing components", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/@\/server\/|fetch\(|EventSource|from "postgres"|drizzle/);
    }
  });

  it("no scroll hijacking libraries and no GSAP", () => {
    const pkg = readFileSync("package.json", "utf8");
    expect(pkg).not.toMatch(/"(gsap|lenis|@studio-freight\/lenis|locomotive-scroll)"/);
    for (const [f, src] of sources)
      expect(src, f).not.toMatch(/addEventListener\("wheel"|preventDefault\(\)/);
  });
});
