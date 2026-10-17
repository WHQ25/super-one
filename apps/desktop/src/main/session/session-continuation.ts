/**
 * A desktop session continued in a new one hands it its collaboration
 * channels (docs/features/session-continuation.md). Session create checks
 * before doing any work and moves the channels as its last step, so a failed
 * create leaves them with the old session.
 */

import {
  assertContinuable,
  CollaborationError,
  continueCollaboration,
  type ContinuedSessionState,
} from '@superone/runtime/collaboration'
import type { PermissionMode, SandboxMode } from '@superone/shared/agent-types'
import { collaborationStore, notifyCollaborationMailboxChanged } from './collaboration-mailbox'
import { getDb } from '../database'
import { parseRemoteController, setSessionRemoteController, type RemoteControllerRecord } from '../db-remote-controlled-sessions'
import { notifyCollaborationSessionsChanged } from './collaboration-host'
import { startedCollaborationWakeQueue } from './collaboration-wakes'
import { getSessionCollaborationRunConfig, getSessionCollaborationSystemPrompt } from './session-collaboration'
import type { Session } from './types'

/** The session being continued as its host sees it: loaded, and whether its row exists. */
export interface ContinuedSession {
  live: Session | null
  stored: boolean
}

function stateOf({ live, stored }: ContinuedSession): ContinuedSessionState | null {
  if (live) {
    const activity = live.activityStatus()
    return { busy: (activity !== 'idle' && activity !== 'error') || live.getPendingInteractions().length > 0 }
  }
  return stored ? { busy: false } : null
}

function wakes() {
  const queue = startedCollaborationWakeQueue()
  if (!queue) throw new CollaborationError('Collaboration is still starting; try again', 'failed_precondition')
  return queue
}

/**
 * A child working for a collaboration on another device has its channel
 * there: only that device continues it (`requester`, the creating
 * controller's client id), and the successor's create carries the parent.
 */
function assertOwnedHere(from: string, requester: string | null): void {
  const controller = controllerOf(from)
  if (!controller?.externalParent || (requester && controller.clientSessionId === requester)) return
  throw new CollaborationError(
    'This session works for a collaboration started on another device; continue it from that device',
    'failed_precondition',
  )
}

function controllerOf(sessionId: string): RemoteControllerRecord | null {
  const row = getDb().prepare('SELECT remote_controller_json FROM sessions WHERE id = ?')
    .get(sessionId) as { remote_controller_json: string | null } | undefined
  return parseRemoteController(row?.remote_controller_json)
}

/** The continued child of another device's session is a plain session now. */
function dropExternalParent(from: string): void {
  const record = controllerOf(from)
  if (!record?.externalParent) return
  const { externalParent: _parent, systemPromptAppend: _prompt, ...controller } = record
  setSessionRemoteController(from, controller)
}

/** What session create needs to continue a session; loaded on first use. */
export interface DesktopContinuations {
  /** `requester`: the controller's client id when another device creates the successor here. */
  assert(from: string, source: ContinuedSession, requester: string | null): void
  /** Record the continuation and move `from`'s channels and wakes to `to`, whose row exists. */
  continue(from: string, to: string, source: ContinuedSession, requester: string | null): void
  /**
   * The collaboration prompt and approved run settings `sessionId` runs with
   * as a spawn child, which its successor inherits; null for any other session.
   */
  launch(sessionId: string): { systemPromptAppend?: string; permissionMode?: PermissionMode; sandboxMode?: SandboxMode; codexPermissionPreset?: import('@superone/shared/agent-types').CodexPermissionPreset } | null
}

export const desktopContinuations: DesktopContinuations = {
  assert: (from, source, requester) => {
    assertOwnedHere(from, requester)
    assertContinuable(collaborationStore(), wakes(), from, stateOf(source))
  },
  continue: (from, to, source, requester) => {
    assertOwnedHere(from, requester)
    const moved = continueCollaboration(collaborationStore(), wakes(), from, to, stateOf(source))
    dropExternalParent(from)
    if (moved.length === 0) return
    notifyCollaborationSessionsChanged()
    notifyCollaborationMailboxChanged(from)
    notifyCollaborationMailboxChanged(to)
  },
  launch: (sessionId) => {
    const systemPromptAppend = getSessionCollaborationSystemPrompt(sessionId)
    if (!systemPromptAppend) return null
    const config = getSessionCollaborationRunConfig(sessionId)
    return {
      systemPromptAppend,
      ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
      ...(config?.sandboxMode ? { sandboxMode: config.sandboxMode } : {}),
      ...(config?.codexPermissionPreset ? { codexPermissionPreset: config.codexPermissionPreset } : {}),
    }
  },
}
