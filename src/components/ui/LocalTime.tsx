"use client";

/**
 * Formats a timestamp in the viewer's timezone (the server usually runs in UTC).
 * suppressHydrationWarning: the server's best guess is replaced on the client.
 */
export function LocalTime({ iso, format }: { iso: string; format: "day" | "time" | "datetime" }) {
  const date = new Date(iso);
  let text: string;
  if (format === "time") {
    text = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } else if (format === "datetime") {
    text = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } else {
    const now = new Date();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((d0 - d1) / 86_400_000);
    text =
      days === 0
        ? "Today"
        : days === 1
          ? "Yesterday"
          : date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
