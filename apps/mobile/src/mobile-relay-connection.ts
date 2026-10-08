import { networkLedger, networkMetricsEnabled } from './network-ledger'
import { RelayClient, type HostLink, type MobileIdentity, type OpenSocket } from '@superone/relay-client'
import { ReconnectController, RECONNECT_DELAYS_MS, type ConnectionState } from './reconnect-controller'
import type { ReconnectInfo } from './device-status'
import type { LanAddress } from './device-discovery'
import { logConnection } from './relay-debug'

/** Everything needed to reach one paired desktop over either route. */
export type DesktopEndpoint = { relayUrl: string; link: HostLink; identity: MobileIdentity }

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
   * Bumped by every verified handshake. A restore that spans one ran (at least
   * partly) on a channel the desktop has since replaced, so it runs again.
   */
  let channelGeneration = 0
  /** False between `peer_disconnected` and the desktop's next handshake. */
  let peerPresent = true
  /** Ends a restore backoff early: a new channel, a departed peer or a lost socket. */
  let wakeRestore: (() => void) | null = null
  /**
   * A handshake seen on the current socket. The desktop sends one whenever a
   * mobile attaches, and it can land while the `/status` probe is still in
   * flight — the probe then answers from a stale heartbeat, but a handshake is
   * the desktop itself talking, so it outranks the probe.
   */
  let handshakeSeen = false
  let lastDelayMs = 0
  let attempt = 0
  const { relayUrl, link, identity } = hooks.endpoint
  const dial = (lan: LanAddress | null) => lan
    ? client.connectLan(lan.host, lan.port, link)
    : client.connectRelay({ relayUrl, link, deviceId: identity.deviceId })
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
  const peerRestoreWanted = () => !stopped && peerLost && peerPresent && client.connected && !reconnectController.isActive
  /**
   * Restores over the desktop's current channel until one restore completes on
   * it. Nothing external is guaranteed to come along after a failure — the socket
   * stays open and the desktop may never handshake again — so failures back off
   * and retry here rather than wait for a disconnect.
   */
  const restorePeer = () => {
    if (peerRestore) {
      wakeRestore?.()
      return
    }
    peerRestore = (async () => {
      let failures = 0
      while (peerRestoreWanted()) {
        const generation = channelGeneration
        try {
          const epoch = await restore()
          if (generation !== channelGeneration) continue
          if (!peerRestoreWanted()) return
          peerLost = false
          report('connected', epoch)
          hooks.onStatus('')
          return
        } catch (error) {
          if (generation !== channelGeneration || !peerRestoreWanted()) continue
          const delayMs = RECONNECT_DELAYS_MS[Math.min(failures++, RECONNECT_DELAYS_MS.length - 1)]
          const reason = error instanceof Error ? error.message : 'rehydrate failed'
          logConnection('restore retry', { transport: client.transport, reason, delayMs })
          hooks.onStatus(`${reason} — retrying in ${delayMs / 1_000}s`)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => wakeRestore?.(), delayMs)
            wakeRestore = () => {
              clearTimeout(timer)
              wakeRestore = null
              resolve()
            }
          })
        }
      }
    })().finally(() => { peerRestore = null })
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
    onShutdown: () => {
      stopped = true
      reconnectController.cancel()
      client.disconnect()
      hooks.onShutdown()
    },
    onControl: (frame) => {
      if (frame.type === 'peer_disconnected') {
        peerLost = true
        peerPresent = false
        wakeRestore?.()
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
        logConnection('desktop reattached', { transport: client.transport })
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
      if (frame.type !== 'handshake') return
      handshakeSeen = true
      peerPresent = true
      channelGeneration += 1
      if (!peerLost || reconnectController.isActive) return
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
      wakeRestore?.()
    },
    ...(hooks.openSocket ? { openSocket: hooks.openSocket } : {}),
  })

  return { client, reconnectController, dial, adoptHooks: next => { hooks = next } }
}
