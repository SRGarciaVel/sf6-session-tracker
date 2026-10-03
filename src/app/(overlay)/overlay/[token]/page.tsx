import { notFound } from "next/navigation";
import { LiveOverlay } from "@/components/overlay/LiveOverlay";
import { loadOverlayPayload } from "@/server/overlays/public";

export const dynamic = "force-dynamic";

/**
 * Public OBS overlay. Server-renders the CURRENT session state so a refresh (or OBS scene switch)
 * shows the real numbers immediately — never a 0-0 flash — then subscribes to live updates.
 */
export default async function OverlayPage({ params }: PageProps<"/overlay/[token]">) {
  const { token } = await params;
  const result = await loadOverlayPayload(token);
  if (!result) notFound();
  return <LiveOverlay token={token} initial={result.payload} />;
}
