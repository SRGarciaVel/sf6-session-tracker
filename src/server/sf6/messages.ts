import { SF6ProviderError } from "./provider";

/** User-facing message for provider failures (never leaks internals). */
export function providerErrorMessage(err: unknown): string {
  if (err instanceof SF6ProviderError) {
    switch (err.code) {
      case "not_found":
        return "No Street Fighter 6 player found with that CFN User ID.";
      case "rate_limited":
        return "Capcom is rate-limiting requests right now. Try again in a minute.";
      case "timeout":
        return "Capcom took too long to answer. Try again in a moment.";
      case "unavailable":
        return "Capcom / CFN is unavailable right now. Try again in a moment.";
      case "invalid_response":
        return "CFN returned unexpected data. Try again later.";
    }
  }
  return "Something went wrong while contacting CFN.";
}
