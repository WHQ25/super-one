import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { AppState } from 'react-native'
import { completionSeen, countAttentionSessions, mergeSessionActivity, type MobileSessionActivity, type WorkspaceActivity } from '../session-activity-state'
import { randomId } from '../ids'

export const SessionActivityContext = createContext<WorkspaceActivity>({})
export const useSessionActivity = (sessionId: string) => useContext(SessionActivityContext)[sessionId]

/**
 * Independent of the open chat and drawer; reconnect replaces stale summaries.
 *
 * Only a (re)connect reads the full snapshot. Everything after arrives pushed as
 * `session_activity`, so a session-list change (rename, pin, a new row) is not
 * a reason to ask for it again — it used to be, and every such change cost one
 * more round trip on top of the list re-read.
 */
export function useWorkspaceActivity(client: RelayClient | null, connected: boolean, viewedSessionId: string | null = null) {
  const [sessions, setSessions] = useState<Record<string, MobileSessionActivity>>({})
  const latest = useRef(sessions)
  latest.current = sessions
  const updates = useRef<Record<string, SessionActivity>>({})
  const viewed = useRef(viewedSessionId)
  viewed.current = viewedSessionId
  const visibleSession = useCallback(() => AppState.currentState === 'background' || AppState.currentState === 'inactive' ? null : viewed.current, [])
  /**
   * Tell the host this completion was read here, so the desktop sidebar (and
   * any other phone) drops its dot too. Best-effort: the local flag is already
   * cleared, the host echoes the receipt back on `session_activity`, and a
   * receipt lost to a dead socket is re-sent from the reconnect snapshot below.
   */
  const reportSeen = useCallback((activity: Pick<SessionActivity, 'sessionId' | 'projectPath' | 'completedMessageId' | 'seenCompletedMessageId'>) => {
    if (!client || completionSeen(activity)) return
    try {
      client.send({ type: 'mark_session_seen', projectPath: activity.projectPath, sessionId: activity.sessionId })
    } catch {
      // `send` throws while the socket is down (app resumed before reconnect).
    }
  }, [client])
  useEffect(() => {
    const clearViewed = () => {
      const id = visibleSession()
      const session = id ? latest.current[id] : undefined
      if (!session?.isUnseen) return
      reportSeen(session)
      setSessions(current => ({ ...current, [id!]: { ...current[id!]!, isUnseen: false } }))
    }
    clearViewed()
    const subscription = AppState.addEventListener('change', clearViewed)
    return () => subscription.remove()
  }, [viewedSessionId, visibleSession, reportSeen])
  const ingest = useCallback((events: unknown[]) => {
    const changed: { activity: SessionActivity; completed?: boolean }[] = []
    for (const event of events) {
      const frame = event as { type?: string; activity?: SessionActivity; completed?: boolean } | null
      if (frame?.type === 'session_activity' && frame.activity) changed.push({ activity: frame.activity, completed: frame.completed })
    }
    if (!changed.length) return
    for (const frame of changed) updates.current[frame.activity.sessionId] = frame.activity
    const viewing = visibleSession()
    // A run finishing in the session on screen is read as it lands.
    for (const frame of changed) if (frame.completed && frame.activity.sessionId === viewing) reportSeen(frame.activity)
    setSessions(current => {
      const next = { ...current }
      for (const frame of changed) {
        const id = frame.activity.sessionId
        next[id] = mergeSessionActivity(next[id], frame.activity, viewing, frame.completed)
      }
      return next
    })
  }, [visibleSession, reportSeen])
  useEffect(() => { setSessions({}); updates.current = {} }, [client])
  useEffect(() => {
    if (!client || !connected) return
    let active = true
    updates.current = {}
    void client.request({ type: 'list_session_activity', requestId: randomId() }).then(result => {
      if (!active) return
      const rows = (result as { sessions?: SessionActivity[] }).sessions
      if (rows) {
        const viewing = visibleSession()
        // The session on screen was read whatever happened while offline.
        const shown = rows.find(row => row.sessionId === viewing)
        if (shown?.completedMessageId) reportSeen(shown)
        setSessions(current => {
          const next: Record<string, MobileSessionActivity> = {}
          // Idle runtimes may have been released; unread completions belong to
          // the client and outlive the host's in-memory session.
          for (const [id, session] of Object.entries(current)) {
            if (session.isUnseen) next[id] = { ...session, status: 'idle', pendingCount: 0, pendingReason: { en: null, zh: null } }
          }
          for (const row of rows) next[row.sessionId] = mergeSessionActivity(current[row.sessionId], row, viewing)
          // A push received during this request is newer than its snapshot.
          for (const id of Object.keys(updates.current)) if (current[id]) next[id] = current[id]
          return next
        })
      }
    }).catch(() => {})
    return () => { active = false }
  }, [client, connected, visibleSession, reportSeen])
  return { sessions, ingest, pendingCount: countAttentionSessions(sessions) }
}
