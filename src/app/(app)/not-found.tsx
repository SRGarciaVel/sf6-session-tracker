import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass } from "@/components/ui/primitives";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="font-display text-xs font-bold tracking-[0.3em] text-magenta uppercase">404</p>
      <h1 className="mt-3 font-display text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("body")}</p>
      <Link href="/dashboard" className={`${buttonClass("secondary")} mt-6`}>
        {t("back")}
      </Link>
    </main>
  );
}
