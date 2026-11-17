import { dirname, join } from 'node:path'
import { createMcpAppResourceStore } from '@superone/runtime/mcp-apps/resource-store'
/**
 * CLI SessionRuntime: wires SQLite store + EventLog + ControlLeaseService into
 * `@superone/runtime/session`. Prefer importing types from the core package.
 */

import {
  SessionRuntime as CoreSessionRuntime,
  sessionReadModel,
  createSqliteHostActionStore,
  createSqliteSessionStore,
  type LeaseGuard,
  type SessionEventLog,
  type TurnRunner,
} from '@superone/runtime/session'
import { NodeScheduledSends } from './scheduled-sends'
import type { ScheduledSendPatch } from '@superone/shared/agent-types'
import type { NodeDatabase } from '../db/database'
import type { ControlLeaseService } from '@superone/runtime/lease'
import type { EventLog } from '@superone/runtime/session'

export {
  createSimulatedCodexRunner,
  createSimulatedTurnRunner,
  type NodeSessionRecord,
  type PendingInteraction,
  type PermissionDecision,
  type SessionStatus,
  type SessionTurnEvent,
  type TranscriptBlock,
  type TurnRunner,
  type LeaseGuard,
  type SessionEventLog,
  type SessionStore,
} from '@superone/runtime/session'

/**
 * Drop-in constructor matching the historical `(db, events, leases, …)` signature.
 * Wires SQLite session store + durable host action store, and the read model
 * the event log applies every event to before publishing it.
 */
export class SessionRuntime extends CoreSessionRuntime {
  readonly scheduledSends: NodeScheduledSends

  constructor(
    db: NodeDatabase,
    events: EventLog & SessionEventLog,
    leases: ControlLeaseService & LeaseGuard,
    environmentId: string,
    turnRunner: TurnRunner,
    opts?: {
      defaultApiProviderId?: (harnessId: string) => string | null
      controllerLabel?: (clientSessionId: string) => string | null
    },
  ) {
    super(createSqliteSessionStore(db), events, leases, environmentId, turnRunner, {
      ...opts,
      hostActions: createSqliteHostActionStore(db),
      readModel: sessionReadModel(db, events),
      ...(db.name !== ':memory:' ? { mcpAppResources: createMcpAppResourceStore(join(dirname(db.name), 'mcp-app-resources')) } : {}),
    })
    this.scheduledSends = new NodeScheduledSends(db, this)
  }

  override get servedOperations(): ReadonlySet<string> {
    return new Set([...super.servedOperations, 'session.scheduledSend.get', 'session.scheduledSend.set',
      'session.scheduledSend.clear', 'sessionList.scheduledSends'])
  }

  override async callOperation(sessionId: string, method: string, input: Record<string, unknown>, assertControl = () => {}) {
    if (method === 'session.scheduledSend.get') return this.scheduledSends.get(sessionId)
    if (method === 'session.scheduledSend.clear') {
      assertControl()
      return this.scheduledSends.clear(sessionId)
    }
    if (method === 'session.scheduledSend.set') {
      assertControl()
      const session = this.get(sessionId)
      if (!session || session.closed) throw Object.assign(new Error('session is closed'), { code: 'failed_precondition' })
      return this.scheduledSends.set(sessionId, input.patch as ScheduledSendPatch)
    }
    return super.callOperation(sessionId, method, input, assertControl)
  }

  callListOperation(method: string) {
    if (method === 'sessionList.scheduledSends') return this.scheduledSends.list()
    throw Object.assign(new Error(`Unsupported session list operation: ${method}`), { code: 'unsupported' })
  }

  override close(sessionId: string) {
    super.close(sessionId)
    this.scheduledSends.clear(sessionId)
  }
}
