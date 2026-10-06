/**
 * Transactional email templates (Phase 4.6, docs/auth.md). Pure: (kind, locale, url) → subject,
 * HTML and plain text. Copy lives in src/i18n/messages/email.{es,en}.json.
 *
 * Rules: no tracking pixels, no remote images or fonts, no marketing, no account data (not
 * even the display name). The only dynamic value is the Better Auth-generated link, which is
 * HTML-escaped. Inline styles + table layout for broad client support; readable in dark mode.
 */
import type { Locale } from "@/i18n/locale";
import emailEn from "@/i18n/messages/email.en.json";
import emailEs from "@/i18n/messages/email.es.json";

export type EmailKind = "verify" | "reset";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const CATALOG = { en: emailEn, es: emailEs } as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));

export function renderEmail(input: {
  kind: EmailKind;
  locale: Locale;
  url: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const m = CATALOG[input.locale];
  const copy = m[input.kind];
  const expires = fill(m.common.expires, { minutes: input.expiresInMinutes });
  const url = escapeHtml(input.url);

  const text = [
    m.common.brand,
    "",
    copy.heading,
    "",
    copy.body,
    "",
    `${copy.cta}:`,
    input.url,
    "",
    expires,
    "",
    copy.ignore,
    "",
    "—",
    m.common.automated,
  ].join("\n");

  const html = `<!doctype html>
<html lang="${input.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f8;color:#111427;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f8;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #ff2e93;">
<tr><td style="padding:28px 32px 8px;">
<p style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.08em;color:#0b0f1e;">SST</p>
<p style="margin:2px 0 0;font-size:12px;letter-spacing:0.06em;color:#4d5578;">Session Stats Tracker</p>
</td></tr>
<tr><td style="padding:16px 32px 0;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0b0f1e;">${escapeHtml(copy.heading)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#2a3150;">${escapeHtml(copy.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0b0f1e;">
<a href="${url}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(copy.cta)}</a>
</td></tr></table>
<p style="margin:24px 0 6px;font-size:13px;line-height:1.5;color:#4d5578;">${escapeHtml(m.common.fallbackLink)}</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${url}" style="color:#1a56db;">${url}</a></p>
<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#2a3150;">${escapeHtml(expires)}</p>
<p style="margin:0 0 28px;font-size:13px;line-height:1.5;color:#2a3150;">${escapeHtml(copy.ignore)}</p>
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e3e6ef;">
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7394;">${escapeHtml(m.common.automated)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: copy.subject, html, text };
}
