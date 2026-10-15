/**
 * Desktop host plumbing shared by the collaboration tools: MCP result shape,
 * session titles, and waking a peer session without touching a read-only one.
 */

import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  childStoppedWakeText,
  describeLaunchedPeer,
  describePeerForCaller as describeGrantPeerForCaller,
  linkActivationWakeText,
  mailboxWakeText,
  type CollaborationGrantRow as GrantRow,
  type CollaborationPeer,
} from '@superone/runtime/collaboration'
import { getDb } from '../database'
import { listSessionAgentProfiles } from './agent-profiles'
import { collaborationStore } from './collaboration-mailbox'
import { remoteChildTarget } from './collaboration-remote'
import { collaborationWakeQueue } from './collaboration-wakes'
export { isCollaborationTargetReadOnly, resolveLiveSession } from './collaboration-target'
import type { SessionManager } from './types'

let sessionsChangedListener: (() => void) | null = null

export function setSessionCollaborationCallbacks(callbacks: { sessionsChanged(): void } | null): void {
  sessionsChangedListener = callbacks?.sessionsChanged ?? null
}

export function notifyCollaborationSessionsChanged(): void {
  sessionsChangedListener?.()
}

export function toolResult(value: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }
}

export function errorResult(error: unknown) {
  return toolResult({ status: 'error', message: error instanceof Error ? error.message : String(error) }, true)
}

export function sessionTitle(sessionId: string): string | null {
  const row = getDb().prepare('SELECT title FROM sessions WHERE id = ?')
    .get(sessionId) as { title: string | null } | undefined
  return row?.title ?? null
}

/**
 * Session title for agent-facing text. A child on another machine has no row
 * here, so its launch title stands in; the short id is the last resort.
 */
function sessionLabelTitle(sessionId: string): string {
  const title = sessionTitle(sessionId)?.trim()
  if (title) return title
  const grant = remoteChildTarget(sessionId) ? collaborationStore().spawnGrantForChild(sessionId) : null
  return grant ? describeLaunchedPeer(grant).title : sessionId.slice(0, 8)
}

export function initiatorTitleOf(grant: GrantRow): string {
  return sessionLabelTitle(grant.parent_session_id)
}


export function describePeerForCaller(grant: GrantRow, callerSessionId: string): CollaborationPeer {
  return describeGrantPeerForCaller(grant, callerSessionId, sessionTitle)
}

export function resolveCodexServiceTier(
  agentId: string,
  config: SessionAgentLaunchConfig,
  resolvedProfile?: ReturnType<typeof listSessionAgentProfiles>[number],
): string | null {
  if (!config.fastMode) return null
  if (config.codexServiceTier !== undefined) return config.codexServiceTier
  const profile = resolvedProfile ?? listSessionAgentProfiles().find((item) => item.id === agentId)
  if (profile?.harnessId !== 'codex') return null
  const model = profile.models.find((item) => item.id === config.model)
  return findCodexFastServiceTier(model)?.id ?? null
}

/** Acknowledge after persisting the wake; execution is owned by the inbox consumer. */
function wakeSession(host: SessionManager, sessionId: string, text: string, notificationId: string): void {
  collaborationWakeQueue(host).enqueue(sessionId, notificationId, text)
}

export function wakeCollaborationPeer(host: SessionManager, sessionId: string, fromSessionId: string, messageId: string): void {
  return wakeSession(host, sessionId, mailboxWakeText({ sessionId: fromSessionId, title: sessionLabelTitle(fromSessionId) }), `collab-message:${messageId}`)
}

/** Fallback wake: a spawn child stopped (`status`) without messaging its parent since its last input. */
export function wakeParentOfStoppedChild(
  host: SessionManager,
  parentSessionId: string,
  childSessionId: string,
  status: string,
  stopKey: string,
): void {
  return wakeSession(host, parentSessionId, childStoppedWakeText({
    sessionId: childSessionId,
    title: sessionLabelTitle(childSessionId),
    status,
  }), `collab-stop:${childSessionId}:${stopKey}`)
}

export function wakeLinkPeer(
  host: SessionManager,
  sessionId: string,
  grant: GrantRow,
  hasOpening: boolean,
): void {
  return wakeSession(host, sessionId, linkActivationWakeText({
    initiatorSessionId: grant.parent_session_id,
    initiatorTitle: initiatorTitleOf(grant),
    hasOpening,
  }), `collab-link:${grant.grant_id}`)
}
