import {
  NODE_DISCOVERED_LAN_ENDPOINT_ID,
  NODE_LAN_ENDPOINT_ID,
  orderNodeRoutes,
  type EndpointProfile,
  type NodeLinkPath,
  type NodeRouteCandidate,
} from '@superone/shared/environment'
import { createRelayNodeDialer } from '@superone/runtime/server/relay-node-link'
import { checkRelayDesktopOnline } from '@superone/relay-client/presence'
import { browseLanServices, nodeLanUrls, type LanService } from '../lan-browser'
import { NODE_LAN_SERVICE_TYPE } from '../lan-service-type'
import type { ResolvedNodeRoute } from './node-connection-manager'

/** What route selection needs to know about a node. */
export interface NodeRouteTarget {
  environmentId: string
  /** Unknown before pairing; the probe then checks the environment id only. */
  nodePublicKeyFingerprint?: string
  endpointProfiles: readonly EndpointProfile[]
  preferredEndpointId?: string
}

export interface NodeRouteResolverDeps {
  /** LAN base URLs mDNS reports for the node now. */
  discoverLan: (environmentId: string) => Promise<string[]>
  /** Unauthenticated `/health` identity probe; resolves false on any failure. */
  probe: (baseUrl: string, target: NodeRouteTarget) => Promise<boolean>
  /** Open (or reuse) the SSH forward of a profile and return its local base URL. */
  openSshForward: (target: NodeRouteTarget, profile: EndpointProfile) => Promise<string | undefined>
  /** Whether the node holds its relay room now; the phone link's `/status` presence check by default. */
  relayOnline?: (relayUrl: string, roomId: string) => Promise<boolean>
}

const RELAY_STATUS_TIMEOUT_MS = 3_000
/**
 * How long a route whose encrypted connection failed is passed over. An HTTP
 * `/health` answer is unauthenticated, so only the channel proves a route.
 */
const FAILED_ROUTE_EXCLUSION_MS = 2 * 60_000

const PATH_ORDER: NodeLinkPath[] = ['lan', 'tailscale', 'direct', 'ssh', 'relay']

/**
 * Picks the route of each dial for the connection supervisor, the way the
 * phone link does: LAN when the node is on this network, else Tailscale, else
 * the relay. Only desktop nodes (paired with a LAN hint) are looked up over
 * mDNS. A lone candidate is used as-is, as before multi-route nodes existed.
 * A route whose encrypted connection failed (`markFailed`) is passed over for
 * a while, unless nothing else is left, so the next dial moves on.
 */
export class NodeRouteResolver {
  private readonly failedUntil = new Map<string, number>()

  constructor(
    private readonly deps: NodeRouteResolverDeps,
    private readonly now: () => number = Date.now,
  ) {}

  /** The encrypted connection over `route` failed: try the next route for a while. */
  markFailed(target: Pick<NodeRouteTarget, 'environmentId'>, route: Pick<ResolvedNodeRoute, 'endpointId' | 'baseUrl'>): void {
    this.failedUntil.set(routeKey(target.environmentId, route.endpointId, route.baseUrl), this.now() + FAILED_ROUTE_EXCLUSION_MS)
  }

  private isExcluded(environmentId: string, candidate: NodeRouteCandidate): boolean {
    const key = routeKey(environmentId, candidate.profile.endpointId, candidate.profile.target)
    const until = this.failedUntil.get(key)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.failedUntil.delete(key)
    return false
  }

  async candidates(target: NodeRouteTarget): Promise<NodeRouteCandidate[]> {
    const lanCapable = target.endpointProfiles.some((p) => p.endpointId === NODE_LAN_ENDPOINT_ID)
    const discovered = lanCapable ? await this.deps.discoverLan(target.environmentId).catch(() => []) : []
    const all = orderNodeRoutes({
      profiles: target.endpointProfiles,
      preferredEndpointId: target.preferredEndpointId,
      discoveredLanUrls: discovered,
    })
    const usable = all.filter((c) => !this.isExcluded(target.environmentId, c))
    return usable.length > 0 ? usable : all
  }

  async resolve(target: NodeRouteTarget): Promise<ResolvedNodeRoute | undefined> {
    const candidates = await this.candidates(target)
    let lastError: unknown
    for (const [index, candidate] of candidates.entries()) {
      const last = index === candidates.length - 1
      try {
        const route = await this.open(candidate, target, { probe: !last })
        if (route) return route
      } catch (err) {
        lastError = err
        if (last) throw err
      }
    }
    if (lastError) throw lastError
    return undefined
  }

  /**
   * A route ahead of `current` (LAN over Tailscale over relay) whose `/health`
   * answers now. Only a candidate: the caller proves it with the encrypted
   * channel before giving up the current connection.
   */
  async betterRoute(target: NodeRouteTarget, current: { path: NodeLinkPath }): Promise<ResolvedNodeRoute | undefined> {
    const rank = PATH_ORDER.indexOf(current.path)
    for (const candidate of await this.candidates(target)) {
      if (PATH_ORDER.indexOf(candidate.path) >= rank) continue
      if (candidate.path === 'ssh' || candidate.path === 'relay') continue
      if (this.isExcluded(target.environmentId, candidate)) continue
      const route = await this.open(candidate, target, { probe: true })
      if (route) return route
    }
    return undefined
  }

  private async open(
    candidate: NodeRouteCandidate,
    target: NodeRouteTarget,
    options: { probe: boolean },
  ): Promise<ResolvedNodeRoute | undefined> {
    const { profile, path } = candidate
    if (path === 'relay') {
      const roomId = profile.relay?.roomId
      if (!roomId) return undefined
      // Ask the relay first: an absent node fails now, not after the channel handshake times out.
      const online = await (this.deps.relayOnline ?? defaultRelayOnline)(profile.target, roomId)
      if (!online) {
        throw Object.assign(new Error('the node is offline: it is not connected to the relay'), { code: 'unavailable' })
      }
      return {
        baseUrl: profile.target,
        dial: createRelayNodeDialer({ relayUrl: profile.target, roomId }),
        path,
        endpointId: profile.endpointId,
      }
    }
    if (path === 'ssh') {
      const baseUrl = await this.deps.openSshForward(target, profile)
      return baseUrl ? { baseUrl, path, endpointId: profile.endpointId } : undefined
    }
    const baseUrl = httpBase(profile.target)
    if (options.probe && !(await this.deps.probe(baseUrl, target))) return undefined
    return { baseUrl, path, endpointId: profile.endpointId }
  }
}

function defaultRelayOnline(relayUrl: string, roomId: string): Promise<boolean> {
  return checkRelayDesktopOnline({ relayUrl, roomId, timeoutMs: RELAY_STATUS_TIMEOUT_MS }).catch(() => false)
}

/** One key per stored profile; mDNS can report several LAN addresses under one id. */
function routeKey(environmentId: string, endpointId: string, baseUrl: string): string {
  const address = endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID ? `|${baseUrl.replace(/\/$/, '')}` : ''
  return `${environmentId}|${endpointId}${address}`
}

function httpBase(target: string): string {
  if (/^wss?:\/\//.test(target)) return target.replace(/^ws/, 'http')
  return target.includes('://') ? target : `http://${target}`
}

/**
 * mDNS lookup of desktop nodes: one browse shared by every caller within
 * `maxAgeMs`, so connections checking at once do not each open a socket.
 */
export function cachedNodeLanDiscovery(
  browse: () => Promise<LanService[]> = () => browseLanServices(NODE_LAN_SERVICE_TYPE),
  maxAgeMs = 5_000,
): (environmentId: string) => Promise<string[]> {
  let last: { at: number; services: Promise<LanService[]> } | null = null
  return async (environmentId) => {
    if (!last || Date.now() - last.at > maxAgeMs) last = { at: Date.now(), services: browse().catch(() => []) }
    return nodeLanUrls(await last.services, environmentId)
  }
}
