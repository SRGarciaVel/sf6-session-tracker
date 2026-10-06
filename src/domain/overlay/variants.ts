/**
 * Per-theme variants for Creator themes (Phase 4.5). Only options with a clear visual effect in
 * that theme's renderer; enums/booleans only (no free-form values). Stored per theme so switching
 * themes never loses another theme's choices.
 */
import { z } from "zod";

export const rankCardVariantsSchema = z.strictObject({
  density: z.enum(["compact", "normal"]),
  badge: z.enum(["normal", "large"]),
  glow: z.enum(["off", "subtle", "strong"]),
  background: z.enum(["translucent", "solid"]),
});
export const broadcastVariantsSchema = z.strictObject({
  separators: z.enum(["subtle", "strong"]),
  accent: z.enum(["line", "block"]),
  density: z.enum(["compact", "normal"]),
});
export const prestigeVariantsSchema = z.strictObject({
  glow: z.enum(["subtle", "normal", "strong"]),
  frame: z.enum(["subtle", "normal"]),
  animatedAccent: z.boolean(),
});

export const themeVariantsSchema = z.strictObject({
  "rank-card": rankCardVariantsSchema,
  broadcast: broadcastVariantsSchema,
  prestige: prestigeVariantsSchema,
});
export type ThemeVariants = z.infer<typeof themeVariantsSchema>;

export const DEFAULT_THEME_VARIANTS: ThemeVariants = {
  "rank-card": { density: "normal", badge: "normal", glow: "subtle", background: "translucent" },
  broadcast: { separators: "subtle", accent: "line", density: "normal" },
  prestige: { glow: "normal", frame: "normal", animatedAccent: true },
};

/** Lenient read: defaults per theme/key; an unusable theme entry falls back to its defaults. */
export function parseThemeVariants(raw: unknown): ThemeVariants | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const pick = <K extends keyof ThemeVariants>(key: K, schema: z.ZodType<ThemeVariants[K]>) => {
    const entry = obj[key];
    const merged =
      entry !== null && typeof entry === "object"
        ? { ...DEFAULT_THEME_VARIANTS[key], ...(entry as object) }
        : DEFAULT_THEME_VARIANTS[key];
    const parsed = schema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_THEME_VARIANTS[key];
  };
  return {
    "rank-card": pick("rank-card", rankCardVariantsSchema),
    broadcast: pick("broadcast", broadcastVariantsSchema),
    prestige: pick("prestige", prestigeVariantsSchema),
  };
}
