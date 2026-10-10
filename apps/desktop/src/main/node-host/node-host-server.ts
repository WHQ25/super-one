import {
  deriveIssuedChannelSecret,
  dispatchRpc,
  issueChannelCredential,
  loadOrCreateChannelRoot,
  nodeRelayRoomId,
  RelayNodeHost,
  startNodeServer,
  type NodeIdentity,
  type NodeServerHandle,
  type RpcContext,
} from '@superone/runtime/server'
import { verifyPayload } from '@superone/runtime/crypto/crypto-util'
import type { NodeHostController, NodeHostControllerPath, NodeHostPairingToken } from '@superone/shared/agent-types'
import { networkAddressScope } from '@superone/shared/private-network-address'
import type { DesktopDomain } from './desktop-domain'
import type { DesktopSessionHost } from './desktop-session-host'
import { DESKTOP_NODE_LOOPBACK_HOST } from './paths'

export interface DesktopNodeHostListen {
  bindPort: number
  /** Loopback by default; every request beyond `/health` runs inside the encrypted channel either way. */
  bindHost?: string
  /** The address other devices reach this host at, for the pairing code. */
  advertisedHost?: string
  /** This host's Tailscale address, offered in the pairing code. */
  tailscaleHost?: string
  /** Accept a TCP peer only when this returns true (private networks when listening beyond loopback). */
  allowRemoteAddress?: (address: string | undefined) => boolean
  /** Relay broker (`wss://…`) that carries the channel when devices are not on one network. */
  relayUrl?: string
  onRelayStatus?: (connected: boolean) => void
  /** A controller paired or was removed. */
  onControllersChanged?: () => void
  log?: { info: (message: string) => void; warn: (message: string) => void }
}

/**
 * The listener that lets controller desktops reach this desktop's domain: the
 * runtime node server inside the pairing-secret channel, on the LAN and over
 * the relay. Stopping it leaves the domain (and the phones it serves) up.
 */
export class DesktopNodeHost {
  private constructor(
    readonly domain: DesktopDomain,
    private readonly server: NodeServerHandle,
    private readonly channelRoot: string,
    private readonly listen: DesktopNodeHostListen,
    private readonly relay: RelayNodeHost | null,
  ) {}

  static async start(domain: DesktopDomain, listen: DesktopNodeHostListen): Promise<DesktopNodeHost> {
    const { identity, auth } = domain
    const bindHost = listen.bindHost ?? DESKTOP_NODE_LOOPBACK_HOST
    // Pairing, tokens and RPC run only inside the pairing-secret channel
    // (AES-256-GCM over ws), so the server may listen beyond loopback.
    const channelRoot = loadOrCreateChannelRoot(domain.nodeHome)
    const context = domain.rpcContext()
    const server = await startNodeServer<RpcContext>({
      identity,
      auth,
      bindHost,
      bindPort: listen.bindPort,
      startedAt: context.startedAt,
      verifyDeviceProof: verifyPayload,
      dispatchRpc: domain.dispatchRpc,
      control: domain.leases,
      secureChannel: { resolveSecret: (keyId) => deriveIssuedChannelSecret(channelRoot, keyId) },
      ...(listen.allowRemoteAddress ? { allowRemoteAddress: listen.allowRemoteAddress } : {}),
      // Controllers coming and going change what the settings list shows.
      onClientConnected: () => listen.onControllersChanged?.(),
      onClientDisconnected: () => listen.onControllersChanged?.(),
      createRpcContext: () => ({ ...context }),
    })
    auth.onRevoke = (clientSessionId) => {
      server.closeSocketsForClient(clientSessionId)
      listen.onControllersChanged?.()
    }
    auth.onPaired = () => listen.onControllersChanged?.()
    // The relay carries the same channel frames for devices on other networks.
    const relay = listen.relayUrl
      ? new RelayNodeHost({
          relayUrl: listen.relayUrl,
          roomId: nodeRelayRoomId(channelRoot),
          onSocket: (socket) => server.acceptChannelSocket(socket),
          onStatus: listen.onRelayStatus,
          log: listen.log,
        })
      : null
    relay?.start()
    return new DesktopNodeHost(domain, server, channelRoot, listen, relay)
  }

  get identity(): NodeIdentity {
    return this.domain.identity
  }

  private get auth() {
    return this.domain.auth
  }

  /** The `session.*` surface, for tools of sessions served here. */
  get sessions(): DesktopSessionHost {
    return this.domain.sessions
  }

  /** Port the node server listens on. */
  get port(): number {
    return Number(new URL(this.server.url).port)
  }

  /** Where other devices reach this host on its LAN (the advertised host, else the bind address). */
  get url(): string {
    return this.listen.advertisedHost ? `http://${this.listen.advertisedHost}:${this.port}` : this.server.url
  }

  get relayConnected(): boolean {
    return this.relay?.connected === true
  }

  /**
   * A single-use pairing token for another device, with the channel
   * credential it pairs through. Both travel out of band (code or QR).
   */
  mintPairingToken(): NodeHostPairingToken {
    const token = this.auth.createPairingToken()
    return {
      url: this.url,
      lan: { host: this.listen.advertisedHost ?? new URL(this.server.url).hostname, port: this.port },
      ...(this.listen.tailscaleHost ? { tailscaleHost: this.listen.tailscaleHost } : {}),
      ...(this.relay && this.listen.relayUrl
        ? { relay: { url: this.listen.relayUrl, room: nodeRelayRoomId(this.channelRoot) } }
        : {}),
      channel: issueChannelCredential(this.channelRoot, token.tokenId),
      environmentId: this.identity.environmentId,
      nodePublicKeyFingerprint: this.identity.publicKeyFingerprint,
      tokenId: token.tokenId,
      pairingToken: token.token,
      expiresAt: token.expiresAt,
    }
  }

  /** Desktops paired to run sessions here, newest first. */
  controllers(): NodeHostController[] {
    return this.auth.listClientSessions()
      .filter((c) => c.revokedAt === null)
      .map((c) => ({
        id: c.clientSessionId,
        label: c.label ?? '',
        pairedAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        enabled: c.suspendedAt === null,
        platform: c.platform,
        path: this.controllerPaths().get(c.clientSessionId) ?? null,
      }))
  }

  /** How each connected controller reaches this computer right now. */
  private controllerPaths(): Map<string, NodeHostControllerPath> {
    const paths = new Map<string, NodeHostControllerPath>()
    for (const { clientSessionId, remoteAddress } of this.server.connectedClients()) {
      // A direct socket outranks a relay one for the same controller.
      if (paths.get(clientSessionId) && paths.get(clientSessionId) !== 'relay') continue
      paths.set(clientSessionId, remoteAddress === null
        ? 'relay'
        : networkAddressScope(remoteAddress) === 'tailscale' ? 'tailscale' : 'lan')
    }
    return paths
  }

  /** Let a controller in again, or keep it out (closing its connections) while it stays paired. */
  setControllerEnabled(id: string, enabled: boolean): boolean {
    return this.auth.setClientSessionSuspended(id, !enabled)
  }

  /** The master switch: off turns every controller away; each keeps its own switch. */
  setAccessAllowed(allowed: boolean): void {
    this.auth.setAccessPaused(!allowed)
  }

  /** Unpair a controller and close its connections. */
  removeController(id: string): boolean {
    return this.auth.revokeClientSession(id)
  }

  /** Whether a minted pairing code can still be redeemed. */
  hasLivePairingToken(): boolean {
    return this.auth.hasLivePairingToken()
  }

  async stop(): Promise<void> {
    this.relay?.stop()
    this.auth.onRevoke = null
    this.auth.onPaired = null
    // No controller can answer a Host Action until the listener is back.
    this.domain.sessions.cancelHostActions('node_host_stopped')
    await this.server.close()
  }
}
