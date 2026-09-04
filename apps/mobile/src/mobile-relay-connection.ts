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
  suppressDisconnect: () => boolean
  openSocket?: OpenSocket
}

export function createMobileRelayConnection(hooks: MobileRelayConnectionHooks): {
  client: RelayClient
  reconnectController: ReconnectController
} {
  let client!: RelayClient
  const report = hooks.onConnection
  const restore = () => hooks.restore(client)
  const reconnectController = new ReconnectController(
    () => client.reconnect(),
    restore,
    {
      onState: report,
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
    onShutdown: hooks.onShutdown,
    onStatus: (connected) => {
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
