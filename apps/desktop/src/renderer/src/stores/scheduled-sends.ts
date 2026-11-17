/**
 * Every session's queued send, as the sidebar needs it.
 *
 * `useScheduledSend` already mirrors one session for the composer; this is the
 * other half — the whole set, so the sidebar can mark the rows holding a promise
 * and float them to the top of their project. Deliberately its own store rather
 * than a slice of chat-store: chat-store is keyed by project path, while a
 * schedule is owned by main and keyed by session across every project at once.
 */

import { create } from 'zustand'
import type { ScheduledSend } from '@superone/shared/agent-types'

interface ScheduledSendsState {
  bySession: Record<string, ScheduledSend>
  load: (connectionId?: string) => Promise<void>
  /** Fold in one change broadcast; `null` means the row is gone. */
  apply: (sessionId: string, scheduled: ScheduledSend | null, connectionId?: string) => void
}

function scheduleKey(sessionId: string, connectionId?: string): string {
  return connectionId && connectionId !== 'local' ? JSON.stringify([connectionId, sessionId]) : sessionId
}

// A cancellation or delivery can arrive while the initial list RPC is in flight.
const loading = new Map<string, Set<string>>()

export const useScheduledSendsStore = create<ScheduledSendsState>((set) => ({
  bySession: {},

  load: async (connectionId = 'local') => {
    const changed = new Set<string>()
    loading.set(connectionId, changed)
    try {
      const rows = await window.environment.callSessionList(connectionId, 'sessionList.scheduledSends', {})
      if (loading.get(connectionId) !== changed) return
      set(state => {
        const next = { ...state.bySession }
        for (const [key, row] of Object.entries(next)) {
          if (key === scheduleKey(row.sessionId, connectionId) && !changed.has(key)) delete next[key]
        }
        for (const row of rows) {
          const key = scheduleKey(row.sessionId, connectionId)
          if (!changed.has(key)) next[key] = row
        }
        return { bySession: next }
      })
    } catch {
      // Nothing to show is the right fallback: the sidebar simply keeps its
      // ordinary ordering until the next broadcast fills the map in.
    } finally {
      if (loading.get(connectionId) === changed) loading.delete(connectionId)
    }
  },

  apply: (sessionId, scheduled, connectionId) =>
    set((state) => {
      const key = scheduleKey(sessionId, connectionId)
      loading.get(connectionId ?? 'local')?.add(key)
      if (!scheduled) {
        if (!(key in state.bySession)) return {}
        const next = { ...state.bySession }
        delete next[key]
        return { bySession: next }
      }
      return { bySession: { ...state.bySession, [key]: scheduled } }
    }),
}))

/**
 * The send this session actually owes, or null.
 *
 * Armed only. An unanswered rate-limit offer is a question the user has not
 * agreed to yet, and marking or reordering a row for it would announce a
 * promise nobody made.
 */
export function armedSendFor(
  bySession: Record<string, ScheduledSend>,
  sessionId: string | null | undefined,
  connectionId?: string,
): ScheduledSend | null {
  if (!sessionId) return null
  const row = bySession[scheduleKey(sessionId, connectionId)] ?? bySession[sessionId]
  return row?.armed ? row : null
}
