import { existsSync, statSync } from 'fs'
import { getDb } from '../database'
import log from '../logger'
import type { Session, SessionManager } from './types'

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
