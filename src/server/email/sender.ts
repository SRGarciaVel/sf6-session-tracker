/**
 * Transactional email (Phase 4.6, docs/auth.md). The ONLY place that talks to an email
 * provider: auth and business code call sendTransactionalEmail()/queueTransactionalEmail().
 *
 * Transports (EMAIL_PROVIDER):
 *   resend — real delivery (production; required there, see env.ts)
 *   log    — development only: prints the message (including the link) to the server console
 *   memory — tests: in-process outbox (getEmailOutbox), nothing leaves the machine
 *
 * Logging never includes the recipient address, subject, body, links or tokens: only the kind,
 * the internal user id, the provider message id and a failure category.
 */
import { createHash } from "node:crypto";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Kind for logs/metrics ("verify", "reset"); never user data. */
  kind: string;
  /** Internal user id for logs (optional). */
  userId?: string;
}

export type EmailFailureCategory =
  "config" | "rejected" | "rate_limited" | "quota" | "timeout" | "provider_unavailable" | "unknown";

export class EmailSendError extends Error {
  constructor(
    readonly category: EmailFailureCategory,
    readonly retryable: boolean,
  ) {
    super(`email send failed: ${category}`);
    this.name = "EmailSendError";
  }
}

export interface EmailTransport {
  readonly name: string;
  send(
    message: TransactionalEmail,
    opts: { idempotencyKey: string },
  ): Promise<{ id: string | null }>;
}

const SEND_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_500;

/* ───────── transports ───────── */

type ResendClient = {
  emails: {
    send(
      payload: {
        from: string;
        to: string[];
        subject: string;
        html: string;
        text: string;
        replyTo?: string;
        headers?: Record<string, string>;
      },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { name: string; statusCode?: number | null } | null;
    }>;
  };
};

let resendClient: Promise<ResendClient> | null = null;

/** Lazy: `next build` and tests never construct the client or need the key. */
function getResendClient(apiKey: string): Promise<ResendClient> {
  resendClient ??= import("resend").then(({ Resend }) => new Resend(apiKey) as ResendClient);
  return resendClient;
}

function categorizeResendError(name: string, status: number | null | undefined): EmailSendError {
  switch (name) {
    case "missing_api_key":
    case "invalid_api_key":
    case "restricted_api_key":
    case "invalid_from_address":
    case "invalid_access":
    case "security_error":
      return new EmailSendError("config", false);
    case "validation_error":
    case "invalid_parameter":
    case "missing_required_field":
      return new EmailSendError("rejected", false);
    case "rate_limit_exceeded":
    case "concurrent_idempotent_requests":
      return new EmailSendError("rate_limited", true);
    case "monthly_quota_exceeded":
    case "daily_quota_exceeded":
      return new EmailSendError("quota", false);
    case "application_error":
    case "internal_server_error":
      return new EmailSendError("provider_unavailable", true);
    default:
      return new EmailSendError(
        "unknown",
        status === undefined || status === null || status >= 500,
      );
  }
}

const resendTransport: EmailTransport = {
  name: "resend",
  async send(message, { idempotencyKey }) {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new EmailSendError("config", false);
    const client = await getResendClient(env.RESEND_API_KEY);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EmailSendError("timeout", true)), SEND_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        client.emails.send(
          {
            from: env.EMAIL_FROM,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
          },
          { idempotencyKey },
        ),
        timeout,
      ]);
      if (result.error) throw categorizeResendError(result.error.name, result.error.statusCode);
      return { id: result.data?.id ?? null };
    } catch (e) {
      if (e instanceof EmailSendError) throw e;
      // Network failure / unexpected SDK error: retryable, details not propagated.
      throw new EmailSendError("provider_unavailable", true);
    } finally {
      clearTimeout(timer);
    }
  },
};

/** Development only (env.ts refuses it in production). */
const logTransport: EmailTransport = {
  name: "log",
  async send(message) {
    console.log(
      `\n[dev email] kind=${message.kind} to=${message.to}\nsubject: ${message.subject}\n\n${message.text}\n`,
    );
    return { id: null };
  },
};

interface OutboxGlobal {
  __sstEmailOutbox?: TransactionalEmail[];
}
const g = globalThis as OutboxGlobal;
const outbox = (g.__sstEmailOutbox ??= []);

/** Tests: messages "sent" with the memory transport (most recent last). */
export function getEmailOutbox(): readonly TransactionalEmail[] {
  return outbox;
}
export function clearEmailOutbox(): void {
  outbox.length = 0;
}

const memoryTransport: EmailTransport = {
  name: "memory",
  async send(message) {
    outbox.push(message);
    return { id: `mem_${outbox.length}` };
  },
};

let overrideTransport: EmailTransport | null = null;
/** Tests: inject a transport (e.g. one that fails). null restores the env-selected one. */
export function setEmailTransport(next: EmailTransport | null): void {
  overrideTransport = next;
}

function transport(): EmailTransport {
  if (overrideTransport) return overrideTransport;
  const provider = getEnv().EMAIL_PROVIDER;
  return provider === "resend"
    ? resendTransport
    : provider === "log"
      ? logTransport
      : memoryTransport;
}

/* ───────── sending ───────── */

/**
 * Send now (awaitable). Retries once on transient failures with the same idempotency key, so a
 * retry can't produce a duplicate. Throws EmailSendError (category only) on final failure.
 */
export async function sendTransactionalEmail(
  message: TransactionalEmail,
): Promise<{ id: string | null }> {
  const t = transport();
  // Stable per message content: the provider de-duplicates retries of the same email.
  const idempotencyKey = `sst-${message.kind}-${createHash("sha256")
    .update(`${message.to}\n${message.subject}\n${message.text}`)
    .digest("hex")
    .slice(0, 40)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await t.send(message, { idempotencyKey });
      logger.info("email.sent", {
        kind: message.kind,
        userId: message.userId,
        transport: t.name,
        providerMessageId: result.id,
      });
      return result;
    } catch (e) {
      const err = e instanceof EmailSendError ? e : new EmailSendError("unknown", false);
      const retry = err.retryable && attempt < 2;
      logger[retry ? "warn" : "error"]("email.failed", {
        kind: message.kind,
        userId: message.userId,
        transport: t.name,
        category: err.category,
        attempt,
        willRetry: retry,
      });
      if (!retry) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/* Non-blocking delivery for auth flows: the HTTP response never waits for (or reveals the
 * outcome of) the provider call, which keeps response timing independent of whether an account
 * exists. Render runs a persistent Node process, so the promise keeps running after the response;
 * it is tracked (not fire-and-forget) for tests and graceful shutdown, retried once and logged.
 * A send that still fails is lost: the user can request a new link (rate-limited). */

const pending = new Set<Promise<void>>();

export function queueTransactionalEmail(message: TransactionalEmail): void {
  const task = sendTransactionalEmail(message)
    .then(() => undefined)
    .catch(() => undefined) // already logged with its category
    .finally(() => pending.delete(task));
  pending.add(task);
}

/** Wait for queued sends (tests, graceful shutdown). */
export async function flushEmailQueue(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
