/**
 * Sample-size bands (pure). PRODUCT COMMUNICATION, not statistics: they say how many decided
 * matches stand behind a win rate so the UI can de-emphasise small samples. They are not
 * confidence intervals and must never be worded as "reliable", "conclusive" or "significant".
 *
 *   0       none         1–4   very-small     5–9   small
 *   10–29   developing   30+   larger
 *
 * The count is DECIDED matches (wins + losses): the denominator of the win rate it qualifies.
 */

export const SAMPLE_BANDS = ["none", "very-small", "small", "developing", "larger"] as const;
export type SampleBand = (typeof SAMPLE_BANDS)[number];

/** Lower bound (inclusive) of each band, highest first. The single place to change them. */
const BAND_FLOORS: ReadonlyArray<{ min: number; band: SampleBand }> = [
  { min: 30, band: "larger" },
  { min: 10, band: "developing" },
  { min: 5, band: "small" },
  { min: 1, band: "very-small" },
];

export function sampleBand(decided: number): SampleBand {
  if (!Number.isFinite(decided) || decided < 1) return "none";
  for (const { min, band } of BAND_FLOORS) if (decided >= min) return band;
  return "none";
}
