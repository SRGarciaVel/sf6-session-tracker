/** Pairing-code countdown, from the server's real expiry (never invented). */
/** Same TTL as the server (PAIRING_CODE_TTL_MS); caps the display against clock skew. */
export const PAIRING_CODE_TTL_MINUTES = 10;

export type PairingCodeStatus =
  { state: "active"; minutesLeft: number } | { state: "expiring" } | { state: "expired" };

export function pairingCodeStatus(expiresAtIso: string, now: number): PairingCodeStatus {
  const left = Date.parse(expiresAtIso) - now;
  if (left <= 0) return { state: "expired" };
  if (left < 60_000) return { state: "expiring" };
  // A client clock slightly behind the server's must not show "11 minutes".
  return {
    state: "active",
    minutesLeft: Math.min(PAIRING_CODE_TTL_MINUTES, Math.ceil(left / 60_000)),
  };
}
