/**
 * Credential-scoped Agent collaboration grants + mailbox (desktop parity).
 *
 * Ownership lives on the node SessionRuntime path: grants, messages, and
 * cursors are durable in state.sqlite and survive node restart. The rows,
 * authorization, and agent-facing text come from @superone/runtime/collaboration.
 */

import type { SessionAgentProfile } from '@superone/shared/agent-types'
import { CollaborationStore, parseGrantConfig } from '@superone/runtime/collaboration'
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

  constructor(private readonly deps: CollaborationDeps) {
    this.ctx = {
      deps,
      store: new CollaborationStore(deps.db),
      listProfiles: () => this.listProfiles(),
    }
  }

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
