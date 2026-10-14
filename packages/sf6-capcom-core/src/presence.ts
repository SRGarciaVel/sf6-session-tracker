/**
 * Buckler presence (pure). Every profile page (play.json, battlelog.json) carries the player's
 * current in-game state in `fighter_banner_info.online_status_info.online_status` (a number).
 *
 * The domain identity is the NUMERIC code. `online_status_data.online_status_name` is localized
 * HTML and is never used to decide anything.
 *
 * Mappings are evidence-backed only, verified by the project owner against the visible Buckler
 * profile state (docs/capcom-provider.md §Presence):
 *   1  Offline        2  Menu        8  Practice / Training        11  Ranked Match
 * There is no separate "ranked queue" state: Buckler goes Menu/Practice → Ranked Match while
 * matchmaking. Every other code (Battle Hub, Custom Room, Casual, Fighting Ground…) is "unknown"
 * until captured. Capcom's JS shows Battle Hub details for 4/5/6; that is NOT treated as evidence
 * of what each code means.
 */

export const BUCKLER_PRESENCES = [
  "offline",
  "menu",
  "practice",
  "ranked-match",
  "unknown",
] as const;
export type BucklerPresence = (typeof BUCKLER_PRESENCES)[number];

/** online_status → presence, only for codes verified against Buckler. */
export const OBSERVED_ONLINE_STATUS: Readonly<Record<number, Exclude<BucklerPresence, "unknown">>> =
  {
    1: "offline",
    2: "menu",
    8: "practice",
    11: "ranked-match",
  };

/** Largest code accepted from the wire (codes are small integers; anything else is noise). */
export const MAX_ONLINE_STATUS_CODE = 10_000;

/** Presence of a raw `online_status` value. Anything not proven ⇒ "unknown". Never throws. */
export function presenceFromOnlineStatus(code: unknown): BucklerPresence {
  if (typeof code !== "number" || !Number.isInteger(code)) return "unknown";
  return OBSERVED_ONLINE_STATUS[code] ?? "unknown";
}

/**
 * `online_status` of a `fighter_banner_info` object, or null when absent / malformed (a
 * non-negative integer is required). Lenient by design: presence is optional evidence and must
 * never make a profile or battlelog page fail to parse.
 */
export function onlineStatusOfBanner(banner: unknown): number | null {
  if (!banner || typeof banner !== "object" || !("online_status_info" in banner)) return null;
  const info = banner.online_status_info;
  if (!info || typeof info !== "object" || !("online_status" in info)) return null;
  const code = info.online_status;
  return typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 0 &&
    code <= MAX_ONLINE_STATUS_CODE
    ? code
    : null;
}
