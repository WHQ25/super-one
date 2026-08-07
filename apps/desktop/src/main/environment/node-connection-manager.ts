import { randomUUID } from 'node:crypto'
import type { ExecutionEnvironmentDescriptor, KnownEnvironment } from '@superone/shared/environment'
import { ConnectionSupervisor, type SupervisorSnapshot } from './connection-supervisor'
import {
  generateDeviceKeyPair,
  mintWsTicket,
  NODE_REQUEST_TIMEOUT_MS,
  nodeEndpointDescription,
  pairWithNode,
  refreshNodeAccess,
} from './node-auth-client'
import { NodeCredentialStore, type NodeDeviceCredential } from './node-credential-store'
import { NodeRpcClient } from './node-rpc-client'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

export interface KnownEnvironmentRecord extends KnownEnvironment {
  /** Last known base URL (direct or forwarded). */
  baseUrl?: string
}

export interface NodeConnectionManagerOptions {
  credentialStore: NodeCredentialStore
  /** Persist known-environment metadata (non-secret). */
  saveKnownEnvironment?: (env: KnownEnvironmentRecord) => void
  loadKnownEnvironments?: () => KnownEnvironmentRecord[]
  deleteKnownEnvironment?: (connectionId: string) => void
  onSupervisorState?: (snapshot: SupervisorSnapshot) => void
  /**
   * Rebuild endpoint plumbing (e.g. SSH local forward) for automatic retries.
   * Called only on supervisor attempts after the first so bootstrap tunnels
   * adopted during pairing are not raced by a second ensure().
   */
  resolveReconnectBaseUrl?: (
    known: Readonly<KnownEnvironmentRecord>,
  ) => Promise<string | undefined>
}

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
    pairingToken: string
    label: string
    endpointProfiles?: KnownEnvironmentRecord['endpointProfiles']
  }): Promise<{ connectionId: string; descriptor: ExecutionEnvironmentDescriptor; persisted: boolean }> {
    const device = generateDeviceKeyPair()
    const paired = await pairWithNode({
      baseUrl: input.baseUrl,
      pairingToken: input.pairingToken,
      devicePublicKeyPem: device.publicKeyPem,
      label: input.label,
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
      preferredEndpointId: 'primary',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      baseUrl: credential.baseUrl,
    }
    this.known.set(connectionId, known)
    this.opts.saveKnownEnvironment?.(known)

    const descriptor = await this.connectWithCredential(credential)
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
    if (baseUrl) {
      credential.baseUrl = baseUrl.replace(/\/$/, '')
      this.opts.credentialStore.save(credential)
    }
    return this.connectWithCredential(credential)
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

  private async connectWithCredential(credential: NodeDeviceCredential): Promise<ExecutionEnvironmentDescriptor> {
    this.disconnect(credential.connectionId)

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
            baseUrl: credential.baseUrl,
            refreshToken: credential.refreshToken,
            devicePrivateKeyPem: credential.devicePrivateKeyPem,
            clientSessionId: credential.clientSessionId,
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

    // First supervisor attempt uses the caller-supplied baseUrl (bootstrap may
    // already have adopted an SSH forward). Subsequent retries rebuild via host.
    let initialAttempt = true

    const client = new NodeRpcClient({
      baseUrl: credential.baseUrl,
      expectedEnvironmentId: credential.environmentId,
      expectedNodePublicKeyFingerprint: credential.nodePublicKeyFingerprint,
      devicePrivateKeyPem: credential.devicePrivateKeyPem,
      supervised: true,
      getWsTicket: async () => {
        const token = await ensureAccess()
        return mintWsTicket({ baseUrl: credential.baseUrl, accessToken: token })
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

    const applyBaseUrl = (next: string): void => {
      const normalized = next.replace(/\/$/, '')
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

    const gateway = new RemoteEnvironmentGateway(client)
    const supervisor = new ConnectionSupervisor({
      environmentId: credential.environmentId,
      connectionId: credential.connectionId,
      connect: async () => {
        if (!initialAttempt && this.opts.resolveReconnectBaseUrl) {
          const known = this.known.get(credential.connectionId)
          if (known) {
            const resolved = await this.opts.resolveReconnectBaseUrl(known)
            if (resolved) applyBaseUrl(resolved)
          }
        }
        initialAttempt = false
        // Probe unauthenticated health first so clone/regenerate surfaces as
        // identity_conflict before auth errors obscure the root cause.
        await assertNodeIdentity(credential.baseUrl, {
          environmentId: credential.environmentId,
          nodePublicKeyFingerprint: credential.nodePublicKeyFingerprint,
        })
        await client.connect()
        await client.getDescriptor()
      },
      healthProbe: async () => {
        try {
          if (credentialDirty) tryPersistCredential()
          const h = await client.health()
          return h.ok === true
        } catch {
          return false
        }
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
