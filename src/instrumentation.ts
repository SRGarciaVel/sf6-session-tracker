/**
 * Next.js instrumentation hook: register() runs once per server instance before it serves
 * requests (never during `next build`). It only starts the in-process tracking scheduler when
 * TRACKER_RUNTIME_MODE=embedded; in the default standalone mode the worker is its own process.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Cheap pre-check so standalone deploys never even load the tracker modules here.
  if (process.env.TRACKER_RUNTIME_MODE !== "embedded") return;
  const { bootEmbeddedTracker } = await import("@/server/tracking/embedded-boot");
  bootEmbeddedTracker();
}
