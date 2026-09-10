/**
 * Desktop signs LAN file URLs with a `{lanHost}` placeholder because it does not
 * know which of its interfaces the phone reached it on. The phone fills the
 * placeholder with the host it is actually connected to before fetching.
 */
export const LAN_HOST_PLACEHOLDER = '{lanHost}'

/**
 * Replace the `{lanHost}` placeholder in a desktop-issued LAN URL with the
 * connected LAN host. IPv6 literals are bracketed so the result parses as a URL.
 * URLs without the placeholder are returned unchanged.
 *
 * @param raw URL as returned by the desktop (`http://{lanHost}:7788/files/...`).
 * @param lanHost Host (IP or hostname) the phone is connected to, if on LAN.
 * @param scope Error-message prefix, e.g. `upload` / `download`.
 */
export function substituteLanHost(raw: string, lanHost: string | undefined, scope: string): string {
  if (!raw.includes(LAN_HOST_PLACEHOLDER)) return raw
  if (!lanHost) throw new Error(`${scope}: LAN host is unavailable`)
  const host = lanHost.includes(':') && !lanHost.startsWith('[') ? `[${lanHost}]` : lanHost
  return raw.replaceAll(LAN_HOST_PLACEHOLDER, host)
}
