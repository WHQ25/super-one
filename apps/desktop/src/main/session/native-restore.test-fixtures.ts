import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment'
import { ConnectionDelivery, deliveryPolicy } from '@superone/runtime/stream'
import { deliverLoad } from '@superone/runtime/server/session-delivery'
import { DesktopSessionReads } from '../node-host/desktop-session-reads'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import type { Session } from './types'
import { desktopRestorePorts } from './session-restore-ports'

/** Run the production desktop atomic read and delivery boundary, with an in-memory catalog. */
export async function nativeSessionLoad(session: Session | null, delivery = new ConnectionDelivery(deliveryPolicy('relay', 'phone')), history: ChatMessage[] = []): Promise<SessionLoadResult> {
  const row = { sessionId: 'session', projectId: 'p', projectPath: '/project', harnessId: session?.snapshot.harnessId ?? 'claude' } as DesktopSessionRow
  class Reads extends DesktopSessionReads<DesktopSessionRow> {}
  const reads = new Reads({ environmentId: 'desktop', restore: desktopRestorePorts,
    sessions: { getSession: () => session, onSession: () => () => {} } as never,
    rows: { get: () => row, list: () => [row], loadMessages: () => ({ messages: history, cursor: null, hasMore: false }) },
    events: { headSequence: () => '0', epoch: 'epoch', sessionVersion: () => 0 } as never })
  return deliverLoad(await reads.load({ sessionId: 'session' }), delivery)
}

export function nativeLoadFixture(state: Record<string, unknown>, messages: ChatMessage[] = [], activeTurn: ChatMessage[] = []): SessionLoadResult {
  return { sessionId: 'session', state, messages, ...(activeTurn.length ? { activeTurn } : {}), before: null, after: null,
    cursor: { sequence: '10', version: 10, epoch: 'epoch' } }
}

/** Native mobile runtime fixture; real encrypted admission/fencing has its own endpoint contracts. */
export function nativeRestoreClient(load: () => Promise<SessionLoadResult> | SessionLoadResult, batches: () => AgentEvent[][] = () => []) {
  const sent: Array<Record<string, unknown>> = []
  const rpc = async (method: string) => method === 'session.load' ? load()
    : method === 'environment.descriptor' ? { capabilities: { methods: [] } } : { ok: true }
  return { environmentId: 'desktop', sent, rpc,
    resolveProject: async () => ({ environmentId: 'desktop', projectId: 'p' }),
    acquireControl: async () => {}, followSession: async () => {}, stopSession: async () => {},
    startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: batches() }),
    controlledRpc: async (_resource: unknown, method: string, payload: Record<string, unknown>) => { sent.push({ method, ...payload }); return { ok: true } },
  }
}
