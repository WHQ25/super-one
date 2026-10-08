import { randomUUID } from 'node:crypto'
import {
  isTerminalCredentialFailure,
  type ExecutionEnvironmentDescriptor,
  type KnownEnvironment,
  type NodeLinkPath,
} from '@superone/shared/environment'
import {
  ConnectionSupervisor,
  type RetryNowDisposition,
  type SupervisorSnapshot,
  type SupervisorWakeReason,
} from './connection-supervisor'
import {
  generateDeviceKeyPair,
  mintWsTicket,
  NODE_REQUEST_TIMEOUT_MS,
  nodeEndpointDescription,
  pairWithNode,
  refreshNodeAccess,
} from './node-auth-client'
import { NodeCredentialStore, type NodeDeviceCredential } from './node-credential-store'
import { NodeRpcClient, type NodeRoute } from './node-rpc-client'
import type { ChannelCredential } from '@superone/runtime/server/secure-channel-client'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

export interface KnownEnvironmentRecord extends KnownEnvironment {
  /** Last known base URL (direct or forwarded). */
  baseUrl?: string
}

/** A route picked for one dial: where, how (relay slot dialer), and which path it is. */
export interface ResolvedNodeRoute extends NodeRoute {
  path: NodeLinkPath
  endpointId: string
}

export interface NodeConnectionManagerOptions {
  credentialStore: NodeCredentialStore
  /** Persist known-environment metadata (non-secret). */
  saveKnownEnvironment?: (env: KnownEnvironmentRecord) => void
  loadKnownEnvironments?: () => KnownEnvironmentRecord[]
  deleteKnownEnvironment?: (connectionId: string) => void
  onSupervisorState?: (snapshot: SupervisorSnapshot) => void
  /**
   * Rebuild endpoint plumbing (e.g. SSH local forward) during supervised dials.
   * Pairing skips this on the first attempt only; reconnect/startup uses it from
   * attempt 1 so ephemeral loopback URLs are never reused blindly.
   */
  resolveReconnectBaseUrl?: (
    known: Readonly<KnownEnvironmentRecord>,
  ) => Promise<string | undefined>
  /**
   * Pick the route for a dial (LAN, Tailscale, relay…). Takes precedence over
   * `resolveReconnectBaseUrl`; returning undefined keeps the stored base URL.
   */
  resolveReconnectRoute?: (
    known: Readonly<KnownEnvironmentRecord>,
  ) => Promise<ResolvedNodeRoute | undefined>
  /**
   * The encrypted connection over a resolved route failed for a reason that
   * may be the route's (refused, timed out, channel proof failed). The next
   * `resolveReconnectRoute` should pass it over.
   */
  onRouteFailed?: (known: Readonly<KnownEnvironmentRecord>, route: ResolvedNodeRoute) => void
  /**
   * While connected over a route other than the LAN: a better one whose
   * `/health` answers. The manager proves it with a full encrypted connection
   * (channel, attach, descriptor identity) before giving up the current one.
   */
  betterRoute?: (
    known: Readonly<KnownEnvironmentRecord>,
    current: ResolvedNodeRoute,
  ) => Promise<ResolvedNodeRoute | undefined>
}

/** Errors no other route can fix: the credential, the protocol or the node's identity. */
export function isRouteIndependentFailure(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: string; message?: string }
  return (
    isTerminalCredentialFailure(code, message ?? '') ||
    code === 'protocol_incompatible' ||
    code === 'identity_conflict' ||
    code === 'invalid_config'
  )
}

/** Same route: same endpoint and address. */
function sameRoute(a: ResolvedNodeRoute, b: ResolvedNodeRoute): boolean {
  return a.endpointId === b.endpointId && a.baseUrl === b.baseUrl
}

/** Dial attempts within one supervisor connect before backing off. */
const MAX_ROUTES_PER_DIAL = 4

interface LiveConnection {
  connectionId: string
  environmentId: string
  client: NodeRpcClient
  gateway: RemoteEnvironmentGateway
  supervisor: ConnectionSupervisor
  credential: NodeDeviceCredential
  accessToken?: string
  accessExpiresAt?: number
  /** True when in-memory refresh is newer than last successful encrypted disk write. */
  credentialDirty: boolean
  /** Last reason disk persist failed (durable degraded signal). */
  credentialPersistError?: string
  /** Route of the current (or last) dial. */
  route?: ResolvedNodeRoute
}

/**
 * Electron Main orchestrator for remote node connections.
 * Owns credentials, sockets, and supervisors — renderer only sees scoped refs.
 */
export class NodeConnectionManager {
  private readonly lives = new Map<string, LiveConnection>()
  private readonly known = new Map<string, KnownEnvironmentRecord>()

  constructor(private readonly opts: NodeConnectionManagerOptions) {
    for (const env of opts.loadKnownEnvironments?.() ?? []) {
      this.known.set(env.connectionId, env)
    }
  }

  listKnown(): KnownEnvironmentRecord[] {
    return [...this.known.values()]
  }

  getGateway(environmentId: string): RemoteEnvironmentGateway | null {
    for (const live of this.lives.values()) {
      if (live.environmentId === environmentId) return live.gateway
    }
    return null
  }

  /** Live RPC client for a connection (Host Action consumer, etc.). */
  getClient(connectionId: string): NodeRpcClient | null {
    return this.lives.get(connectionId)?.client ?? null
  }

  /** Whether a connection currently has an open supervised socket. */
  isConnected(connectionId: string): boolean {
    const live = this.lives.get(connectionId)
    return live?.client.connected === true && live.supervisor.getSnapshot().state === 'connected'
  }

  /** How the live connection reaches its node; null while not connected. */
  getActivePath(connectionId: string): NodeLinkPath | null {
    if (!this.isConnected(connectionId)) return null
    return this.lives.get(connectionId)?.route?.path ?? null
  }

  /** Re-check a live connection now (e.g. its node just appeared on the LAN). */
  async checkRoute(environmentId: string): Promise<void> {
    for (const live of this.lives.values()) {
      if (live.environmentId === environmentId) await live.supervisor.wake('health-probe').catch(() => {})
    }
  }

  getSupervisor(connectionId: string): SupervisorSnapshot | null {
    const live = this.lives.get(connectionId)
    if (!live) return null
    const snap = live.supervisor.getSnapshot()
    // Surface durable credential-disk lag through the same status path the UI uses.
    if (live.credentialDirty) {
      return {
        ...snap,
        lastError:
          snap.lastError ||
          `credential_persist_degraded: ${live.credentialPersistError || 'unknown'}`,
      }
    }
    return snap
  }

  /**
   * Pair with a node using a one-time pairing token, then open a supervised connection.
   */
  async pairAndConnect(input: {
    baseUrl: string
    /** The route pairing runs through when it is not a plain base URL (relay). */
    route?: ResolvedNodeRoute
    pairingToken: string
    /** Name this side stores for the node. */
    label: string
    /** Name the node records for this device; defaults to `label`. */
    deviceLabel?: string
    endpointProfiles?: KnownEnvironmentRecord['endpointProfiles']
    /** From the pairing code when the node requires its encrypted channel. */
    channel?: ChannelCredential
  }): Promise<{ connectionId: string; descriptor: ExecutionEnvironmentDescriptor; persisted: boolean }> {
    const device = generateDeviceKeyPair()
    const paired = await pairWithNode({
      baseUrl: input.baseUrl,
      pairingToken: input.pairingToken,
      devicePublicKeyPem: device.publicKeyPem,
      label: input.deviceLabel ?? input.label,
      channel: input.channel,
      dial: input.route?.dial,
    })

    const connectionId = randomUUID()
    const credential: NodeDeviceCredential = {
      connectionId,
      environmentId: paired.environmentId,
      nodePublicKeyFingerprint: paired.nodePublicKeyFingerprint,
      clientSessionId: paired.clientSessionId,
      devicePrivateKeyPem: device.privateKeyPem,
      devicePublicKeyPem: device.publicKeyPem,
      refreshToken: paired.refreshToken,
      baseUrl: input.baseUrl.replace(/\/$/, ''),
      label: input.label,
      updatedAt: Date.now(),
      ...(input.channel ? { channel: input.channel } : {}),
    }

    const saveResult = this.opts.credentialStore.save(credential)
    if (!saveResult.ok) {
      throw new Error(`failed to store node credentials: ${saveResult.reason}`)
    }

    const known: KnownEnvironmentRecord = {
      connectionId,
      environmentId: paired.environmentId,
      nodePublicKeyFingerprint: paired.nodePublicKeyFingerprint,
      label: input.label,
      endpointProfiles: input.endpointProfiles ?? [
        {
          endpointId: 'primary',
          kind: 'direct-wss',
          label: input.baseUrl,
          target: input.baseUrl,
        },
      ],
      preferredEndpointId: input.endpointProfiles?.[0]?.endpointId ?? 'primary',
      desired: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      baseUrl: credential.baseUrl,
    }
    this.known.set(connectionId, known)
    this.opts.saveKnownEnvironment?.(known)

    // Pairing already has an adopted/fresh baseUrl — skip resolver on the first
    // dial so bootstrap adopt() is not raced by a second tunnels.ensure().
    const descriptor = await this.connectWithCredential(credential, {
      resolveEndpointFromFirstAttempt: false,
      route: input.route,
    })
    return {
      connectionId,
      descriptor,
      persisted: saveResult.persisted,
    }
  }

  /** Reconnect a previously paired environment. */
  async connectExisting(connectionId: string, baseUrl?: string): Promise<ExecutionEnvironmentDescriptor> {
    const credential = this.opts.credentialStore.get(connectionId)
    if (!credential) throw new Error(`no credentials for connection ${connectionId}`)
    // Persist desired *before* dial so a failed endpoint prep still auto-recovers.
    this.updateKnown(connectionId, { desired: true })
    if (baseUrl) {
      credential.baseUrl = baseUrl.replace(/\/$/, '')
      this.opts.credentialStore.save(credential)
    }
    // Existing connections must rebuild tunnels/endpoints under the supervisor so
    // a temporary SSH failure leaves a live backoff owner (not a silent available).
    return this.connectWithCredential(credential, {
      resolveEndpointFromFirstAttempt: true,
    })
  }

  /** Known environments that should be kept connected (legacy omit => desired). */
  listDesiredConnectionIds(): string[] {
    return this.listKnown()
      .filter((k) => k.desired !== false)
      .filter((k) => this.opts.credentialStore.get(k.connectionId) != null)
      .map((k) => k.connectionId)
  }

  /** Wake all live supervisors (resume / network online). */
  async wakeLiveConnections(reason: SupervisorWakeReason): Promise<void> {
    const lives = [...this.lives.values()]
    await Promise.all(
      lives.map(async (live) => {
        try {
          await live.supervisor.wake(reason)
        } catch {
          /* per-connection isolation */
        }
      }),
    )
  }

  async retryNow(
    connectionId: string,
    opts?: { unblock?: boolean },
  ): Promise<RetryNowDisposition> {
    const live = this.lives.get(connectionId)
    if (!live) return 'disposed'
    return live.supervisor.retryNow(opts)
  }

  /**
   * Re-pair an existing connectionId with a fresh pairing token without changing
   * environment identity. Credentials are replaced only after identity validation
   * and a successful encrypted save.
   */
  async repairPairing(input: {
    connectionId: string
    baseUrl: string
    /** The route the exchange runs through when it is not a plain base URL (relay). */
    route?: ResolvedNodeRoute
    pairingToken: string
    /** A fresh pairing code's channel credential; defaults to the stored one. */
    channel?: ChannelCredential
    /** A fresh pairing code's routes, replacing the stored ones. */
    endpointProfiles?: KnownEnvironmentRecord['endpointProfiles']
  }): Promise<ExecutionEnvironmentDescriptor> {
    const known = this.known.get(input.connectionId)
    if (!known) throw new Error(`unknown connection ${input.connectionId}`)
    const baseUrl = input.baseUrl.replace(/\/$/, '')

    // Unauthenticated identity probe before consuming the one-time token. The
    // relay has no HTTP surface; there the channel proof and the identity
    // check of the pairing result below stand in for it.
    if (!input.route?.dial) {
      await assertNodeIdentity(baseUrl, {
        environmentId: known.environmentId,
        nodePublicKeyFingerprint: known.nodePublicKeyFingerprint,
      })
    }

    const channel = input.channel ?? this.opts.credentialStore.get(input.connectionId)?.channel
    const device = generateDeviceKeyPair()
    const paired = await pairWithNode({
      baseUrl,
      pairingToken: input.pairingToken,
      devicePublicKeyPem: device.publicKeyPem,
      label: known.label,
      channel,
      dial: input.route?.dial,
    })
    if (paired.environmentId !== known.environmentId) {
      throw Object.assign(
        new Error(
          `environment identity mismatch: expected ${known.environmentId}, got ${paired.environmentId}`,
        ),
        { code: 'identity_conflict' },
      )
    }
    if (paired.nodePublicKeyFingerprint !== known.nodePublicKeyFingerprint) {
      throw Object.assign(
        new Error(
          `node public key fingerprint mismatch: expected ${known.nodePublicKeyFingerprint}, got ${paired.nodePublicKeyFingerprint}`,
        ),
        { code: 'identity_conflict' },
      )
    }

    const credential: NodeDeviceCredential = {
      connectionId: known.connectionId,
      environmentId: paired.environmentId,
      nodePublicKeyFingerprint: paired.nodePublicKeyFingerprint,
      clientSessionId: paired.clientSessionId,
      devicePrivateKeyPem: device.privateKeyPem,
      devicePublicKeyPem: device.publicKeyPem,
      refreshToken: paired.refreshToken,
      baseUrl,
      label: known.label,
      updatedAt: Date.now(),
      ...(channel ? { channel } : {}),
    }
    const saveResult = this.opts.credentialStore.save(credential)
    if (!saveResult.ok) {
      throw new Error(`failed to store node credentials: ${saveResult.reason}`)
    }

    this.updateKnown(known.connectionId, {
      desired: true,
      baseUrl,
      ...(input.endpointProfiles?.length
        ? { endpointProfiles: input.endpointProfiles, preferredEndpointId: input.endpointProfiles[0].endpointId }
        : {}),
      updatedAt: Date.now(),
    })

    return this.connectWithCredential(credential, {
      resolveEndpointFromFirstAttempt: true,
    })
  }

  disconnect(connectionId: string): void {
    const live = this.lives.get(connectionId)
    if (!live) return
    live.supervisor.dispose()
    live.client.close()
    this.lives.delete(connectionId)
  }

  disconnectAll(): void {
    for (const id of [...this.lives.keys()]) this.disconnect(id)
  }

  /**
   * Drop a paired environment entirely: close the socket, erase the refresh
   * credential and device key, and remove client-local metadata.
   *
   * This is disconnect-plus-forget on the client only — it never uninstalls or
   * stops the node (design §15). The node keeps its own client session until an
   * administrator revokes it there.
   */
  forget(connectionId: string): void {
    this.disconnect(connectionId)
    this.opts.credentialStore.remove(connectionId)
    this.known.delete(connectionId)
    this.opts.deleteKnownEnvironment?.(connectionId)
  }

  /** Update stored endpoint metadata for a known environment. */
  updateKnown(connectionId: string, patch: Partial<KnownEnvironmentRecord>): void {
    const existing = this.known.get(connectionId)
    if (!existing) return
    const next: KnownEnvironmentRecord = { ...existing, ...patch, updatedAt: Date.now() }
    this.known.set(connectionId, next)
    this.opts.saveKnownEnvironment?.(next)
  }

  /** Whether credential disk persist is lagging behind in-memory rotation. */
  isCredentialDirty(connectionId: string): boolean {
    return this.lives.get(connectionId)?.credentialDirty === true
  }

  getCredentialPersistError(connectionId: string): string | undefined {
    return this.lives.get(connectionId)?.credentialPersistError
  }

  private async connectWithCredential(
    credential: NodeDeviceCredential,
    options?: { resolveEndpointFromFirstAttempt?: boolean; route?: ResolvedNodeRoute },
  ): Promise<ExecutionEnvironmentDescriptor> {
    this.disconnect(credential.connectionId)

    // A relayed route carries its own dialer; direct routes use credential.baseUrl.
    let route: ResolvedNodeRoute = options?.route ?? {
      baseUrl: credential.baseUrl,
      path: 'direct',
      endpointId: 'primary',
    }

    let accessToken = ''
    let accessExpiresAt = 0
    let credentialDirty = false
    let credentialPersistError: string | undefined

    const publishCredentialStatus = (): void => {
      const live = this.lives.get(credential.connectionId)
      if (!live) return
      const snap = live.supervisor.getSnapshot()
      this.opts.onSupervisorState?.(
        live.credentialDirty
          ? {
              ...snap,
              lastError:
                snap.lastError ||
                `credential_persist_degraded: ${live.credentialPersistError || 'unknown'}`,
            }
          : snap,
      )
    }

    const markDirty = (reason: string): void => {
      credentialDirty = true
      credentialPersistError = reason
      const live = this.lives.get(credential.connectionId)
      if (live) {
        live.credentialDirty = true
        live.credentialPersistError = reason
      }
      publishCredentialStatus()
    }

    const markClean = (): void => {
      credentialDirty = false
      credentialPersistError = undefined
      const live = this.lives.get(credential.connectionId)
      if (live) {
        live.credentialDirty = false
        live.credentialPersistError = undefined
      }
      publishCredentialStatus()
    }

    const tryPersistCredential = (): void => {
      const saveResult = this.opts.credentialStore.save(credential)
      // Only clear dirty when encrypted disk write actually succeeded.
      // `{ ok:true, persisted:false }` (secure storage unavailable) still leaves
      // disk stale — keep retrying when storage becomes available later.
      if (saveResult.ok && saveResult.persisted) {
        markClean()
        return
      }
      markDirty(
        saveResult.ok
          ? saveResult.reason || 'secure_storage_unavailable'
          : saveResult.reason || 'persist_failed',
      )
    }

    // Serialize refresh so concurrent ensureAccess (reconnect + manual Connect,
    // parallel getWsTicket) cannot both present the same pre-rotation token.
    // Server still has a grace window for lost-response; this cuts the race at the source.
    let refreshInFlight: Promise<string> | null = null

    const ensureAccess = async (): Promise<string> => {
      // Always retry encrypted persistence when memory is ahead of disk.
      if (credentialDirty) {
        tryPersistCredential()
      }
      if (accessToken && accessExpiresAt > Date.now() + 30_000) return accessToken
      if (refreshInFlight) return refreshInFlight

      refreshInFlight = (async () => {
        try {
          // Re-check after winning the in-flight slot — a peer may have just refreshed.
          if (accessToken && accessExpiresAt > Date.now() + 30_000) return accessToken
          const tokens = await refreshNodeAccess({
            baseUrl: route.baseUrl,
            refreshToken: credential.refreshToken,
            devicePrivateKeyPem: credential.devicePrivateKeyPem,
            clientSessionId: credential.clientSessionId,
            channel: credential.channel,
            dial: route.dial,
          })
          // Server-returned rotated refresh is authoritative in memory even if disk save fails.
          // Using the old refresh again would trigger reuse-revocation of the valid family.
          credential.refreshToken = tokens.refreshToken
          credential.clientSessionId = tokens.clientSessionId
          accessToken = tokens.accessToken
          accessExpiresAt = tokens.expiresAt
          tryPersistCredential()
          // Keep the connection usable; dirty state is retried on later ensureAccess/health.
          return accessToken
        } finally {
          refreshInFlight = null
        }
      })()

      return refreshInFlight
    }

    // When false (pairing), first dial uses credential.baseUrl as-is so bootstrap
    // tunnels are not raced. When true (reconnect/startup), every attempt including
    // the first goes through resolveReconnectBaseUrl under the supervisor.
    let skipResolverOnce = options?.resolveEndpointFromFirstAttempt !== true

    const client = new NodeRpcClient({
      baseUrl: route.baseUrl,
      dial: route.dial,
      expectedEnvironmentId: credential.environmentId,
      expectedNodePublicKeyFingerprint: credential.nodePublicKeyFingerprint,
      devicePrivateKeyPem: credential.devicePrivateKeyPem,
      channel: credential.channel,
      supervised: true,
      getWsTicket: async () => {
        const token = await ensureAccess()
        return mintWsTicket({ baseUrl: route.baseUrl, accessToken: token, channel: credential.channel, dial: route.dial })
      },
      onUnexpectedDisconnect: (error) => {
        // Defer so the close handler finishes clearing socket state first.
        queueMicrotask(() => {
          const live = this.lives.get(credential.connectionId)
          if (!live || live.client !== client) return
          live.supervisor.notifyDisconnected(error)
        })
      },
    })

    const applyRoute = (next: ResolvedNodeRoute): void => {
      route = { ...next, baseUrl: next.baseUrl.replace(/\/$/, '') }
      const live = this.lives.get(credential.connectionId)
      if (live) live.route = route
      client.setRoute(route)
      // The stored base URL stays the last direct address; a relay URL is not one.
      if (!route.dial && route.baseUrl !== credential.baseUrl) {
        credential.baseUrl = route.baseUrl
        tryPersistCredential()
        if (this.known.has(credential.connectionId)) this.updateKnown(credential.connectionId, { baseUrl: route.baseUrl })
      }
    }

    const applyBaseUrl = (next: string): void => {
      const normalized = next.replace(/\/$/, '')
      route = { baseUrl: normalized, path: route.path, endpointId: route.endpointId }
      const live = this.lives.get(credential.connectionId)
      if (live) live.route = route
      if (normalized === credential.baseUrl) {
        client.setBaseUrl(normalized)
        return
      }
      credential.baseUrl = normalized
      client.setBaseUrl(normalized)
      tryPersistCredential()
      const known = this.known.get(credential.connectionId)
      if (known) {
        this.updateKnown(credential.connectionId, { baseUrl: normalized })
      }
    }

    /** The route the next dial must use (a verified upgrade, or a fallback mid-dial). */
    let pinnedRoute: ResolvedNodeRoute | null = null

    /** Open, attach and identity-check a throwaway connection over `candidate`. */
    const verifyRoute = async (candidate: ResolvedNodeRoute): Promise<boolean> => {
      const probe = new NodeRpcClient({
        baseUrl: candidate.baseUrl,
        dial: candidate.dial,
        expectedEnvironmentId: credential.environmentId,
        expectedNodePublicKeyFingerprint: credential.nodePublicKeyFingerprint,
        devicePrivateKeyPem: credential.devicePrivateKeyPem,
        channel: credential.channel,
        supervised: true,
        heartbeatIntervalMs: 0,
        getWsTicket: async () =>
          mintWsTicket({ baseUrl: candidate.baseUrl, accessToken: await ensureAccess(), channel: credential.channel, dial: candidate.dial }),
      })
      try {
        await probe.connect()
        await probe.getDescriptor()
        return true
      } catch {
        return false
      } finally {
        probe.close()
      }
    }

    const gateway = new RemoteEnvironmentGateway(client)
    const supervisor = new ConnectionSupervisor({
      environmentId: credential.environmentId,
      connectionId: credential.connectionId,
      stableAfterMs: 30_000,
      connect: async () => {
        // A route that answers `/health` but not the encrypted channel (or a
        // spoofed answer) is marked failed, and the dial moves on to the next.
        for (let attempt = 1; ; attempt++) {
          const known = this.known.get(credential.connectionId)
          if (pinnedRoute) {
            applyRoute(pinnedRoute)
            pinnedRoute = null
          } else if (!skipResolverOnce && known) {
            if (this.opts.resolveReconnectRoute) {
              const resolved = await this.opts.resolveReconnectRoute(known)
              if (resolved) applyRoute(resolved)
            } else if (this.opts.resolveReconnectBaseUrl) {
              const resolved = await this.opts.resolveReconnectBaseUrl(known)
              if (resolved) applyBaseUrl(resolved)
            }
          }
          skipResolverOnce = false
          const tried = route
          try {
            // Probe unauthenticated health first so clone/regenerate surfaces as
            // identity_conflict before auth errors obscure the root cause. A relay
            // has no HTTP surface; the channel proof and descriptor check identity.
            if (!route.dial) {
              await assertNodeIdentity(route.baseUrl, {
                environmentId: credential.environmentId,
                nodePublicKeyFingerprint: credential.nodePublicKeyFingerprint,
              })
            }
            await client.connect()
            await client.getDescriptor()
            return
          } catch (err) {
            if (!known || !this.opts.onRouteFailed || !this.opts.resolveReconnectRoute || isRouteIndependentFailure(err)) throw err
            client.invalidateTransport('route failed')
            this.opts.onRouteFailed(known, tried)
            if (attempt >= MAX_ROUTES_PER_DIAL) throw err
            const next = await this.opts.resolveReconnectRoute(known)
            if (!next || sameRoute(next, tried)) throw err
            pinnedRoute = next
          }
        }
      },
      healthProbe: async () => {
        let ok = false
        try {
          if (credentialDirty) tryPersistCredential()
          const h = await client.health()
          ok = h.ok === true
        } catch {
          return false
        }
        if (!ok) return false
        // Off the LAN: make before break. A better route must carry a full
        // encrypted connection to this node before the working one is given
        // up; then the supervisor re-dials onto it and session cursors resume.
        const known = this.known.get(credential.connectionId)
        if (route.path !== 'lan' && known && this.opts.betterRoute) {
          const better = await this.opts.betterRoute(known, route).catch(() => undefined)
          if (better) {
            if (await verifyRoute(better)) {
              pinnedRoute = better
              throw new Error(`switching from ${route.path} to ${better.path}`)
            }
            this.opts.onRouteFailed?.(known, better)
          }
        }
        return true
      },
      invalidateTransport: (reason) => {
        client.invalidateTransport(reason)
      },
      onStateChange: (snap) => this.opts.onSupervisorState?.(snap),
    })

    this.lives.set(credential.connectionId, {
      connectionId: credential.connectionId,
      environmentId: credential.environmentId,
      client,
      gateway,
      supervisor,
      credential,
      credentialDirty: false,
      credentialPersistError: undefined,
      route,
    })

    await supervisor.start()
    const snap = supervisor.getSnapshot()
    if (snap.state !== 'connected') {
      const code =
        snap.blockReason === 'auth'
          ? 'unauthorized'
          : snap.blockReason === 'identity_conflict'
            ? 'identity_conflict'
            : snap.blockReason === 'protocol_incompatible'
              ? 'protocol_incompatible'
              : 'unavailable'
      throw Object.assign(new Error(snap.lastError || 'failed to connect'), { code })
    }

    return gateway.getDescriptor()
  }
}

/** Unauthenticated /health identity probe used before pairing/RPC. */
export async function assertNodeIdentity(
  baseUrl: string,
  expected: { environmentId: string; nodePublicKeyFingerprint: string },
): Promise<{ environmentId: string; nodePublicKeyFingerprint: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(NODE_REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const detail =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? `timed out after ${NODE_REQUEST_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : String(error)
    throw Object.assign(
      new Error(
        `health probe failed for ${nodeEndpointDescription(url)} ${url}: ${detail}`,
      ),
      { code: 'unavailable', cause: error },
    )
  }
  if (!res.ok) {
    throw Object.assign(new Error(`health probe failed: ${res.status}`), { code: 'unavailable' })
  }
  const body = (await res.json()) as {
    ok?: boolean
    environmentId?: string
    nodePublicKeyFingerprint?: string
  }
  if (!body.ok || !body.environmentId || !body.nodePublicKeyFingerprint) {
    throw Object.assign(new Error('invalid health response'), { code: 'unavailable' })
  }
  if (body.environmentId !== expected.environmentId) {
    throw Object.assign(
      new Error(
        `environment identity mismatch: expected ${expected.environmentId}, got ${body.environmentId}`,
      ),
      { code: 'identity_conflict' },
    )
  }
  if (body.nodePublicKeyFingerprint !== expected.nodePublicKeyFingerprint) {
    throw Object.assign(
      new Error(
        `node public key fingerprint mismatch: expected ${expected.nodePublicKeyFingerprint}, got ${body.nodePublicKeyFingerprint}`,
      ),
      { code: 'identity_conflict' },
    )
  }
  return {
    environmentId: body.environmentId,
    nodePublicKeyFingerprint: body.nodePublicKeyFingerprint,
  }
}
