import { redirect } from "next/navigation";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { Logo } from "@/components/ui/Logo";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8 flex w-full max-w-sm items-center justify-between">
        <Logo />
        <LocaleSwitcher />
      </div>
      <div className="hud-panel animate-panel-in w-full max-w-sm p-6 sm:p-8">
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-magenta via-violet to-transparent"
        />
        {children}
      </div>
    </main>
  );
}
