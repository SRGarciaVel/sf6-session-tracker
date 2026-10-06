import { afterEach, describe, expect, it, vi } from "vitest";
import emailEn from "@/i18n/messages/email.en.json";
import emailEs from "@/i18n/messages/email.es.json";
import {
  EmailSendError,
  clearEmailOutbox,
  flushEmailQueue,
  getEmailOutbox,
  queueTransactionalEmail,
  sendTransactionalEmail,
  setEmailTransport,
  type EmailTransport,
} from "./sender";
import { renderEmail } from "./templates";

vi.mock("@/server/env", () => ({ getEnv: () => ({ EMAIL_PROVIDER: "memory" }) }));
vi.mock("@/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const URL_ =
  "https://sst.example/api/auth/verify-email?token=abc.def&callbackURL=%2Fverify-email%2Fresult";
const keysOf = (o: object, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v ? keysOf(v as object, `${p}${k}.`) : [`${p}${k}`],
  );

describe("email templates", () => {
  it("ES/EN catalogs have the same keys", () => {
    expect(keysOf(emailEs).sort()).toEqual(keysOf(emailEn).sort());
  });

  it.each(["verify", "reset"] as const)(
    "%s: HTML + text, CTA, raw link, expiry, ignore copy, both locales",
    (kind) => {
      for (const locale of ["es", "en"] as const) {
        const m = (locale === "es" ? emailEs : emailEn)[kind];
        const out = renderEmail({ kind, locale, url: URL_, expiresInMinutes: 60 });
        expect(out.subject).toBe(m.subject);
        expect(out.text).toContain(URL_);
        expect(out.text).toContain("60");
        expect(out.text).toContain(m.ignore);
        expect(out.html).toContain(`lang="${locale}"`);
        expect(out.html).toContain(m.cta);
        expect(out.html).toContain(URL_.replace(/&/g, "&amp;"));
        // No tracking pixels, remote images, scripts or fonts.
        expect(out.html).not.toMatch(/<img|<script|@import|url\(|<link/i);
      }
    },
  );

  it("escapes the link (no HTML injection through the URL)", () => {
    const out = renderEmail({
      kind: "verify",
      locale: "en",
      url: 'https://sst.example/?x="><script>alert(1)</script>',
      expiresInMinutes: 60,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("sender", () => {
  afterEach(() => {
    setEmailTransport(null);
    clearEmailOutbox();
  });
  const msg = { to: "a@b.dev", subject: "S", html: "<p>h</p>", text: "t", kind: "verify" };

  it("memory transport captures messages (tests never send externally)", async () => {
    await sendTransactionalEmail(msg);
    expect(getEmailOutbox()).toEqual([msg]);
  });

  it("retries once on a transient failure with the SAME idempotency key", async () => {
    vi.useFakeTimers();
    const keys: string[] = [];
    const flaky: EmailTransport = {
      name: "flaky",
      async send(_m, { idempotencyKey }) {
        keys.push(idempotencyKey);
        if (keys.length === 1) throw new EmailSendError("timeout", true);
        return { id: "ok" };
      },
    };
    setEmailTransport(flaky);
    const p = sendTransactionalEmail(msg);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ id: "ok" });
    vi.useRealTimers();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).not.toContain("a@b.dev");
  });

  it("does not retry permanent failures (config, rejected, quota)", async () => {
    for (const category of ["config", "rejected", "quota"] as const) {
      let calls = 0;
      setEmailTransport({
        name: "bad",
        async send() {
          calls++;
          throw new EmailSendError(category, false);
        },
      });
      await expect(sendTransactionalEmail(msg)).rejects.toMatchObject({ category });
      expect(calls).toBe(1);
    }
  });

  it("queue: never throws to the caller; failures are absorbed (and logged)", async () => {
    setEmailTransport({
      name: "down",
      async send() {
        throw new EmailSendError("config", false);
      },
    });
    expect(() => queueTransactionalEmail(msg)).not.toThrow();
    await expect(flushEmailQueue()).resolves.toBeUndefined();
  });
});
