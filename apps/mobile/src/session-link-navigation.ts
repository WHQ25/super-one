import { hostLinkOf, restoreSession, type RelayClient, type SavedPairing, type RestoredSession } from '@superone/relay-client'
import type { LanAddress } from './device-discovery'
import type { SessionRef } from '@superone/shared/environment/refs'
import type { RemoteCommand } from '@superone/shared/agent-types'
import type { SessionLinkTarget, SessionLinkMetadataResult } from '@superone/shared/session-link'
import { closeSideConnection, createSideConnection, type SideConnection } from './side-connection'
import { randomId } from './ids'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
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
function routedClient(base: RelayClient, environmentId: string | null, sessionId: string) {
  let epoch = base.buffer.epoch
  const batches: unknown[][] = []
  let preparing = true
  const wrap = (command: RemoteCommand): RemoteCommand => {
    if (command.type.startsWith('session_link_')) return command
    const scoped = command.type === 'subscribe_session' ? { ...command, preserveSubscriptions: preparing } : command
    return environmentId ? { type: 'environment_command', environmentId, sessionId, command: scoped, ...('requestId' in command ? { requestId: command.requestId } : {}) } : scoped
  }
  const proxy = new Proxy(base, { get(target, property) {
    if (property === 'request') return (command: RemoteCommand, timeout?: number) => target.request(wrap(command), timeout)
    if (property === 'send') return (command: RemoteCommand) => target.send(wrap(command))
    if (property === 'startBuffering') return () => { if (!preparing) base.startBuffering() }
    if (property === 'releaseBuffer') return () => preparing ? { epoch, batches: batches.splice(0) } : base.releaseBuffer()
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  baseClients.set(proxy, base)
  return { client: proxy, ingest(events: unknown[], nextEpoch: number) { if (preparing) { epoch = nextEpoch; batches.push(events) } }, commit() { preparing = false; return batches.splice(0) } }
}

export async function lookupSessionLinkMetadata(client: RelayClient, refs: SessionRef[]): Promise<SessionLinkMetadataResult[]> {
  const result = await client.request({ type: 'session_link_metadata', requestId: randomId(), refs }, 10_000) as { metadata?: SessionLinkMetadataResult[]; error?: string }
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
      route.commit()
      try { route.client.send({ type: 'unsubscribe_session', sessionId: ref.sessionId }) } catch { /* transport already gone */ }
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
      onEvents: (events, epoch) => route?.ingest(events, epoch),
    })
    base = connection.client
  }
  try {
    assertCurrent()
    if (connection && pairing) await connection.dial(await options.resolveLan(pairing.id))
    assertCurrent()
    const identity = await base.request({ type: 'session_link_identity', requestId: randomId() }, 10_000) as { environmentId?: string; error?: string }
    assertCurrent()
    if (identity.error || !identity.environmentId) throw new Error(identity.error ?? 'This host does not support session links. Upgrade it.')
    if (pairing && identity.environmentId !== pairing.environmentId) throw new Error('Paired host identity changed')
    const result = await base.request({ type: 'session_link_resolve', requestId: randomId(), ref }) as { target?: SessionLinkTarget; error?: string }
    assertCurrent()
    if (result.error || !result.target) throw new Error(result.error ?? 'Session unavailable')
    if (result.target.ref.environmentId !== ref.environmentId || result.target.ref.sessionId !== ref.sessionId) throw new Error('Session target mismatch')
    const target = result.target
    // Desktop project keys are client-local. The phone's gateway uses the owning host path.
    const hostPath = target.connectionId ? parseRemoteProjectKey(target.projectPath)?.path : target.projectPath
    if (!hostPath) throw new Error('Session project is unavailable')
    const workspace = connection ? await readConnectionWorkspace(base) : undefined
    assertCurrent()
    return {
      async restore() {
        try {
          assertCurrent()
          if (route) throw new Error('Session link already restored')
          route = routedClient(base, identity.environmentId === ref.environmentId ? null : ref.environmentId, ref.sessionId)
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
