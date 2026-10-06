/**
 * The ONE way SST reads an authenticated session (Phase 4.6, docs/auth.md).
 *
 * Better Auth never creates a session for an unverified account (requireEmailVerification), but
 * accounts created before this phase may still hold sessions issued earlier. Those are ignored
 * here: an unverified email never grants SST access, whatever cookie the browser holds. Pages,
 * server actions (via getCurrentUser) and API routes all go through this function, so no feature
 * needs its own `emailVerified` check.
 */
import { getAuth } from "./auth";

export async function getVerifiedSession(requestHeaders: Headers) {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user.emailVerified) return null;
  return session;
}
