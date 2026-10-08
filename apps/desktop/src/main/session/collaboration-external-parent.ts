/**
 * A collaboration child launched here by a session on another machine. Its
 * mailbox belongs to that parent, so its `session_collab_send/retrieve` run on
 * the parent's machine as Host Actions, and it may not launch children itself.
 */

import { hostActionToolReply, type HostActionToolReply } from '@superone/shared/environment'
import { getDb } from '../database'
import { parseRemoteController } from '../db-remote-controlled-sessions'

export function hasExternalParent(sessionId: string): boolean {
  const row = getDb().prepare('SELECT remote_controller_json FROM sessions WHERE id = ?')
    .get(sessionId) as { remote_controller_json: string | null } | undefined
  return !!parseRemoteController(row?.remote_controller_json)?.externalParent
}

/** The parent machine's reply to a mailbox tool call of `sessionId`; null when its parent is local. */
export async function forwardToExternalParent(
  sessionId: string,
  toolName: 'session_collab_send' | 'session_collab_retrieve',
  args: unknown,
  signal?: AbortSignal,
): Promise<HostActionToolReply | null> {
  if (!hasExternalParent(sessionId)) return null
  const { requestControllerHostAction } = await import('../node-host/node-host-controller')
  try {
    return hostActionToolReply(await requestControllerHostAction({ sessionId, toolName, args: args ?? {}, signal }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'error', message }) }], isError: true }
  }
}
