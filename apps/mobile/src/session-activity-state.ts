import type { SessionActivity } from '@superone/shared/session-activity'

export type MobileSessionActivity = SessionActivity & { isUnseen?: boolean }
export type WorkspaceActivity = Readonly<Record<string, MobileSessionActivity>>

export function mergeSessionActivity(
  previous: MobileSessionActivity | undefined,
  incoming: SessionActivity,
  viewedSessionId: string | null,
  completed = false,
): MobileSessionActivity {
  const idle = incoming.status === 'idle' || incoming.status === 'ended'
  const newCompletion = idle && (
    (incoming.completedMessageId != null && previous !== undefined && incoming.completedMessageId !== previous.completedMessageId)
    || (completed && (!previous || ['running', 'streaming', 'starting', 'interrupting', 'background'].includes(previous.status)))
  )
  return { ...incoming, isUnseen: incoming.sessionId !== viewedSessionId && (!!previous?.isUnseen || newCompletion) }
}

/** Running and background states take precedence, as in the desktop sidebar. */
export function sessionActivityIconStatus(session: { status?: string; isUnseen?: boolean }): string | undefined {
  if (['running', 'streaming', 'starting', 'interrupting', 'background'].includes(session.status ?? '')) return session.status
  return session.isUnseen ? 'unseen' : session.status
}

/** A project row stays open enough to show work that is waiting on the user. */
export function projectHasAttention(activity: WorkspaceActivity, projectPath: string): boolean {
  return Object.values(activity).some((session) =>
    session.projectPath === projectPath && ((session.pendingCount ?? 0) > 0 || !!session.isUnseen))
}
