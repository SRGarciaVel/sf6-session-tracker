# Authentication and account trust

Phase 4.6 makes email ownership part of the trust model. Before this phase, an email address was
trusted just because someone typed it at sign-up. Now it is trusted only after its owner opens a
link sent to it, and lost passwords can be recovered by email. Auth method: email + password
([Better Auth](https://better-auth.com) **1.7.7**, sessions in Postgres). No 2FA, OAuth or CAPTCHA
yet (see [Out of scope](#out-of-scope)).

## Before vs after

|                                          | Before (≤ Phase 4.5)                                                | After (Phase 4.6)                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Sign-up                                  | account created **and signed in** (`autoSignIn: true`) → onboarding | account created **unverified**, no session, verification email → "check your email" |
| Duplicate sign-up                        | "An account with this email already exists" (SEC-008)               | same generic success as a new sign-up (Better Auth synthetic user)                  |
| Sign-in, unverified                      | n/a                                                                 | refused: `403 EMAIL_NOT_VERIFIED` (only after a correct password) + "Resend email"  |
| Forgot password                          | none                                                                | request → generic message → email → new password → every session revoked            |
| Existing sessions of unverified accounts | valid                                                               | ignored everywhere (`getVerifiedSession`)                                           |

## Configuration (src/server/auth/auth.ts)

```ts
emailAndPassword: {
  enabled: true,
  minPasswordLength: 8, maxPasswordLength: 128,   // unchanged; no composition rules
  requireEmailVerification: true,                 // no session for an unverified account
  autoSignIn: false,
  sendResetPassword,                              // queues the email (see below)
  resetPasswordTokenExpiresIn: 3600,              // 60 min
  revokeSessionsOnPasswordReset: true,
  onPasswordReset,                                // marks the address verified + audit log
  customSyntheticUser,                            // duplicate sign-up mirrors our extra fields
},
emailVerification: {
  sendVerificationEmail, sendOnSignUp: true,
  sendOnSignIn: false,                            // resending is explicit and rate-limited
  autoSignInAfterVerification: false,             // the link verifies; it never signs in
  expiresIn: 3600,                                // 60 min
},
verification: { storeIdentifier: "hashed" },      // reset tokens stored as SHA-256
hooks: { before },                                // callback allowlist + per-email limits
rateLimit: { customRules: AUTH_RATE_LIMITS, storage: "database" in production },
logger: { level: "warn", log: betterAuthLog },    // redacting adapter
```

Everything uses Better Auth's own endpoints, tokens and tables. There is no custom token storage
and no schema change.

## Registration and verification

```
/signup ──POST /api/auth/sign-up/email (callbackURL=/verify-email/result)
   │      user row: email_verified=false · no session cookie · verification email queued
   ▼
/verify-email   "Check your email", address masked (st***@example.com, from this tab's
   │            sessionStorage — never the URL) · Resend with a 60 s cooldown
   ▼ (user opens the link from the inbox)
GET /api/auth/verify-email?token=<signed JWT, 60 min>&callbackURL=/verify-email/result
   │      email_verified=true · NO session · 302 → /verify-email/result
   ▼
/verify-email/result  "Email verified" → /login → /dashboard → (no CFN yet) /onboarding
```

- **Chosen behaviour: B, verification then sign-in.** `autoSignInAfterVerification: false`, so the
  link alone never creates a session. Anyone holding a forwarded, leaked or mail-scanner-fetched
  link can verify the address but can't enter the account. After signing in, a new account goes
  dashboard → onboarding (no CFN yet), so there's no redirect loop.
- **Tokens:** Better Auth signs verification tokens as HS256 JWTs with `BETTER_AUTH_SECRET`
  (email + expiry). They're never stored. Reopening a used link on a verified account just shows
  the success page again: it's idempotent and creates no session.
- **Failures** land on `/verify-email/result?error=…`:
  - `TOKEN_EXPIRED` → "This link has expired";
  - `INVALID_TOKEN`, `USER_NOT_FOUND` or anything else → "This link isn't valid".

  Both offer a resend form. A request with no token gets a 400 and verifies nothing. Better Auth
  messages are never shown.

- **Unverified sign-in:** with the right password, the reply is `403 EMAIL_NOT_VERIFIED`. The UI
  shows "Tu correo aún no está verificado. Revisa tu bandeja de entrada o solicita un nuevo
  enlace." with a **Reenviar correo** button. A wrong password stays the generic 401, so the
  verification state is only revealed to someone who knows the password.

## Resending

`POST /api/auth/send-verification-email` (Better Auth). Unauthenticated, the response is always
`{ status: true }`, and Better Auth pads it to at least 500 ms:

- for a pending account, a new link is queued;
- for a verified or unknown address, nothing is sent.

The UI says: "If there's an account waiting for verification at that address, a new link is on
its way."

The UI applies a 60 s cooldown, and the server enforces its own limits (below).

## Password reset

```
/login → "¿Olvidaste tu contraseña?" → /forgot-password
POST /api/auth/request-password-reset (redirectTo=/reset-password)
   → always: "If an account exists for that email, we'll send password reset instructions."
   → existing account: random 24-char token, row in auth_verification (identifier stored
     HASHED), 60 min, email queued
GET  /api/auth/reset-password/<token>?callbackURL=/reset-password
   → valid: 302 /reset-password?token=…   expired/unknown: 302 /reset-password?error=INVALID_TOKEN
/reset-password  token kept in memory and removed from the address bar; Referrer-Policy
   no-referrer · new password + confirmation (8–128)
POST /api/auth/reset-password { newPassword, token }
   → token consumed atomically (single use) · password updated · ALL sessions deleted
   → address marked verified (the link reached the inbox) · "Log in with your new password"
```

**Session revocation:** `revokeSessionsOnPasswordReset` deletes every `auth_session` row of the
user. Every signed-in device, including any attacker session, is signed out, and old cookies stop
working (integration-tested). There's no in-app "change password while signed in" UI. Better
Auth's `/change-password` endpoint needs the current password and is rate-limited by the
default 3/10 s rule.

## Account enumeration

| Flow                | What an outsider sees for an existing vs unknown address                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sign-up             | same 200, same JSON shape (Better Auth synthetic user; `customSyntheticUser` adds our `locale` field) · no session in either case · the password is hashed in both paths |
| Forgot password     | byte-identical response (tested); the email is queued, never awaited                                                                                                     |
| Resend verification | identical `{status:true}`, ≥ 500 ms floor; mail only for pending accounts                                                                                                |
| Sign-in             | generic 401 for wrong email **or** password; `EMAIL_NOT_VERIFIED` only with the right password                                                                           |
| Rate limits         | per-IP and per-email limits apply to every address alike                                                                                                                 |

**Timing.** Email delivery never runs inside the auth response. The callbacks render the
template and hand it to `queueTransactionalEmail()`, then return immediately. That removes the
biggest timing difference (a provider round-trip of ~100–500 ms only for real accounts). Some
residual difference remains: DB writes for a real sign-up or reset row versus Better Auth's dummy
work. These differences are small and noisy, and the rate limits bound them. We don't claim
perfect timing indistinguishability.

**Why not `void sendEmail()`?** SST runs on Render as a **persistent Node process** (not
serverless), so a promise keeps running after the response. `advanced.backgroundTasks` is meant
for `waitUntil` on serverless and isn't needed here. The queue:

- tracks every send;
- times out after 10 s;
- retries transient failures once with the **same Resend idempotency key**, so a retry can't
  duplicate a send;
- logs the outcome by category;
- exposes `flushEmailQueue()` for tests.

**Trade-off:** a send still in flight when the process stops (deploy or restart) is lost. The
user requests a new link; that's rate-limited but always available.

## Rate limits

Better Auth limiter, keyed by client IP + path. It's stored in Postgres in production
(`auth_rate_limit`, `RATE_LIMIT_STORE=postgres`) and the IP comes from `CLIENT_IP_HEADER` behind
the proxy:

| Path                       | Limit                                                |
| -------------------------- | ---------------------------------------------------- |
| `/sign-up/email`           | 5 / 15 min / IP                                      |
| `/sign-in/email`           | 10 / 5 min / IP (was the default 3 / 10 s ≈ 1 080/h) |
| `/send-verification-email` | 10 / hour / IP                                       |
| `/request-password-reset`  | 5 / 15 min / IP                                      |
| `/reset-password`          | 10 / 15 min / IP                                     |
| `/verify-email`            | 20 / 15 min / IP                                     |
| everything else            | 30 / min / IP (global)                               |

**Per email** (SST limiter, `rate_limit_bucket`, fail-closed). Before any mail is triggered:
`/send-verification-email` and `/request-password-reset` allow **3 / 15 min per address**.
The key is `HMAC-SHA-256(key derived from BETTER_AUTH_SECRET, lowercase(trim(email)))`
truncated to 32 characters: no raw address is ever stored, and nobody can recompute it without
the secret. A limited request gets 429, whether or not the account exists.

So one address receives at most 3 verification + 3 reset emails per 15 minutes, whatever the
number of IPs. One IP can trigger at most 10 verification emails per hour (to different
addresses) and 5 resets per 15 minutes. **CAPTCHA isn't needed for the closed beta.** Revisit if
the logs show distributed sign-up abuse (many IPs, `auth.framework`/`email.sent` volume).

Provider quotas: when Resend returns `daily_quota_exceeded`, `monthly_quota_exceeded` or
`rate_limit_exceeded`, the send fails, is logged as `quota`/`rate_limited`, and the user sees
nothing different. They can resend later.

## Redirects

Emailed links point to `${APP_URL}/api/auth/...` and come back only to SST pages:

- the before-hook accepts **exactly** `callbackURL=/verify-email/result` (sign-up, resend) and
  `redirectTo=/reset-password` (reset request), or nothing;
- absolute URLs (even APP_URL), `//host`, `javascript:` and any other path get a 400 (tested);
- Better Auth's origin check (`trustedOrigins: [APP_URL]`) still applies on top;
- links are built by Better Auth from `APP_URL` (`baseURL`). SST never builds a token URL itself.

## Where access is enforced

`getVerifiedSession()` (src/server/auth/verified-session.ts) is the **only** way SST reads a
session. A static test forbids `api.getSession(` anywhere else. It returns `null` for an
unverified account, so:

- `getCurrentUser`, `requireUser` and `requirePlayer` all see no user, which covers every page and
  server action: onboarding, CFN linking, dashboard, session tracking, overlays, presets and
  Creator Key redemption;
- `/api/me/stream` and `/api/session/heartbeat` return 401.

For new accounts the primary guarantee is simpler: **no session exists before verification**.
The gate exists for sessions issued before this phase (rollout below). No feature has its own
`emailVerified` check.

The companion extension authenticates with **device tokens**, not sessions. A device paired by a
legacy account keeps syncing data, but that data stays invisible until the account is verified.

## Transactional email (src/server/email)

- `sender.ts` is the only provider seam (a static test checks that only it imports `resend`).
  `sendTransactionalEmail()` is awaitable; `queueTransactionalEmail()` is non-blocking. Transports
  are selected by `EMAIL_PROVIDER`:

  | Transport | Use                                   | Behaviour                                                                                               |
  | --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | `resend`  | production (required)                 | official SDK, created lazily (`next build` and tests never need the key), 10 s timeout, idempotency key |
  | `log`     | development                           | prints the email, link included, to the server console; refused in production                           |
  | `memory`  | tests (default under `NODE_ENV=test`) | in-process outbox, no network (tested)                                                                  |

- `templates.ts` holds the "Verify your email" and "Reset your password" emails:
  - HTML (inline styles, table layout, `color-scheme: light dark`) plus plain text;
  - copy in `src/i18n/messages/email.{es,en}.json`;
  - content: SST name, purpose, CTA, raw fallback link, expiry, "ignore this" copy.

  There are no images, tracking pixels, remote fonts or marketing, and no account data (not even
  the display name). The only dynamic value is the Better Auth link, which is HTML-escaped. The
  language follows the account preference, then the `NEXT_LOCALE` cookie of the requesting
  browser, then Spanish.

- **Failures** (timeout, provider error or outage, rejected sender, bad config): the user's
  response is unchanged, nothing is marked verified, and provider details are never shown.
  Transient failures are retried once. Logs keep the category only (`config`, `rejected`,
  `rate_limited`, `quota`, `timeout`, `provider_unavailable`).

## Logging and privacy

- **Logged:** `email.sent` / `email.failed` with `{kind, userId, transport, providerMessageId |
category, attempt}`, plus `auth.email_verified`, `auth.password_reset` and `auth.framework`.
- **Never logged:** addresses, subjects, bodies, links, tokens, passwords or the API key.
- Better Auth's own logs go through `betterAuthLog`, at warn level and above. Free text is
  redacted: emails become `[email]`, URLs `[url]`, `token=` values `[redacted]`. This matters
  because Better Auth logs "Sign-up attempt for existing email: <address>". A test captures all
  console output across every flow and asserts none of these appear.
- The only exception is the `log` transport, which prints the link **in development only**.
  Production refuses that transport.

## Environment

| Variable         | Required      | Notes                                                                                                                                |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `EMAIL_PROVIDER` | no            | `resend` \| `log` \| `memory`. Default: production `resend`, development `log`, test `memory`. **Production accepts only `resend`.** |
| `RESEND_API_KEY` | with `resend` | server-only; must look like `re_…`; placeholders refused                                                                             |
| `EMAIL_FROM`     | with `resend` | `SST <no-reply@your-verified-domain>` or a bare address; `example.*`, `localhost` and `YOUR_…` domains refused in production         |
| `EMAIL_REPLY_TO` | no            | a monitored support inbox, if you have one                                                                                           |

Production fails at boot if any of these is missing or invalid. None of them is exposed to the
client (no `NEXT_PUBLIC_`).

**Development:** leave them unset and the link appears in the `pnpm dev` console. To test real
delivery locally, set `EMAIL_PROVIDER=resend` with a test key and `EMAIL_FROM=onboarding@resend.dev`.
Resend's shared test sender only delivers to the address of the Resend account owner.

## Production setup (operator)

Don't paste API keys into chats or tickets. Set them only in the Render dashboard.

1. **Resend:** create the account and add a domain you control, preferably a subdomain such as
   `mail.<your-domain>`.
2. **DNS** (at your DNS provider), using the records Resend shows:
   - **DKIM** (`resend._domainkey` TXT), required;
   - **SPF** for the Return-Path/bounce subdomain (MX + TXT `v=spf1 include:amazonses.com ~all`
     as shown by Resend);
   - **DMARC** (recommended), starting with `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<you>`,
     then tightening.

   Wait until Resend shows the domain as **Verified**. **Delivery isn't production-ready before
   that.**

3. **API key:** create one with _Sending access_ only, restricted to that domain.
4. **Render env** (web service):
   - `RESEND_API_KEY=<key>`;
   - `EMAIL_FROM=SST <no-reply@mail.<your-domain>>`;
   - optionally `EMAIL_REPLY_TO`;
   - check that `APP_URL` is the exact public https origin (it builds every link).
5. **Database:** no migration. Run the rollout queries below with the admin connection.
6. **Deploy.** The app refuses to boot if step 4 is incomplete; that's intended.
7. **Verify with a real inbox:**
   - sign up → email arrives (check spam and the SPF/DKIM "pass" in the headers);
   - log in before verifying → "Tu correo aún no está verificado";
   - resend → new email, then the cooldown;
   - open the link → "Correo verificado" → log in → onboarding.
8. **Reset:**
   - /forgot-password → email → new password;
   - the old password fails;
   - another browser that was signed in is signed out.
9. **Existing accounts:** see the next section.

## Existing accounts (rollout)

**Don't** run `UPDATE auth_user SET email_verified = true`. Nobody has proven those addresses.

Chosen strategy: **A, verify on next sign-in**, plus **D, operator handling of internal
accounts**. It's the simplest secure option for a small closed beta, with no grandfather window
and no bulk email.

1. **Inventory** (admin connection; counts only):
   ```sql
   select email_verified, count(*) from auth_user group by 1;
   ```
2. **Internal / QA accounts** (see [QA account policy](#qa--demo-account-policy)) must use real
   operator-controlled inboxes before deploying.
3. **Deploy.** From then on, an unverified account:
   - loses access immediately, whatever session it holds (`getVerifiedSession`);
   - at sign-in, gets "Tu correo aún no está verificado" plus **Reenviar correo**, verifies, and
     continues with all its data (overlays, sessions, presets, Creator access) untouched;
   - can also recover through **forgot password**: completing a reset verifies the address.
4. **Optional cleanup** (admin; removes now-useless rows; users just sign in again):
   ```sql
   delete from auth_session where user_id in (select id from auth_user where not email_verified);
   ```
5. **Tell beta users** (Discord or wherever the beta lives): "Next time you log in, confirm your
   email with the link we send you."

**Recovery path for the owner / a locked-out tester.** Use resend or forgot password. Both only
need inbox access. If the inbox is gone, verify ownership out of band, then as admin either
change `auth_user.email` to an address the person controls and let them verify it, or, last
resort and audited:

```sql
update auth_user set email_verified = true, updated_at = now() where id = '<user id>';
```

Run that manually with the admin connection, once per account and on purpose. There is **no**
code path, env flag or allowlist that skips verification.

## QA / demo account policy

The internal QA/demo account must use a **real operator-controlled alias** (e.g.
`sst-qa+demo@<operator domain>` or a plus-address of the operator's mailbox), verified through
the normal flow. Before deploying, run this with the admin connection:

```sql
update auth_user set email = '<real alias>', updated_at = now() where email = '<old fake email>';
```

Then sign in, get the verification email at the alias and verify. Production has **no
skip-verification backdoor**. Local development and tests use the `log`/`memory` transports
(the link is in the console or in the test outbox), which production refuses.

## Troubleshooting

| Symptom                              | Check                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App doesn't boot after deploy        | Render logs: `Invalid environment configuration … RESEND_API_KEY / EMAIL_FROM / EMAIL_PROVIDER`                                                                                                                     |
| No email arrives                     | logs `email.failed` + category: `config` → key or sender domain not verified; `quota`/`rate_limited` → Resend plan; nothing logged → the address had no pending account (expected) or hit the per-email limit (429) |
| Email in spam                        | SPF/DKIM pass in the headers; DMARC alignment; sending from a fresh domain needs warm-up                                                                                                                            |
| Link opens localhost or a wrong host | `APP_URL`                                                                                                                                                                                                           |
| "This link has expired"              | older than 60 min → resend                                                                                                                                                                                          |
| User keeps landing on /login         | the account is unverified: resend or forgot password                                                                                                                                                                |

## Rollback

Revert the code. No schema changes, so nothing to migrate back.

- **Accounts created unverified during 4.6** keep `email_verified=false`. The old code ignores the
  flag, so they work again (no deletion needed).
- **Verified flags** stay `true`, which is harmless.
- **Outstanding verification JWTs** are never stored; the old code has no endpoint consuming them
  (a link just fails).
- **Reset rows** in `auth_verification` (hashed identifiers) expire within 60 min and are cleaned
  lazily. Optional: `delete from auth_verification where identifier not like '%:%';`
- **Env vars** can stay (ignored) or be removed.
- After rollback, duplicate sign-ups again reveal existing accounts (SEC-008) and there is no
  password reset.

## Out of scope

- **2FA** (TOTP, SMS, WebAuthn/passkeys, backup codes), **OAuth** (Google, GitHub, Discord) and
  **CAPTCHA** were not added.
- **Email change:** no SST feature changes the account email, and Better Auth's
  `/change-email` is disabled (`user.changeEmail` not enabled). That's Phase 4.7, where the new
  address must be verified before it becomes authoritative.
- **Account deletion / data export** (SEC-015) remain pending.
