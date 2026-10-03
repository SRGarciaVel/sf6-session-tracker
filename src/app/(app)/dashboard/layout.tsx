import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { requireUser } from "@/server/auth/session";
import { SignOutButton } from "./_components/SignOutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Logo />
            <nav className="hidden items-center gap-1 text-sm sm:flex">
              <Link
                href="/dashboard"
                className="rounded px-3 py-1.5 text-muted hover:bg-surface-3 hover:text-text"
              >
                Dashboard
              </Link>
              <Link
                href="/onboarding"
                className="rounded px-3 py-1.5 text-muted hover:bg-surface-3 hover:text-text"
              >
                Player
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-faint md:inline">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
