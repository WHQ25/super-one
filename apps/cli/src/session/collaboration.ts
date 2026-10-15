/**
 * Credential-scoped Agent collaboration grants + mailbox (desktop parity).
 *
 * Ownership lives on the node SessionRuntime path: grants, messages, and
 * cursors are durable in state.sqlite and survive node restart. The rows,
 * authorization, and agent-facing text come from @superone/runtime/collaboration.
 */

import type { AgentEvent, SessionAgentProfile } from '@superone/shared/agent-types'
import { SESSION_DURABLE_EVENT } from '@superone/shared/environment'
import { isNodeRestartInterruption } from '@superone/shared/session-interruption'
import {
  assertContinuable,
  CollaborationStore,
  CollaborationWakeQueue,
  continueCollaboration,
  parseGrantConfig,
  type ContinuedSessionState,
} from '@superone/runtime/collaboration'
import type { CollaborationContext, CollaborationDeps } from './collaboration-context'
import {
  retrieveCollaborationMessages,
  sendCollaborationMessage,
  type CollaborationRetrieveInput,
  type CollaborationSendInput,
} from './collaboration-messaging'
import { launchedSessionPromptAppend, listCollaborationProfiles } from './collaboration-profiles'
import { requestCollaboration, type CollaborationRequestInput } from './collaboration-request'
import { startCollaboration, type CollaborationStartInput } from './collaboration-start'

export type { CollaborationDeps } from './collaboration-context'

/**
 * Same-environment Agent collaboration service.
 * Replaces the flat collaboration_messages mailbox with grant-scoped tables.
 */
export class CollaborationService {
  private readonly ctx: CollaborationContext
  private readonly unsubscribe: () => void

  constructor(private readonly deps: CollaborationDeps) {
    const wakes = new CollaborationWakeQueue(deps.db, {
      canAdmit: (sessionId) => {
        const session = deps.sessions.get(sessionId)
        if (!session) return true
        if (session.status === 'error' || session.status === 'streaming' || session.pendingInteraction) return false
        if (session.status !== 'interrupted') return true
        // Reconciliation runs before this service subscribes. Recover its
        // durable reason without treating a human stop as a machine restart.
        const latest = deps.db.prepare(`SELECT payload_json FROM environment_events
          WHERE aggregate_type = 'session' AND aggregate_id = ? AND event_type = ?
          ORDER BY sequence DESC LIMIT 1`).get(sessionId, SESSION_DURABLE_EVENT.turnInterrupted) as { payload_json: string } | undefined
        if (!latest) return false
        try { return isNodeRestartInterruption(JSON.parse(latest.payload_json)?.reason) } catch { return false }
      },
      admit: (sessionId, text, requestId, onInputAccepted, beforeInput) => deps.sessions.sendWithoutLease({
        sessionId, text, requestId, source: 'task-notification',
      }, { onInputAccepted, beforeInput }),
      warn: (message) => console.warn(message),
    })
    this.ctx = {
      deps,
      store: new CollaborationStore(deps.db),
      wakes,
      listProfiles: () => this.listProfiles(),
    }
    this.unsubscribe = deps.events.onAppend((event) => {
      if (event.aggregateType !== 'session') return
      const agentEvent = (event.payload as { event?: AgentEvent } | null)?.event
      if (agentEvent) wakes.observe(event.aggregateId, agentEvent)
      if (event.eventType === SESSION_DURABLE_EVENT.turnError) {
        wakes.observe(event.aggregateId, { type: 'message_error', messageId: '', error: 'turn failed' })
      } else if (event.eventType === SESSION_DURABLE_EVENT.turnInterrupted) {
        const reason = (event.payload as { reason?: string } | null)?.reason
        wakes.observe(event.aggregateId, { type: 'message_interrupted', messageId: '', reason })
      } else if (event.eventType === SESSION_DURABLE_EVENT.turnCompleted) {
        wakes.observe(event.aggregateId, { type: 'message_complete', messageId: '' })
      }
      if (!event.ephemeral) wakes.start()
    })
    wakes.start()
  }

  dispose(): void { this.unsubscribe(); this.ctx.wakes.dispose() }

  /** Agent profiles from session_providers (+ ready-harness fallback). */
  isSpawnChild(sessionId: string): boolean { return this.ctx.store.isSpawnChild(sessionId) }

  listProfiles(): SessionAgentProfile[] {
    return listCollaborationProfiles(this.deps)
  }

  request(input: CollaborationRequestInput) {
    return requestCollaboration(this.ctx, input)
  }

  start(input: CollaborationStartInput) {
    return startCollaboration(this.ctx, input)
  }

  send(input: CollaborationSendInput) {
    return sendCollaborationMessage(this.ctx, input)
  }

  retrieve(input: CollaborationRetrieveInput) {
    return retrieveCollaborationMessages(this.ctx, input)
  }

  /** The session `sessionId` was continued in; null when it was not. */
  successorOf(sessionId: string): string | null { return this.ctx.store.successorOf(sessionId) }

  /** Throws when `from` cannot be continued in a new session now. */
  assertContinuable(from: string): void {
    assertContinuable(this.ctx.store, this.ctx.wakes, from, this.continuedState(from))
  }

  /**
   * `to` was just created to continue `from`: it takes over `from`'s channels
   * and wakes, and the child prompt moves with a spawn grant.
   */
  continueSession(from: string, to: string): void {
    continueCollaboration(this.ctx.store, this.ctx.wakes, from, to, this.continuedState(from))
    const grant = this.ctx.store.spawnGrantForChild(to)
    if (grant) {
      this.deps.sessions.setSystemPromptAppend(to, launchedSessionPromptAppend(this.deps, grant))
      this.deps.sessions.setSystemPromptAppend(from, null)
    }
  }

  private continuedState(sessionId: string): ContinuedSessionState | null {
    const session = this.deps.sessions.get(sessionId)
    return session ? { busy: session.status === 'streaming' || session.pendingInteraction != null } : null
  }

  /** Reconstruct the system-prompt append of launched sessions after restart (never link). */
  rehydrateSystemPrompts(): void {
    const launched = [
      ...this.ctx.store.startedSpawnGrants().map((grant) => ({ grant, sessionId: grant.child_session_id })),
      ...this.ctx.store.startedHandoffGrants().map((grant) => ({
        grant,
        sessionId: parseGrantConfig<{ handoffSessionId?: string }>(grant.config_json).handoffSessionId,
      })),
    ]
    for (const { grant, sessionId } of launched) {
      if (!sessionId || !this.deps.sessions.get(sessionId)) continue
      this.deps.sessions.setSystemPromptAppend(sessionId, launchedSessionPromptAppend(this.deps, grant))
    }
  }
}

/** @deprecated Use CollaborationService. Kept as a type alias for gradual migration. */
export type CollaborationMailbox = CollaborationService
