/**
 * Fictional, internally consistent demo data for the SST promo (Spanish UI).
 * Player "DEMO_SST" (fictitious CFN 9990000100). Nothing here is a real account.
 */
export const DEMO = {
  cfn: "9990000100",
  displayName: "DEMO_SST",
  email: (suffix: string) => `promo-${suffix}@test.local`,
  /** Yasmine: session baseline 1829 MR → 1859 (+30) after the session so far → 1861 (+32). */
  yasmine: { baseline: 1829, before: 1859, after: 1861 },
  /** Ryu: Ultimate Master 2189 MR, authoritative position #530 (Rank Progress scene). */
  ryu: { mr: 2189, position: 530 },
  /** A.K.I.: LP character (Diamond), untouched by the session. */
  aki: { lp: 21950 },
  /** Illustrative Legend boundary (the shape observed on 2026-10-19: #497 @2196, #505 @2195). */
  legend: {
    cutoffMr: 2196,
    lastLegendPosition: 497,
    firstNonLegendPosition: 505,
    firstNonLegendMr: 2195,
  },
  /** Session results before the showcased match (oldest first): 5 W · 2 L. */
  results: ["win", "win", "loss", "win", "win", "loss", "win"] as const,
} as const;
