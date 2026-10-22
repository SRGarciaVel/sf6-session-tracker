"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const ANALYTICS = "/dashboard/analytics";
const TABS = [
  {
    href: "/dashboard",
    key: "dashboard",
    match: (p: string) => p.startsWith("/dashboard") && !p.startsWith(ANALYTICS),
  },
  { href: ANALYTICS, key: "analytics", match: (p: string) => p.startsWith(ANALYTICS) },
  { href: "/onboarding", key: "player", match: (p: string) => p.startsWith("/onboarding") },
] as const;

/** Top tabs: active tab gets the luminous underline (see .hud-tab in globals.css). */
export function NavTabs() {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  return (
    <nav className="flex min-h-full flex-wrap items-stretch" aria-label={t("main")}>
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className="hud-tab"
          aria-current={tab.match(pathname) ? "page" : undefined}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  );
}
