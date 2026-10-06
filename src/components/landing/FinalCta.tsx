/** Scene 7 — closing statement and CTA (server component). Legal note stays in the footer. */
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonClass } from "@/components/ui/primitives";

export function FinalCta({ primary }: { primary: { href: string; label: string } }) {
  const t = useTranslations("Landing.final");
  return (
    <section aria-labelledby="final-title" className="sst-final py-20 text-center lg:py-28">
      <h2
        id="final-title"
        data-reveal="mask"
        className="font-display text-4xl leading-[1.05] font-bold sm:text-6xl"
      >
        <span className="block">{t("line1")}</span>
        <span className="block">{t("line2")}</span>
        <span className="block text-magenta">{t("line3")}</span>
      </h2>
      <div data-reveal="cta" className="mt-10 flex flex-wrap justify-center gap-3">
        <Link href={primary.href} className={buttonClass("primary", "lg")}>
          {primary.label}
        </Link>
        <a href="#how" className={buttonClass("ghost", "lg")}>
          {t("secondary")}
        </a>
      </div>
    </section>
  );
}
