/**
 * Prototype pages (design/phase-m2/local-portrait-prototype.md) are never part of the product:
 * available in development, and in a production build ONLY with an explicit opt-in
 * (SST_PROTOTYPE_PAGES=1, e.g. a local `next start` for a real-OBS test). Otherwise they 404.
 */
export function prototypePagesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || env.SST_PROTOTYPE_PAGES === "1";
}
