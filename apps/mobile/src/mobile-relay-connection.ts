import { networkLedger, networkMetricsEnabled } from './network-ledger'
import { RelayClient, type OpenSocket } from '@superone/relay-client'
import { ReconnectController, type ConnectionState } from './reconnect-controller'
import type { ReconnectInfo } from './device-status'

export type MobileRelayConnectionHooks = {
  onEvents: (events: unknown[], epoch: number) => void
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
  suppressDisconnect: () => boolean
  openSocket?: OpenSocket
}

export function createMobileRelayConnection(hooks: MobileRelayConnectionHooks): {
  client: RelayClient
  reconnectController: ReconnectController
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
  const report = hooks.onConnection
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
    () => client.reconnect(),
    restore,
    {
      onState: (state, epoch) => {
        if (state !== 'reconnecting') {
          // Offline keeps the relay socket as a mailbox: the desktop's next
          // handshake (below) is what brings this connection back.
          peerLost = state === 'offline'
          lastDelayMs = 0
          hooks.onReconnectInfo?.({ attempting: false, waiting: false, delayMs: 0, nextAtMs: null })
        }
        report(state, epoch)
      },
      probe: async () => client.transport !== 'relay'
        || handshakeSeen
        || (await hooks.isDesktopOnline?.() ?? true)
        || handshakeSeen,
      onAttempt: () => {
        hooks.onReconnectInfo?.({ attempting: true, waiting: false, delayMs: lastDelayMs, nextAtMs: null })
      },
      onRetry: (error, delayMs) => {
        const reason = error instanceof Error ? error.message : 'connection failed'
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
    onEvents: hooks.onEvents,
    onTerminal: hooks.onTerminal,
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
        if (peerLost) hooks.onStatus('desktop reconnected — waiting for handshake')
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
      reconnectController.start(hooks.currentEpoch(client))
    },
    ...(hooks.openSocket ? { openSocket: hooks.openSocket } : {}),
  })

  return { client, reconnectController }
}
