import { networkAddressScope } from '../private-network-address'
import type { EndpointProfile } from './known-environment'

/**
 * How a desktop reaches a paired node right now, as the environments UI shows it.
 * Desktop nodes follow the phone link: LAN on the same network, otherwise
 * Tailscale, otherwise the relay.
 */
export type NodeLinkPath = 'lan' | 'tailscale' | 'relay' | 'ssh' | 'direct'

export interface NodeRouteCandidate {
  path: NodeLinkPath
  profile: EndpointProfile
}

/** Endpoint id for a LAN address found by mDNS rather than stored at pairing. */
export const NODE_DISCOVERED_LAN_ENDPOINT_ID = 'lan-mdns'

const PATH_RANK: Record<NodeLinkPath, number> = { lan: 0, tailscale: 1, direct: 2, ssh: 3, relay: 4 }

export function nodeLinkPathOf(profile: EndpointProfile): NodeLinkPath {
  if (profile.kind === 'relay') return 'relay'
  if (profile.kind === 'ssh-forward') return 'ssh'
  if (profile.kind === 'tailscale') return 'tailscale'
  return urlPath(profile.target)
}

function urlPath(target: string): NodeLinkPath {
  let host: string
  try {
    host = new URL(target.includes('://') ? target : `http://${target}`).hostname
  } catch {
    return 'direct'
  }
  if (/\.local$/i.test(host) || host === 'localhost') return 'lan'
  const scope = networkAddressScope(host)
  if (scope === 'tailscale') return 'tailscale'
  return scope === 'public' ? 'direct' : 'lan'
}

/**
 * The order to try a node's routes in: LAN addresses found by mDNS, the saved
 * preference, then the other stored profiles by path (LAN, Tailscale, direct),
 * relay last. An SSH forward is tried only when it is the preferred profile, so
 * a stale backup never opens a tunnel.
 */
export function orderNodeRoutes(input: {
  profiles: readonly EndpointProfile[]
  preferredEndpointId?: string
  /** Base URLs (`http://host:port`) mDNS currently reports for this node. */
  discoveredLanUrls?: readonly string[]
}): NodeRouteCandidate[] {
  // The saved preference leads unless it is the relay, which is always the fallback.
  const rank = (c: NodeRouteCandidate) =>
    c.path !== 'relay' && c.profile.endpointId === input.preferredEndpointId ? -1 : PATH_RANK[c.path]
  const discovered: NodeRouteCandidate[] = (input.discoveredLanUrls ?? []).map((url) => ({
    path: 'lan',
    profile: { endpointId: NODE_DISCOVERED_LAN_ENDPOINT_ID, kind: 'direct-wss', label: url, target: url },
  }))
  const stored = input.profiles
    .filter((p) => p.kind !== 'local')
    .filter((p) => p.kind !== 'ssh-forward' || p.endpointId === input.preferredEndpointId)
    .map((profile, index) => ({ path: nodeLinkPathOf(profile), profile, index }))
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map(({ path, profile }) => ({ path, profile }))
  const seen = new Set(discovered.map((c) => c.profile.target))
  return [...discovered, ...stored.filter((c) => c.path === 'relay' || !seen.has(c.profile.target))]
}
