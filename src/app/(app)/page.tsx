import Link from "next/link";
import { OverlayView } from "@/components/overlay/OverlayView";
import { Logo } from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/primitives";
import { DEFAULT_OVERLAY_CONFIG, applyThemeDefaults } from "@/domain/overlay/config";
import { sampleLiveState } from "@/domain/overlay/state";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const STEPS = [
  ["01", "Enter your CFN User ID", "We verify the player and read rank, LP and MR."],
  ["02", "Start a session", "Your current MR/LP and last match become the baseline."],
  ["03", "Add one URL to OBS", "Browser Source → paste → done. Stats update by themselves."],
] as const;

export default async function LandingPage() {
  const user = await getCurrentUser();
  const live = sampleLiveState();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 sm:px-6">
      <nav className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/dashboard" className={buttonClass("primary", "sm")}>
              Open dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonClass("ghost", "sm")}>
                Log in
              </Link>
              <Link href="/signup" className={buttonClass("primary", "sm")}>
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>

      <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <p className="font-display text-xs font-semibold tracking-[0.3em] text-accent uppercase">
            Street Fighter 6 · OBS overlay
          </p>
          <h1 className="mt-4 font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
            Your session stats,
            <br />
            <span className="text-accent">live on stream.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted">
            Wins, losses, win rate, MR and LP update automatically after every ranked match. No
            hotkeys, no manual counters.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={user ? "/dashboard" : "/signup"} className={buttonClass("primary", "lg")}>
              {user ? "Go to dashboard" : "Create free account"}
            </Link>
          </div>
        </div>

        <div className="space-y-4">
          {(["fighter", "competitive", "minimal"] as const).map((theme) => (
            <div
              key={theme}
              className="bg-slash overflow-hidden rounded-lg border border-line bg-surface-2"
            >
              <div className="aspect-[800/180]">
                <OverlayView
                  config={applyThemeDefaults(DEFAULT_OVERLAY_CONFIG, theme)}
                  live={live}
                  sizing={{ mode: "box", width: 520, height: 117 }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {STEPS.map(([n, title, body]) => (
          <div key={n} className="bg-surface p-6">
            <span className="font-display text-sm font-bold text-accent">{n}</span>
            <h3 className="mt-2 font-display text-lg font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>

      <footer className="py-10 text-xs text-faint">
        Not affiliated with or endorsed by Capcom. Street Fighter is a trademark of Capcom Co., Ltd.
      </footer>
    </main>
  );
}
