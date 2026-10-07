import { networkLedger, networkMetricsEnabled } from './network-ledger'
import { RelayClient, type MobileIdentity, type OpenSocket } from '@superone/relay-client'
import { ReconnectController, type ConnectionState } from './reconnect-controller'
import type { ReconnectInfo } from './device-status'
import type { LanAddress } from './device-discovery'
import { logConnection } from './relay-debug'

/** Everything needed to reach one paired desktop over either route. */
export type DesktopEndpoint = { relayUrl: string; masterSecret: string; identity: MobileIdentity }

export type MobileRelayConnectionHooks = {
  onEvents: (events: unknown[], epoch: number) => void
  /** Every batch on arrival, buffered or not; see `RelayClient`'s `onArrived`. */
  onArrived?: (events: unknown[]) => void
  onTerminal: (payload: unknown) => void
  restore: (client: RelayClient) => Promise<number>
  currentEpoch: (client: RelayClient) => number
  onConnection: (state: ConnectionState, epoch: number) => void
  onStatus: (message: string) => void
  /** Backoff state for the device list's countdown; null once settled. */
  onReconnectInfo?: (info: ReconnectInfo) => void
  onShutdown: () => void
  onKicked?: () => void
  /**
   * Relay presence probe (`/status`). Consulted after the relay socket reopens,
   * because the relay accepts a lone mobile; LAN never asks — there the desktop
   * is the socket peer, so an open socket already answers.
   */
  isDesktopOnline?: () => Promise<boolean>
  endpoint: DesktopEndpoint
  /**
   * Where the desktop answers on the LAN right now; null dials the relay. Asked
   * before every redial: the route of the first dial goes stale while the
   * phone sleeps, and redialling it verbatim never recovers.
   */
  resolveLan: () => Promise<LanAddress | null>
  suppressDisconnect: () => boolean
  openSocket?: OpenSocket
}

export function createMobileRelayConnection(hooks: MobileRelayConnectionHooks): {
  client: RelayClient
  reconnectController: ReconnectController
  dial: (lan: LanAddress | null) => Promise<void>
  adoptHooks(next: MobileRelayConnectionHooks): void
} {
  let client!: RelayClient
  let stopped = false
  let peerLost = false
  let peerRestore: Promise<void> | null = null
  /**
   * A handshake seen on the current socket. The desktop sends one whenever a
   * mobile attaches, and it can land while the `/status` probe is still in
   * flight — the probe then answers from a stale heartbeat, but a handshake is
   * the desktop itself talking, so it outranks the probe.
   */
  let handshakeSeen = false
  let lastDelayMs = 0
  let attempt = 0
  const { relayUrl, masterSecret, identity } = hooks.endpoint
  const dial = (lan: LanAddress | null) => lan
    ? client.connectLan(lan.host, lan.port, masterSecret, identity)
    : client.connectRelay({ relayUrl, masterSecret, deviceId: identity.deviceId, deviceName: identity.deviceName })
  const redial = async () => {
    client.startBuffering()
    const lan = await hooks.resolveLan()
    logConnection('dial', { attempt, transport: lan ? 'lan' : 'relay', lan: lan ? `${lan.host}:${lan.port}` : null })
    await dial(lan)
  }
  const report: MobileRelayConnectionHooks['onConnection'] = (state, epoch) => {
    logConnection('state', { state, epoch, transport: client.transport })
    hooks.onConnection(state, epoch)
  }
  const restore = () => hooks.restore(client)
  const restorePeer = () => {
    if (peerRestore) return
    peerRestore = restore()
      .then((epoch) => {
        if (stopped) return
        peerLost = false
        report('connected', epoch)
        hooks.onStatus('')
      })
      .catch((error) => {
        if (!stopped) hooks.onStatus(error instanceof Error ? error.message : 'rehydrate failed')
      })
      .finally(() => { peerRestore = null })
  }
  const reconnectController = new ReconnectController(
    redial,
    restore,
    {
      onState: (state, epoch) => {
        if (state !== 'reconnecting') {
          // Offline keeps the relay socket as a mailbox: the desktop's next
          // handshake (below) is what brings this connection back.
          peerLost = state === 'offline'
          lastDelayMs = 0
          attempt = 0
          hooks.onReconnectInfo?.({ attempting: false, waiting: false, delayMs: 0, nextAtMs: null })
        }
        report(state, epoch)
      },
      probe: async () => client.transport !== 'relay'
        || handshakeSeen
        || (await hooks.isDesktopOnline?.() ?? true)
        || handshakeSeen,
      onAttempt: () => {
        attempt += 1
        hooks.onReconnectInfo?.({ attempting: true, waiting: false, delayMs: lastDelayMs, nextAtMs: null })
      },
      onRetry: (error, delayMs) => {
        const reason = error instanceof Error ? error.message : 'connection failed'
        logConnection('retry', { attempt, transport: client.transport, reason, delayMs })
        lastDelayMs = delayMs
        hooks.onStatus(`${reason} — retrying in ${delayMs / 1_000}s`)
        hooks.onReconnectInfo?.({
          attempting: false,
          waiting: true,
          delayMs,
          nextAtMs: Date.now() + delayMs,
        })
      },
    },
  )

  client = new RelayClient({
    onMetric: networkMetricsEnabled ? metric => networkLedger.record(metric) : undefined,
    onEvents: (events, epoch) => hooks.onEvents(events, epoch),
    onArrived: events => hooks.onArrived?.(events),
    onTerminal: payload => hooks.onTerminal(payload),
    onReset: () => {
      hooks.onStatus('server reset — rehydrating')
      if (reconnectController.isActive) return
      report('reconnecting', hooks.currentEpoch(client))
      restorePeer()
    },
    onShutdown: () => {
      stopped = true
      reconnectController.cancel()
      client.disconnect()
      hooks.onShutdown()
    },
    onControl: (frame) => {
      if (frame.type === 'peer_disconnected') {
        peerLost = true
        report('offline', hooks.currentEpoch(client))
        hooks.onStatus('desktop disconnected — waiting to reconnect')
        return
      }
      if (frame.type === 'peer_connected') {
        if (peerLost) {
          hooks.onStatus('desktop reconnected — waiting for handshake')
          return
        }
        // The relay announces a departed desktop only once its socket closes, and
        // a desktop that redials first replaces that socket before it does, so no
        // `peer_disconnected` came. Everything it sent while away was dropped;
        // its handshake restores like any other return.
        if (reconnectController.isActive || peerRestore) return
        peerLost = true
        report('reconnecting', hooks.currentEpoch(client))
        return
      }
      if (frame.type === 'kicked') {
        stopped = true
        reconnectController.cancel()
        client.disconnect()
        hooks.onKicked?.()
        return
      }
      if (frame.type === 'handshake') handshakeSeen = true
      if (frame.type !== 'handshake' || !peerLost || reconnectController.isActive || peerRestore) return
      restorePeer()
    },
    onStatus: (connected) => {
      if (stopped) return
      if (!connected && hooks.suppressDisconnect()) return
      if (connected) {
        handshakeSeen = false
        if (reconnectController.isActive) {
          hooks.onStatus('reconnected — rehydrating')
          return
        }
        report('connected', hooks.currentEpoch(client))
        return
      }
      logConnection('transport lost', { transport: client.transport, looping: reconnectController.isActive })
      reconnectController.start(hooks.currentEpoch(client))
    },
    ...(hooks.openSocket ? { openSocket: hooks.openSocket } : {}),
  })

  return { client, reconnectController, dial, adoptHooks: next => { hooks = next } }
}
