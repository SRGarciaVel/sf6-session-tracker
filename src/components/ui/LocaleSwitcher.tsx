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
        "inline-flex rounded-md border border-line-strong bg-surface-2 p-0.5",
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
            "rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider uppercase transition-colors",
            l === locale ? "bg-surface-3 text-text" : "text-faint hover:text-text",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
