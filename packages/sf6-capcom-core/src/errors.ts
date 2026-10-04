/** A Buckler payload did not match the expected (HAR-observed) shape. Transport-agnostic. */
export class CapcomPayloadError extends Error {
  override readonly name = "CapcomPayloadError";
  readonly code = "invalid_response" as const;
}
