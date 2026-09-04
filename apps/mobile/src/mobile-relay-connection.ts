import { RelayClient, type OpenSocket } from '@superone/relay-client'
import { ReconnectController, type ConnectionState } from './reconnect-controller'

export type MobileRelayConnectionHooks = {
  onEvents: (events: unknown[], epoch: number) => void
  onTerminal: (payload: unknown) => void
  restore: (client: RelayClient) => Promise<number>
  currentEpoch: (client: RelayClient) => number
  onConnection: (state: ConnectionState, epoch: number) => void
  onStatus: (message: string) => void
  onShutdown: () => void
  onKicked?: () => void
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
  const report = hooks.onConnection
  const restore = () => hooks.restore(client)
  const reconnectController = new ReconnectController(
    () => client.reconnect(),
    restore,
    {
      onState: (state, epoch) => {
        if (state === 'connected') peerLost = false
        report(state, epoch)
      },
      onRetry: (error, delayMs) => {
        const reason = error instanceof Error ? error.message : 'connection failed'
        hooks.onStatus(`${reason} — retrying in ${delayMs / 1_000}s`)
      },
    },
  )

  client = new RelayClient({
    onEvents: hooks.onEvents,
    onTerminal: hooks.onTerminal,
    onReset: () => {
      hooks.onStatus('server reset — rehydrating')
      if (reconnectController.isActive) return
      report('reconnecting', hooks.currentEpoch(client))
      void restore()
        .then((epoch) => report('connected', epoch))
        .catch((error) => hooks.onStatus(error instanceof Error ? error.message : 'rehydrate failed'))
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
        report('reconnecting', hooks.currentEpoch(client))
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
      if (frame.type !== 'handshake' || !peerLost || reconnectController.isActive || peerRestore) return
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
    },
    onStatus: (connected) => {
      if (stopped) return
      if (!connected && hooks.suppressDisconnect()) return
      if (connected) {
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
