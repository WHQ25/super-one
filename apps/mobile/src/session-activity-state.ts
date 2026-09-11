import type { SessionActivity } from '@superone/shared/session-activity'

export type MobileSessionActivity = SessionActivity & { isUnseen?: boolean }
export type WorkspaceActivity = Readonly<Record<string, MobileSessionActivity>>

/**
 * Statuses that keep a session reachable in a collapsed project, matching
 * desktop `isLiveSession` (`streaming` / `background` / `awaitingAssistantReply`)
 * plus the host statuses mobile actually receives.
 */
export const LIVE_SESSION_STATUSES: ReadonlySet<string> = new Set([
  'running',
  'streaming',
  'starting',
  'interrupting',
  'background',
])

function sessionNeedsAttention(session: Pick<MobileSessionActivity, 'pendingCount' | 'isUnseen'>): boolean {
  return session.pendingCount > 0 || !!session.isUnseen
}

/**
 * Desktop's collapsed-project predicate: live work, unread completions, and
 * anything waiting on the user. The header badge stays narrower
 * (`countAttentionSessions`) so a running turn does not light a red dot.
 */
export function sessionIsLive(session: {
  status?: string
  pendingCount?: number
  isUnseen?: boolean
}): boolean {
  return sessionNeedsAttention({
    pendingCount: session.pendingCount ?? 0,
    isUnseen: session.isUnseen,
  }) || LIVE_SESSION_STATUSES.has(session.status ?? '')
}

/** Count sessions, even when one session has several requests and an unread reply. */
export function countAttentionSessions(activity: WorkspaceActivity): number {
  return Object.values(activity).filter(sessionNeedsAttention).length
}

export function mergeSessionActivity(
  previous: MobileSessionActivity | undefined,
  incoming: SessionActivity,
  viewedSessionId: string | null,
  completed = false,
): MobileSessionActivity {
  const idle = incoming.status === 'idle' || incoming.status === 'ended'
  const newCompletion = idle && (
    (incoming.completedMessageId != null && previous !== undefined && incoming.completedMessageId !== previous.completedMessageId)
    || (completed && (!previous || LIVE_SESSION_STATUSES.has(previous.status)))
  )
  return { ...incoming, isUnseen: incoming.sessionId !== viewedSessionId && (!!previous?.isUnseen || newCompletion) }
}

/** Running and background states take precedence, as in the desktop sidebar. */
export function sessionActivityIconStatus(session: { status?: string; isUnseen?: boolean }): string | undefined {
  if (LIVE_SESSION_STATUSES.has(session.status ?? '')) return session.status
  return session.isUnseen ? 'unseen' : session.status
}

/** A project row stays open enough to show live, unseen, and pending work. */
export function projectHasAttention(activity: WorkspaceActivity, projectPath: string): boolean {
  return Object.values(activity).some((session) =>
    session.projectPath === projectPath && sessionIsLive(session))
}
