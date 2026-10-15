/**
 * Continuing a spawn child that runs on another machine
 * (docs/features/session-continuation.md). Its node creates the successor and
 * moves the child's parent link to it; this desktop holds the grant, so it
 * moves the channel and points the child watch at the successor's events.
 */

import {
  assertContinuable,
  CollaborationError,
  collaborationSystemPrompt,
  continueCollaboration,
  parseGrantConfig,
  type ContinuedSessionState,
} from '@superone/runtime/collaboration'
import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { getDb } from '../database'
import { createSession as createSessionRecord, hideSession } from '../db-sessions'
import { collaborationStore, notifyCollaborationMailboxChanged } from './collaboration-mailbox'
import { notifyCollaborationSessionsChanged } from './collaboration-host'
import { remoteChildState, remotePort } from './collaboration-remote'
import { startedCollaborationWakeQueue } from './collaboration-wakes'

/** What the node's create needs so the successor runs as the child. */
export interface RemoteChildLaunch {
  systemPromptAppend: string
  externalParent: { sessionId: string }
}

function wakes() {
  const queue = startedCollaborationWakeQueue()
  if (!queue) throw new CollaborationError('Collaboration is still starting; try again', 'failed_precondition')
  return queue
}

/**
 * Continue remote child `from` through `create` on its machine (`connectionId`),
 * then move its channel to the created session. Checks before creating.
 */
export async function continueRemoteChild<T extends { sessionId: string }>(
  connectionId: string,
  from: string,
  create: (launch: RemoteChildLaunch) => Promise<T>,
): Promise<T> {
  const store = collaborationStore()
  const grant = store.spawnGrantForChild(from)
  const remote = grant ? parseGrantConfig(grant.config_json).remote : undefined
  if (!grant || !remote) throw new CollaborationError(`${from} is not a remote collaboration child`, 'failed_precondition')
  const node = await remoteChildState(from)
  if (!node) throw new CollaborationError(`${remote.label} cannot be reached; continue the session once it is back`, 'failed_precondition')
  const state: ContinuedSessionState = { busy: node.status === 'streaming' || node.pendingInteraction != null }
  assertContinuable(store, wakes(), from, state)

  // Successor events start after this point; the old child's run stays with it.
  const eventCursor = await (await remotePort()).eventHead(connectionId)
  const created = await create({
    systemPromptAppend: collaborationSystemPrompt(grant.parent_session_id),
    externalParent: { sessionId: grant.parent_session_id },
  })
  // The mailbox keys endpoints by local rows: a hidden one, as for the child it continues.
  const row = getDb().prepare(`
    SELECT s.title, p.path AS project_path FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?
  `).get(from) as { title: string | null; project_path: string } | undefined
  if (row) {
    createSessionRecord(row.project_path, created.sessionId, row.title ?? undefined)
    hideSession(created.sessionId, true)
  }
  continueCollaboration(store, wakes(), from, created.sessionId, state)
  const config = parseGrantConfig<SessionAgentLaunchConfig>(grant.config_json)
  const { run: _run, ...rest } = remote
  store.updateConfig(grant.grant_id, { ...config, remote: { ...rest, eventCursor } })
  notifyCollaborationSessionsChanged()
  notifyCollaborationMailboxChanged(from)
  notifyCollaborationMailboxChanged(created.sessionId)
  return created
}
