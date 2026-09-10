import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { RelayClient } from '@superone/relay-client'
import type { SessionActivity } from '@superone/shared/session-activity'
import { AppState } from 'react-native'
import { countAttentionSessions, mergeSessionActivity, type MobileSessionActivity, type WorkspaceActivity } from '../session-activity-state'
import { randomId } from '../ids'

export const SessionActivityContext = createContext<WorkspaceActivity>({})
export const useSessionActivity = (sessionId: string) => useContext(SessionActivityContext)[sessionId]

/** Independent of the open chat and drawer; reconnect replaces stale summaries. */
export function useWorkspaceActivity(client: RelayClient | null, connected: boolean, revision: number, viewedSessionId: string | null = null) {
  const [sessions, setSessions] = useState<Record<string, MobileSessionActivity>>({})
  const updates = useRef<Record<string, SessionActivity>>({})
  const viewed = useRef(viewedSessionId)
  viewed.current = viewedSessionId
  const visibleSession = useCallback(() => AppState.currentState === 'background' || AppState.currentState === 'inactive' ? null : viewed.current, [])
  useEffect(() => {
    const clearViewed = () => {
      const id = visibleSession()
      if (id) setSessions(current => current[id]?.isUnseen ? { ...current, [id]: { ...current[id], isUnseen: false } } : current)
    }
    clearViewed()
    const subscription = AppState.addEventListener('change', clearViewed)
    return () => subscription.remove()
  }, [viewedSessionId, visibleSession])
  const ingest = useCallback((events: unknown[]) => {
    const changed: { activity: SessionActivity; completed?: boolean }[] = []
    for (const event of events) {
      const frame = event as { type?: string; activity?: SessionActivity; completed?: boolean } | null
      if (frame?.type === 'session_activity' && frame.activity) changed.push({ activity: frame.activity, completed: frame.completed })
    }
    if (!changed.length) return
    for (const frame of changed) updates.current[frame.activity.sessionId] = frame.activity
    const viewing = visibleSession()
    setSessions(current => {
      const next = { ...current }
      for (const frame of changed) {
        const id = frame.activity.sessionId
        next[id] = mergeSessionActivity(next[id], frame.activity, viewing, frame.completed)
      }
      return next
    })
  }, [visibleSession])
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
  }, [client, connected, revision, visibleSession])
  return { sessions, ingest, pendingCount: countAttentionSessions(sessions) }
}
