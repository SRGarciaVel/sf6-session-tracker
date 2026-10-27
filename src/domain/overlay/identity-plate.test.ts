/**
 * M2D — identity plate labels and the Auto / Off setting: deterministic labels for the names
 * Capcom sends (the whole roster of the captured profile), future / unknown characters, Random,
 * no identity; new overlays "auto" vs stored configs without the setting "off".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_CONFIG,
  overlayConfigSchema,
  parseOverlayConfig,
  sessionConfigOf,
  sessionOverlayConfigSchema,
} from "./config";
import {
  LABEL_LENGTH,
  LABEL_OVERRIDES,
  identityPlateFor,
  identityPlateModeOf,
} from "./identity-plate";

const roster = (
  JSON.parse(readFileSync("tests/fixtures/capcom/play-1733837998.json", "utf8")) as {
    pageProps: {
      play: {
        character_league_infos: Array<{ character_tool_name: string; character_name: string }>;
      };
    };
  }
).pageProps.play.character_league_infos.map((c) => [c.character_tool_name, c.character_name]);

describe("identityPlateFor: labels", () => {
  it("every character of the captured Capcom roster gets a fixed label (Random ⇒ ?)", () => {
    const labels = Object.fromEntries(
      roster.map(([key, name]) => {
        const plate = identityPlateFor(key, name);
        return [key, plate.kind === "none" ? null : plate.label];
      }),
    );
    expect(labels).toEqual({
      ryu: "RYU",
      luke: "LUK",
      kimberly: "KIM",
      chunli: "CHU",
      manon: "MAN",
      zangief: "ZAN",
      jp: "JP",
      dhalsim: "DHA",
      cammy: "CAM",
      ken: "KEN",
      deejay: "DEE",
      lily: "LIL",
      aki: "AKI",
      rashid: "RAS",
      blanka: "BLA",
      juri: "JUR",
      marisa: "MAR",
      guile: "GUI",
      ed: "ED",
      honda: "HON",
      jamie: "JAM",
      gouki: "AKU",
      sagat: "SAG",
      vega: "BIS",
      terry: "TER",
      mai: "MAI",
      elena: "ELE",
      cviper: "VIP",
      alex: "ALE",
      random: "?",
      ingrid: "ING",
      yasmine: "YAS",
    });
    // Same footprint for every plate in a theme.
    for (const label of Object.values(labels) as Array<string | null>)
      expect(label?.length ?? 0).toBeLessThanOrEqual(LABEL_LENGTH);
  });

  it("the rules: initials joined, a leading initial dropped, diacritics folded, uppercase", () => {
    expect(identityPlateFor("aki", "A.K.I.")).toMatchObject({ label: "AKI", name: "A.K.I." });
    expect(identityPlateFor("vega", "M. Bison")).toMatchObject({ label: "BIS" });
    expect(identityPlateFor("x", "Élodie")).toMatchObject({ label: "ELO" });
    expect(identityPlateFor("x", "  ken  ")).toMatchObject({ label: "KEN", name: "ken" });
  });

  it("overrides are few, documented, and win over the rule", () => {
    expect(Object.keys(LABEL_OVERRIDES)).toEqual(["honda"]);
    expect(identityPlateFor("honda", "Edmond Honda")).toMatchObject({ label: "HON" });
  });

  it("future / unknown characters work from the name Capcom sends (no roster needed)", () => {
    expect(identityPlateFor("newfighter", "Nova Prime")).toEqual({
      kind: "character",
      key: "newfighter",
      label: "NOV",
      name: "Nova Prime",
    });
    // No usable name ⇒ the key; neither usable ⇒ the neutral mark.
    expect(identityPlateFor("sakura", null)).toMatchObject({ label: "SAK", name: "sakura" });
    expect(identityPlateFor("sakura", "サクラ")).toMatchObject({ label: "SAK" });
    expect(identityPlateFor("---", "!!!")).toEqual({ kind: "none" });
  });

  it("Random never names a fighter; no identity ⇒ the neutral mark", () => {
    expect(identityPlateFor("random", "Random")).toEqual({
      kind: "random",
      key: "random",
      label: "?",
      name: "Random",
    });
    expect(identityPlateFor(null, null)).toEqual({ kind: "none" });
    expect(identityPlateFor("", "Ryu")).toEqual({ kind: "none" });
    expect(identityPlateFor(undefined, "Ryu")).toEqual({ kind: "none" });
  });
});

describe("identityPlate setting", () => {
  const legacy = (): Record<string, unknown> => {
    const raw: Record<string, unknown> = { ...DEFAULT_OVERLAY_CONFIG };
    delete raw.identityPlate;
    return raw;
  };
  const read = (raw: unknown) => sessionConfigOf(parseOverlayConfig(raw))!;

  it("modes: only auto / off", () => {
    expect(identityPlateModeOf("auto")).toBe("auto");
    expect(identityPlateModeOf("off")).toBe("off");
    for (const bad of ["on", "AUTO", "", null, undefined, 1, {}])
      expect(identityPlateModeOf(bad)).toBeNull();
  });

  it("new overlays start with auto", () => {
    expect(DEFAULT_OVERLAY_CONFIG.identityPlate).toBe("auto");
  });

  it("a stored config from before the setting reads as off (the running OBS layout never changes)", () => {
    const config = read(legacy());
    expect(config.identityPlate).toBe("off");
    expect(config.theme).toBe(DEFAULT_OVERLAY_CONFIG.theme); // nothing else changes
  });

  it("explicit auto / off survive a read", () => {
    expect(read({ ...DEFAULT_OVERLAY_CONFIG, identityPlate: "auto" }).identityPlate).toBe("auto");
    expect(read({ ...DEFAULT_OVERLAY_CONFIG, identityPlate: "off" }).identityPlate).toBe("off");
  });

  it("an unusable stored value reads as off and keeps the rest of the overlay", () => {
    const config = read({ ...DEFAULT_OVERLAY_CONFIG, theme: "fighter", identityPlate: "portrait" });
    expect(config.identityPlate).toBe("off");
    expect(config.theme).toBe("fighter");
  });

  it("saving: the strict schema rejects an invalid value; an editor without the field sends off", () => {
    expect(
      overlayConfigSchema.safeParse({ ...DEFAULT_OVERLAY_CONFIG, identityPlate: "on" }).success,
    ).toBe(false);
    const parsed = sessionOverlayConfigSchema.parse(legacy());
    expect(parsed.identityPlate).toBe("off");
  });
});
