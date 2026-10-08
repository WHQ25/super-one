/**
 * Where a socket's peer address sits. Desktop servers that listen beyond
 * loopback (the node host and the phone LAN server) accept only peers on a
 * private network: loopback, RFC 1918, link-local, IPv6 unique-local, and the
 * Tailscale ranges. A peer from anywhere else is refused before any auth work.
 */
export type NetworkAddressScope = 'loopback' | 'private' | 'link-local' | 'tailscale' | 'public'

/**
 * Classify a literal IPv4 or IPv6 address (brackets, a zone id and the
 * IPv4-mapped IPv6 form are accepted). Anything unparseable is `public`, so
 * callers that gate on scope fail closed.
 */
export function networkAddressScope(address: string | undefined | null): NetworkAddressScope {
  if (!address) return 'public'
  const literal = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const v4 = parseIpv4(literal)
  if (v4) return ipv4Scope(v4)
  const v6 = parseIpv6(literal)
  return v6 ? ipv6Scope(v6) : 'public'
}

export function isPrivateNetworkAddress(address: string | undefined | null): boolean {
  return networkAddressScope(address) !== 'public'
}

function ipv4Scope([a, b]: number[]): NetworkAddressScope {
  if (a === 127) return 'loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  if (a === 169 && b === 254) return 'link-local'
  // 100.64.0.0/10, the shared address space Tailscale assigns from.
  if (a === 100 && b >= 64 && b <= 127) return 'tailscale'
  return 'public'
}

function ipv6Scope(g: number[]): NetworkAddressScope {
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return ipv4Scope([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff])
  }
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return 'loopback'
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local'
  // fd7a:115c:a1e0::/48 sits inside fc00::/7, so it is checked first.
  if (g[0] === 0xfd7a && g[1] === 0x115c && g[2] === 0xa1e0) return 'tailscale'
  if ((g[0] & 0xfe00) === 0xfc00) return 'private'
  return 'public'
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    octets.push(n)
  }
  return octets
}

/** Eight 16-bit groups, or null. Handles `::` and a dotted IPv4 tail. */
function parseIpv6(text: string): number[] | null {
  if (!text.includes(':')) return null
  let head = text
  const tail: number[] = []
  const lastColon = text.lastIndexOf(':')
  if (text.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (!v4) return null
    tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3])
    head = text.slice(0, lastColon + 1)
    if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1)
  }
  const halves = head.split('::')
  if (halves.length > 2) return null
  const parse = (s: string): number[] | null => {
    if (!s) return []
    const groups: number[] = []
    for (const part of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null
      groups.push(parseInt(part, 16))
    }
    return groups
  }
  const left = parse(halves[0])
  const right = halves.length === 2 ? parse(halves[1]) : []
  if (!left || !right) return null
  const known = left.length + right.length + tail.length
  if (halves.length === 1) return known === 8 ? [...left, ...tail] : null
  if (known > 7) return null
  return [...left, ...new Array<number>(8 - known).fill(0), ...right, ...tail]
}
