import { hostLinkOf, type MobileIdentity, type RelayClient, type SavedPairing } from '@superone/relay-client'
import type { LanAddress } from './device-discovery'
import { createMobileRelayConnection } from './mobile-relay-connection'

export type SideConnection = ReturnType<typeof createMobileRelayConnection>

/**
 * A connection to a saved desktop next to the active one, for a short task
 * (resolving a session link, carrying a desktop pairing). It never restores,
 * reports status or reconnects the visible session.
 */
export function createSideConnection(opts: {
  pairing: SavedPairing
  identity: MobileIdentity
  resolveLan: (pairingId: string) => Promise<LanAddress | null>
  onEvents?: (events: unknown[], epoch: number) => void
}): SideConnection {
  const link = hostLinkOf(opts.pairing)
  if (!link) throw new Error('Pair this desktop again first')
  return createMobileRelayConnection({
    endpoint: { relayUrl: opts.pairing.relayUrl, link, identity: opts.identity },
    onEvents: opts.onEvents ?? (() => {}), onTerminal: () => {}, restore: async () => 0, currentEpoch: () => 0,
    onConnection: () => {}, onStatus: () => {}, onShutdown: () => {}, onKicked: () => {},
    resolveLan: () => opts.resolveLan(opts.pairing.id), suppressDisconnect: () => true,
  })
}

export function closeSideConnection(connection: SideConnection): void {
  connection.reconnectController.cancel()
  connection.client.disconnect()
}

/**
 * Send one command to a saved desktop: over the active connection when it is
 * that desktop, otherwise over a side connection opened for it.
 */
export async function requestSavedDesktop(opts: {
  pairing: SavedPairing
  identity: MobileIdentity
  resolveLan: (pairingId: string) => Promise<LanAddress | null>
  active: { pairingId: string | null; client: RelayClient | null }
  method: string
  payload: Record<string, unknown>
  timeoutMs?: number
}): Promise<unknown> {
  if (opts.active.client && opts.active.pairingId === opts.pairing.id) {
    return opts.active.client.rpc(opts.method, opts.payload, { timeoutMs: opts.timeoutMs, ...(opts.pairing.environmentId ? { environmentId: opts.pairing.environmentId } : {}) })
  }
  const connection = createSideConnection(opts)
  try {
    await connection.dial(await opts.resolveLan(opts.pairing.id))
    return await connection.client.rpc(opts.method, opts.payload, { timeoutMs: opts.timeoutMs, ...(opts.pairing.environmentId ? { environmentId: opts.pairing.environmentId } : {}) })
  } finally {
    closeSideConnection(connection)
  }
}
