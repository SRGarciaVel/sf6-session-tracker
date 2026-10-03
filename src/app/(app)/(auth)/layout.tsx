import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { getCurrentUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="bg-slash flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 sm:p-8">
        {children}
      </div>
    </main>
  );
}
