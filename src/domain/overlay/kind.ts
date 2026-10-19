/**
 * Overlay kinds (Phase 5.4A — foundation only). An overlay row is one PRODUCT, chosen at creation
 * and immutable afterwards; its `overlay.config` JSON says which. Same row, same public token
 * (`/overlay/<token>`), same realtime payload `{ config, live }` — only the renderer / builder
 * differ per kind.
 *
 *   session        the Session Stats overlay (every overlay created before 5.4A)
 *   rank-progress  RESERVED for Phase 5.4B (LP / MR progress). Not implemented, not creatable:
 *                  nothing renders, edits or creates it yet.
 *
 * Stored configs written before 5.4A have no `kind`: they ARE session overlays (no migration,
 * nothing rewritten on read).
 */
export const OVERLAY_KINDS = ["session", "rank-progress"] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

/** Kinds a user may create / edit today. 5.4B adds "rank-progress" here with its renderer. */
export const CREATABLE_OVERLAY_KINDS = ["session"] as const satisfies readonly OverlayKind[];
export type CreatableOverlayKind = (typeof CREATABLE_OVERLAY_KINDS)[number];

export function isCreatableOverlayKind(kind: unknown): kind is CreatableOverlayKind {
  return (CREATABLE_OVERLAY_KINDS as readonly unknown[]).includes(kind);
}

/**
 * Kind of a STORED (untrusted) config, without parsing the rest: missing ⇒ "session" (legacy),
 * a known kind ⇒ that kind, anything else (unknown string, wrong type, unusable JSON) ⇒ null.
 * Used where the authoritative stored kind matters (save, presets): never inferred from the
 * parsed config, which falls back to a Session default for unusable rows.
 */
export function storedOverlayKind(raw: unknown): OverlayKind | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (kind === undefined) return "session";
  return (OVERLAY_KINDS as readonly unknown[]).includes(kind) ? (kind as OverlayKind) : null;
}

export type OverlayKindCheck =
  { ok: true } | { ok: false; error: "unsupported_kind" | "kind_mismatch" };

/**
 * Kind is immutable: an edit (save, preset apply) is only valid when the stored overlay is of an
 * editable kind and the incoming config is of the SAME kind. Converting is never an edit — create
 * another overlay instead.
 */
export function checkOverlayKindEdit(
  stored: OverlayKind | null,
  incoming: OverlayKind | null,
): OverlayKindCheck {
  if (stored === null || !isCreatableOverlayKind(stored)) {
    return { ok: false, error: "unsupported_kind" };
  }
  return incoming === stored ? { ok: true } : { ok: false, error: "kind_mismatch" };
}
