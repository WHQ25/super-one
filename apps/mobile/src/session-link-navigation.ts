import { hostLinkOf, restoreSession, type RelayClient, type SavedPairing, type RestoredSession } from '@superone/relay-client'
import type { LanAddress } from './device-discovery'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { SessionLinkTarget, SessionLinkMetadataResult } from '@superone/shared/session-link'
import { closeSideConnection, createSideConnection, type SideConnection } from './side-connection'
import { buildSessionLink } from '@superone/shared/session-link'
import { readConnectionWorkspace } from './connection-workspace'

type Connection = SideConnection
export interface SessionLinkPreparation {
  client: RelayClient
  connection?: Connection
  pairing?: SavedPairing
  workspace?: Awaited<ReturnType<typeof readConnectionWorkspace>>
  target: SessionLinkTarget
  restored: RestoredSession
  ingest(events: unknown[], epoch: number): void
  commit(): void
  adoptConnection(): void
  retire(): void
}

const baseClients = new WeakMap<RelayClient, RelayClient>()

export function sessionLinkBaseClient(client: RelayClient): RelayClient {
  return baseClients.get(client) ?? client
}

/** A route owns its buffering, so preparing a link never pauses the source runtime. */
function routedClient(base: RelayClient) {
  const view = base.createSessionView()
  baseClients.set(view.client, base)
  return view
}

export async function lookupSessionLinkMetadata(client: RelayClient, refs: SessionRef[]): Promise<SessionLinkMetadataResult[]> {
  const result = await client.rpc('session.linkMetadata', { refs }, { timeoutMs: 10_000 }) as { metadata?: SessionLinkMetadataResult[]; error?: string }
  if (result.error) throw new Error(result.error)
  return result.metadata ?? []
}

type SessionLinkOptions = {
  ref: SessionRef
  client: RelayClient
  currentPairingId: string
  pairings: SavedPairing[]
  identity: { deviceId: string; deviceName: string }
  resolveLan(pairingId: string): Promise<LanAddress | null>
  onCandidate(preparation: Pick<SessionLinkPreparation, 'ingest'> | null): void
  isCurrent?(): boolean
}

export interface ResolvedSessionLink {
  /** Must share the session-switch lock with activation, including cleanup. */
  restore(): Promise<SessionLinkPreparation>
  retire(): void
}

/** Connection and read-only preflight never occupy the session-switch lock. */
export async function resolveSessionLink(options: SessionLinkOptions): Promise<ResolvedSessionLink> {
  const { ref } = options
  buildSessionLink(ref)
  const pairing = options.pairings.find(pairing => pairing.environmentId === ref.environmentId && pairing.id !== options.currentPairingId)
  let route: ReturnType<typeof routedClient> | undefined
  let connection: Connection | undefined
  let committed = false
  let adopted = false
  let retired = false
  const assertCurrent = () => {
    if (retired || options.isCurrent?.() === false) throw new Error('Session navigation superseded')
  }
  const retire = () => {
    if (retired || committed || adopted) return
    retired = true
    if (route) {
      options.onCandidate(null)
      void route.client.stopSession().catch(() => {})
    }
    if (connection) closeSideConnection(connection)
  }
  let base = sessionLinkBaseClient(options.client)
  if (pairing) {
    if (!hostLinkOf(pairing)) throw new Error('Pair this desktop again to open its sessions')
    connection = createSideConnection({
      pairing,
      identity: options.identity,
      resolveLan: options.resolveLan,
      onEvents: () => {},
    })
    base = connection.client
  }
  try {
    assertCurrent()
    if (connection && pairing) await connection.dial(await options.resolveLan(pairing.id))
    assertCurrent()
    const identity = await base.rpc('environment.list', {}, { timeoutMs: 10_000 }) as { environmentId?: string; error?: string }
    assertCurrent()
    if (identity.error || !identity.environmentId) throw new Error(identity.error ?? 'This host does not support session links. Upgrade it.')
    if (pairing && identity.environmentId !== pairing.environmentId) throw new Error('Paired host identity changed')
    const result = await base.rpc('session.linkResolve', { ref }) as { target?: SessionLinkTarget; error?: string }
    assertCurrent()
    if (result.error || !result.target) throw new Error(result.error ?? 'Session unavailable')
    if (result.target.ref.environmentId !== ref.environmentId || result.target.ref.sessionId !== ref.sessionId) throw new Error('Session target mismatch')
    const target = result.target
    // The host's authenticated catalog resolves this connection key to the owning environment.
    const hostPath = target.projectPath
    if (!hostPath) throw new Error('Session project is unavailable')
    const workspace = connection ? await readConnectionWorkspace(base) : undefined
    assertCurrent()
    return {
      async restore() {
        try {
          assertCurrent()
          if (route) throw new Error('Session link already restored')
          route = routedClient(base)
          options.onCandidate(route)
          const restored = await restoreSession(route.client, hostPath, ref.sessionId)
          assertCurrent()
          if (restored.snapshot.sourceEnvironmentId !== ref.environmentId) throw new Error('Session owner mismatch')
          return {
            client: route.client, connection, pairing, workspace, target: { ...target, projectPath: hostPath }, restored,
            ingest: route.ingest,
            commit() {
              if (committed || retired) return
              committed = true
              restored.liveBatches.push(...route!.commit()); options.onCandidate(null)
            },
            adoptConnection() { adopted = true },
            retire,
          }
        } catch (error) { retire(); throw error }
      },
      retire,
    }
  } catch (error) {
    retire()
    throw error
  }
}

export async function prepareSessionLink(options: SessionLinkOptions): Promise<SessionLinkPreparation> {
  return (await resolveSessionLink(options)).restore()
}
