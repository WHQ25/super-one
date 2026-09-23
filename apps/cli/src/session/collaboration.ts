/**
 * Credential-scoped Agent collaboration grants + mailbox (desktop parity).
 *
 * Ownership lives on the node SessionRuntime path: grants, messages, and
 * cursors are durable in state.sqlite and survive node restart. The rows,
 * authorization, and agent-facing text come from @superone/runtime/collaboration.
 */

import type { SessionAgentProfile } from '@superone/shared/agent-types'
import { CollaborationStore, collaborationSystemPrompt } from '@superone/runtime/collaboration'
import type { CollaborationContext, CollaborationDeps } from './collaboration-context'
import {
  retrieveCollaborationMessages,
  sendCollaborationMessage,
  type CollaborationRetrieveInput,
  type CollaborationSendInput,
} from './collaboration-messaging'
import { listCollaborationProfiles } from './collaboration-profiles'
import { requestCollaboration, type CollaborationRequestInput } from './collaboration-request'
import { startCollaboration, type CollaborationStartInput } from './collaboration-start'

export type { CollaborationSecretCrypto } from '@superone/runtime/collaboration'
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
      store: new CollaborationStore(deps.db, deps.secrets),
      listProfiles: () => this.listProfiles(),
    }
  }

  /** Agent profiles from session_providers (+ ready-harness fallback). */
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

  /** Reconstruct system-prompt append for spawn children after restart (never link). */
  rehydrateSystemPrompts(): void {
    for (const grant of this.ctx.store.startedSpawnGrants()) {
      if (!grant.child_session_id || !this.deps.sessions.get(grant.child_session_id)) continue
      this.deps.sessions.setSystemPromptAppend(grant.child_session_id, collaborationSystemPrompt(grant.parent_session_id))
    }
  }
}

/** @deprecated Use CollaborationService. Kept as a type alias for gradual migration. */
export type CollaborationMailbox = CollaborationService
