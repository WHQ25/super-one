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
  /**
   * After the relay is known to be up, how long to keep waiting for a direct
   * route (LAN, Tailscale, public). Default {@link LAN_RELAY_GRACE_MS}.
   */
  lanRelayGraceMs?: number
}

const RELAY_STATUS_TIMEOUT_MS = 3_000
/**
 * How long a route whose encrypted connection failed is passed over. An HTTP
 * `/health` answer is unauthenticated, so only the channel proves a route.
 */
const FAILED_ROUTE_EXCLUSION_MS = 2 * 60_000
/**
 * Happy-eyeballs window: once the relay answers, wait this long for a better
 * direct route before taking it. A LAN that answers inside the window wins.
 */
const LAN_RELAY_GRACE_MS = 250

const PATH_ORDER: NodeLinkPath[] = ['lan', 'tailscale', 'direct', 'ssh', 'relay']

/**
 * Picks the route of each dial for the connection supervisor, the way the
 * phone link does: LAN when the node is on this network, else Tailscale, else
 * the relay. Only desktop nodes (paired with a LAN hint) are looked up over
 * mDNS. A lone candidate is used as-is, as before multi-route nodes existed.
 * Several candidates are raced: direct probes and relay presence run together,
 * and a LAN answer inside a short grace beats the relay. mDNS is not awaited
 * before that race. A route whose encrypted connection failed (`markFailed`)
 * is passed over for a while, unless nothing else is left, so the next dial
 * moves on.
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
    return this.ordered(target, discovered)
  }

  async resolve(target: NodeRouteTarget): Promise<ResolvedNodeRoute | undefined> {
    const lanCapable = target.endpointProfiles.some((p) => p.endpointId === NODE_LAN_ENDPOINT_ID)
    const initial = this.ordered(target, [])
    // A lone stored route (and a node with no LAN advertisement to wait for)
    // is used as-is, without a probe and without opening a browse.
    if (!lanCapable && initial.length <= 1) {
      const only = initial[0]
      return only ? this.open(only, target, { probe: false }) : undefined
    }
    const discover = lanCapable
      ? this.deps.discoverLan(target.environmentId).catch(() => [] as string[])
      : Promise.resolve([] as string[])
    return this.race(target, initial, discover)
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

  /** Stored order, with failed routes passed over unless that would leave none. */
  private ordered(target: NodeRouteTarget, discovered: readonly string[]): NodeRouteCandidate[] {
    const all = orderNodeRoutes({
      profiles: target.endpointProfiles,
      preferredEndpointId: target.preferredEndpointId,
      discoveredLanUrls: discovered,
    })
    const usable = all.filter((c) => !this.isExcluded(target.environmentId, c))
    return usable.length > 0 ? usable : all
  }

  /**
   * Direct probes and relay presence together. A discovered LAN address wins
   * as soon as it answers. The relay is taken when it is up and nothing better
   * answers within the grace — including an mDNS browse that has not finished.
   * A preferred SSH forward is opened first: that profile is only ordered when
   * the user chose it, and an available relay must not skip it. A probe
   * abandoned because another route won is not marked failed.
   */
  private async race(
    target: NodeRouteTarget,
    initial: readonly NodeRouteCandidate[],
    discover: Promise<readonly string[]>,
  ): Promise<ResolvedNodeRoute | undefined> {
    const graceMs = this.deps.lanRelayGraceMs ?? LAN_RELAY_GRACE_MS
    type ProbeEvent = { kind: 'probe'; candidate: NodeRouteCandidate; route?: ResolvedNodeRoute; error?: unknown }
    type Event =
      | { kind: 'discover'; urls: readonly string[] }
      | ProbeEvent
      | { kind: 'relay'; route?: ResolvedNodeRoute; error?: unknown }
      | { kind: 'grace' }

    const queue: Event[] = []
    let wake: (() => void) | null = null
    let settled = false
    const push = (event: Event): void => {
      if (settled) return
      queue.push(event)
      const resolve = wake
      wake = null
      resolve?.()
    }
    const next = (): Promise<Event> => {
      const queued = queue.shift()
      if (queued) return Promise.resolve(queued)
      return new Promise((resolve) => {
        wake = () => resolve(queue.shift()!)
      })
    }

    const pending = new Set<NodeRouteCandidate>()
    const started = new Set<string>()
    const successes: ResolvedNodeRoute[] = []
    let discoverPending = true
    let relayCandidate: NodeRouteCandidate | undefined
    let relaySettled = false
    let relayRoute: ResolvedNodeRoute | undefined
    let relayError: unknown
    let graceTimer: ReturnType<typeof setTimeout> | null = null
    let graceArmed = false

    const rank = (path: NodeLinkPath) => PATH_ORDER.indexOf(path)
    const prefers = (route: ResolvedNodeRoute, win: ResolvedNodeRoute): boolean => {
      if (rank(route.path) !== rank(win.path)) return rank(route.path) < rank(win.path)
      // Same path: an address the node is advertising now beats the one saved at pairing.
      return route.endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID && win.endpointId !== NODE_DISCOVERED_LAN_ENDPOINT_ID
    }
    const best = (): ResolvedNodeRoute | undefined =>
      successes.reduce<ResolvedNodeRoute | undefined>((win, route) => (!win || prefers(route, win) ? route : win), undefined)
    const discoveredPending = (): boolean =>
      [...pending].some((c) => c.profile.endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID)
    const betterPending = (path: NodeLinkPath): boolean => {
      const ceiling = rank(path)
      if ([...pending].some((c) => rank(c.path) < ceiling)) return true
      // A browse still running can still surface a LAN address.
      return discoverPending && ceiling > 0
    }

    // orderNodeRoutes includes an SSH forward only when it is the preferred
    // profile. Open that tunnel before the race so relay presence cannot win
    // first and skip it. A forward that does not open falls through.
    const preferredSsh = initial.find((candidate) => candidate.path === 'ssh')
    if (preferredSsh) {
      const opened = await this.open(preferredSsh, target, { probe: false })
      if (opened) return opened
    }

    const start = (candidate: NodeRouteCandidate): void => {
      const id = `${candidate.profile.endpointId}|${candidate.profile.target}`
      if (started.has(id)) return
      started.add(id)
      if (candidate.path === 'ssh') return
      if (candidate.path === 'relay') {
        relayCandidate = candidate
        void this.open(candidate, target, { probe: false }).then(
          (route) => push({ kind: 'relay', route }),
          (error: unknown) => push({ kind: 'relay', error }),
        )
        return
      }
      pending.add(candidate)
      void this.open(candidate, target, { probe: true }).then(
        (route) => push({ kind: 'probe', candidate, route }),
        (error: unknown) => push({ kind: 'probe', candidate, error }),
      )
    }

    // Direct probes are started before relay presence so an instant LAN answer
    // is queued ahead of an instant relay answer.
    for (const candidate of initial) if (candidate.path !== 'relay') start(candidate)
    for (const candidate of initial) if (candidate.path === 'relay') start(candidate)
    void discover.then(
      (urls) => push({ kind: 'discover', urls }),
      () => push({ kind: 'discover', urls: [] }),
    )

    const armGrace = (): void => {
      if (graceArmed || settled) return
      graceArmed = true
      graceTimer = setTimeout(() => push({ kind: 'grace' }), graceMs)
      graceTimer.unref?.()
    }
    const finish = (route: ResolvedNodeRoute | undefined): ResolvedNodeRoute | undefined => {
      settled = true
      if (graceTimer) clearTimeout(graceTimer)
      return route
    }
    /** Take `route` now when nothing better can still arrive. */
    const take = (route: ResolvedNodeRoute | undefined): ResolvedNodeRoute | undefined => {
      if (!route) return undefined
      if (route.endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID) return finish(route)
      if (discoveredPending()) return undefined
      if (route.path === 'lan' && discoverPending) return undefined
      if (betterPending(route.path)) return undefined
      return finish(route)
    }

    while (pending.size > 0 || (!relaySettled && relayCandidate) || discoverPending || graceArmed) {
      const event = await next()
      if (event.kind === 'discover') {
        discoverPending = false
        for (const candidate of this.ordered(target, event.urls)) {
          if (candidate.profile.endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID) start(candidate)
        }
        const won = take(best()) ?? (relayRoute && !betterPending('relay') ? finish(relayRoute) : undefined)
        if (won) return won
        continue
      }
      if (event.kind === 'probe') {
        pending.delete(event.candidate)
        if (event.route) successes.push(event.route)
        if (event.route?.endpointId === NODE_DISCOVERED_LAN_ENDPOINT_ID) return finish(event.route)
        const won = take(best()) ?? (pending.size === 0 && !discoverPending && relayRoute && !betterPending('relay') ? finish(relayRoute) : undefined)
        if (won) return won
        continue
      }
      if (event.kind === 'relay') {
        relaySettled = true
        if (event.route) relayRoute = event.route
        else relayError = event.error
        const won = take(best())
        if (won) return won
        if (relayRoute && betterPending('relay')) armGrace()
        else if (relayRoute) return finish(relayRoute)
        continue
      }
      graceArmed = false
      const held = best()
      if (held) return finish(held)
      if (relayRoute) return finish(relayRoute)
    }

    const held = best()
    if (held) return finish(held)
    if (relayRoute) return finish(relayRoute)
    // No relay: the last direct address is still tried, the way a sequential
    // dial used its final candidate without a probe.
    if (!relayCandidate) {
      const directs = initial.filter((c) => c.path !== 'ssh' && c.path !== 'relay')
      const last = directs[directs.length - 1]
      if (last && successes.length === 0) return this.open(last, target, { probe: false })
    }
    if (relayError) throw relayError
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
  browse: (onUpdate?: (services: LanService[]) => void) => Promise<LanService[]> = (onUpdate) =>
    browseLanServices(NODE_LAN_SERVICE_TYPE, undefined, onUpdate),
  maxAgeMs = 5_000,
): (environmentId: string) => Promise<string[]> {
  let last: {
    at: number
    current: LanService[]
    done: boolean
    services: Promise<LanService[]>
    waiters: Map<string, Array<(urls: string[]) => void>>
  } | null = null

  const deliver = (slot: NonNullable<typeof last>): void => {
    for (const [environmentId, waiters] of slot.waiters) {
      const urls = nodeLanUrls(slot.current, environmentId)
      if (!urls.length && !slot.done) continue
      slot.waiters.delete(environmentId)
      for (const waiter of waiters) waiter(urls)
    }
  }

  return (environmentId) => {
    if (!last || Date.now() - last.at > maxAgeMs) {
      const slot = {
        at: Date.now(),
        current: [] as LanService[],
        done: false,
        services: Promise.resolve([] as LanService[]),
        waiters: new Map<string, Array<(urls: string[]) => void>>(),
      }
      slot.services = browse((services) => {
        slot.current = services
        deliver(slot)
      })
        .catch(() => [] as LanService[])
        .then((services) => {
          slot.done = true
          slot.current = services
          deliver(slot)
          return services
        })
      last = slot
    }
    const slot = last
    if (slot.done) return Promise.resolve(nodeLanUrls(slot.current, environmentId))
    const ready = nodeLanUrls(slot.current, environmentId)
    if (ready.length > 0) return Promise.resolve(ready)
    return new Promise((resolve) => {
      const waiters = slot.waiters.get(environmentId) ?? []
      waiters.push(resolve)
      slot.waiters.set(environmentId, waiters)
    })
  }
}
