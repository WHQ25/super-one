import type { RelayClient } from '@superone/relay-client'
import type { ConnectionState, ReconnectController } from './reconnect-controller'

type Ref<T> = { current: T }

/** Retire transport ownership before closing it, including foreground callbacks and pending probes. */
export function retireMobileConnection(refs: {
  client: Ref<RelayClient | null>
  controller: Ref<ReconnectController | null>
  connection: Ref<{ state: ConnectionState; epoch: number }>
  suppressReconnect: Ref<boolean>
}): void {
  const client = refs.client.current
  const controller = refs.controller.current
  refs.client.current = null
  refs.controller.current = null
  refs.connection.current = { state: 'offline', epoch: 0 }
  controller?.dispose()
  const wasSuppressed = refs.suppressReconnect.current
  refs.suppressReconnect.current = true
  try { client?.disconnect() }
  finally { refs.suppressReconnect.current = wasSuppressed }
}
