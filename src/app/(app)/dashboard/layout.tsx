import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { requireUser } from "@/server/auth/session";
import { NavTabs } from "./_components/NavTabs";
import { SignOutButton } from "./_components/SignOutButton";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line-strong bg-bg/92 backdrop-blur-sm">
        {/* thin magenta→cyan energy line on top of the bar */}
        <div
          aria-hidden
          className="h-0.5 bg-gradient-to-r from-magenta via-violet to-cyan opacity-80"
        />
        <div className="mx-auto flex h-14 max-w-[1440px] items-stretch justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-stretch gap-4 sm:gap-8">
            <div className="flex items-center">
              <Logo variant="compact" />
            </div>
            <div className="hidden sm:flex">
              <NavTabs />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <LocaleSwitcher />
            <span className="hidden max-w-48 truncate text-xs text-faint lg:inline">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
        <div className="flex h-11 border-t border-line sm:hidden">
          <NavTabs />
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 pt-5 pb-16 sm:px-6 sm:pt-6">{children}</main>
    </div>
  );
}
