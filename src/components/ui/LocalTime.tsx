"use client";

import { useLocale } from "next-intl";

/**
 * Formats a timestamp in the app locale and the viewer's timezone (the server usually runs in
 * UTC). suppressHydrationWarning: the server's best guess is replaced on the client.
 */
export function LocalTime({ iso, format }: { iso: string; format: "day" | "time" | "datetime" }) {
  const locale = useLocale();
  const date = new Date(iso);
  let text: string;
  if (format === "time") {
    text = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  } else if (format === "datetime") {
    text = date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } else {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((d0 - d1) / 86_400_000);
    if (days === 0 || days === 1) {
      // "today" / "yesterday" — "hoy" / "ayer"
      const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
      text = rel.charAt(0).toLocaleUpperCase(locale) + rel.slice(1);
    } else {
      text = date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
    }
  }
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
