"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocaleAction } from "@/i18n/actions";
import { LOCALES } from "@/i18n/locale";
import { cx } from "./primitives";

/** Discreet ES | EN toggle. Presentation only: never touches sessions, overlays or tracking. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("Common");
  const tNav = useTranslations("Nav");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const choose = (next: string) => {
    if (next === locale) return;
    startTransition(async () => {
      const res = await setLocaleAction(next);
      if (res.ok) router.refresh();
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label={tNav("switchLanguage")}
      className={cx(
        "inline-flex items-stretch border-b border-line-strong",
        pending && "opacity-60",
      )}
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === locale}
          title={t(`languageNames.${l}`)}
          lang={l}
          disabled={pending}
          onClick={() => choose(l)}
          className={cx(
            "relative px-2.5 py-1 font-display text-sm font-bold tracking-[0.1em] uppercase transition-colors",
            "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-cyan after:transition-transform after:duration-200",
            l === locale
              ? "text-text after:scale-x-100 after:shadow-[0_0_8px_var(--color-cyan)]"
              : "text-faint after:scale-x-0 hover:text-text",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
