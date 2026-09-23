import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { CollaborationError } from './errors'
import {
  collaborationSessionTitle,
  deriveCollaborationName,
  deriveCollaborationRole,
  parseGrantConfig,
} from './launch'
import type { CollaborationGrantRow } from './store'
import { HANDOFF_NO_MAILBOX } from './text'

export const MAX_MAILBOX_CONTENT = 100_000
export const MAX_MESSAGES_PER_RETRIEVE = 100

export interface CollaborationPeer {
  name: string
  role: string
  title: string
  sessionId?: string
}

/** Human-facing identity of the launched side of a grant (agent-chosen, not the harness). */
export function describeLaunchedPeer(grant: CollaborationGrantRow): {
  name: string
  role: string
  title: string
  agentId: string
  config: SessionAgentLaunchConfig
} {
  const config = parseGrantConfig(grant.config_json)
  const name = deriveCollaborationName({ name: config.name })
  const role = deriveCollaborationRole({ role: config.role, task: grant.task })
  return { name, role, title: collaborationSessionTitle(name, role), agentId: grant.agent_id, config }
}

/** The other endpoint of `grant`, as seen by `callerSessionId`. */
export function describePeerForCaller(
  grant: CollaborationGrantRow,
  callerSessionId: string,
  sessionTitle: (sessionId: string) => string | null,
): CollaborationPeer {
  if (callerSessionId === grant.child_session_id) {
    return {
      name: 'Parent',
      role: '',
      title: sessionTitle(grant.parent_session_id) || 'Parent',
      sessionId: grant.parent_session_id,
    }
  }
  const child = describeLaunchedPeer(grant)
  return {
    name: child.name,
    role: child.role,
    title: child.title,
    ...(grant.child_session_id ? { sessionId: grant.child_session_id } : {}),
  }
}

/** Handoff grants are never a channel, so neither side may read or write their mailbox. */
export function assertMailboxEndpoint(grant: CollaborationGrantRow, callerSessionId: string): void {
  if (grant.kind === 'handoff') throw new CollaborationError(HANDOFF_NO_MAILBOX, 'failed_precondition')
  if (callerSessionId !== grant.parent_session_id && callerSessionId !== grant.child_session_id) {
    throw new CollaborationError('This credential does not authorize the current session', 'forbidden')
  }
}

/** Authorize a send from `callerSessionId` and return the recipient session id. */
export function resolveMailboxRecipient(grant: CollaborationGrantRow, callerSessionId: string): string {
  assertMailboxEndpoint(grant, callerSessionId)
  if (!grant.child_session_id) {
    throw new CollaborationError(
      grant.kind === 'link' ? 'The linked peer session is missing' : 'The child session has not been started',
      'failed_precondition',
    )
  }
  // Link grants bind the peer at approval; the mailbox opens on start.
  if (grant.kind === 'link' && !grant.started_at) {
    throw new CollaborationError('The collaboration link has not been started', 'failed_precondition')
  }
  return callerSessionId === grant.parent_session_id ? grant.child_session_id : grant.parent_session_id
}

export function normalizeMailboxContent(raw: unknown): string {
  const content = typeof raw === 'string' ? raw.trim() : ''
  if (!content) throw new CollaborationError('content must not be empty', 'invalid_argument')
  if (content.length > MAX_MAILBOX_CONTENT) {
    throw new CollaborationError('content may contain at most 100,000 characters', 'invalid_argument')
  }
  return content
}
