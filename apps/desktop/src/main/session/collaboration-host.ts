/**
 * Desktop host plumbing shared by the collaboration tools: MCP result shape,
 * session titles, and waking a peer session without touching a read-only one.
 */

import { existsSync, statSync } from 'fs'
import type { SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { findCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  describePeerForCaller as describeGrantPeerForCaller,
  linkActivationWakeText,
  mailboxWakeText,
  type CollaborationGrantRow as GrantRow,
  type CollaborationPeer,
} from '@superone/runtime/collaboration'
import { getDb } from '../database'
import log from '../logger'
import { listSessionAgentProfiles } from './agent-profiles'
import type { Session, SessionManager } from './types'

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

export function initiatorTitleOf(grant: GrantRow): string {
  return sessionTitle(grant.parent_session_id)?.trim() || grant.parent_session_id.slice(0, 8)
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

/** Resolve a live session, resuming a passive one when the process has released it. */
export function resolveLiveSession(host: SessionManager, sessionId: string): Session | null {
  const live = host.getSession(sessionId)
  if (live) return live
  try {
    return host.resumeSession(sessionId, { passive: true })
  } catch (error) {
    log.debug(
      '[session-collaboration] resumeSession failed sid=%s: %s',
      sessionId,
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

/**
 * UI withdraws the composer when a worktree checkout is gone. Collab must not
 * resume/inject a turn into that session (it would run against the fallback
 * project checkout).
 */
export function isCollaborationTargetReadOnly(sessionId: string, live: Session | null): boolean {
  if (live?.snapshot.worktreeMissing) return true
  if (live?.snapshot.isWorktree) {
    const dir = live.cwd
    if (dir && (!existsSync(dir) || !statSync(dir).isDirectory())) return true
  }
  const row = getDb().prepare('SELECT worktree_path FROM sessions WHERE id = ?')
    .get(sessionId) as { worktree_path: string | null } | undefined
  const stored = row?.worktree_path?.trim()
  if (!stored) return false
  try {
    return !existsSync(stored) || !statSync(stored).isDirectory()
  } catch {
    return true
  }
}

/** Start a host turn in `sessionId`; queues behind an in-flight turn. Best-effort. */
async function wakeSession(host: SessionManager, sessionId: string, text: string): Promise<void> {
  const session = resolveLiveSession(host, sessionId)
  if (!session) {
    log.debug('[session-collaboration] peer not available for wake sid=%s', sessionId)
    return
  }
  if (isCollaborationTargetReadOnly(sessionId, session)) {
    log.debug('[session-collaboration] skip wake; worktree removed sid=%s', sessionId)
    return
  }
  try {
    await session.injectTaskNotification(text)
  } catch (error) {
    log.warn(
      '[session-collaboration] wake failed sid=%s: %s',
      sessionId,
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function wakeCollaborationPeer(host: SessionManager, sessionId: string, fromSessionId: string): Promise<void> {
  const fromTitle = sessionTitle(fromSessionId)?.trim() || fromSessionId.slice(0, 8)
  return wakeSession(host, sessionId, mailboxWakeText({ sessionId: fromSessionId, title: fromTitle }))
}

export function wakeLinkPeer(
  host: SessionManager,
  sessionId: string,
  grant: GrantRow,
  hasOpening: boolean,
): Promise<void> {
  return wakeSession(host, sessionId, linkActivationWakeText({
    initiatorSessionId: grant.parent_session_id,
    initiatorTitle: initiatorTitleOf(grant),
    hasOpening,
  }))
}
