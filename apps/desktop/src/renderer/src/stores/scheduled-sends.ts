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
  load: () => Promise<void>
  /** Fold in one change broadcast; `null` means the row is gone. */
  apply: (sessionId: string, scheduled: ScheduledSend | null) => void
}

export const useScheduledSendsStore = create<ScheduledSendsState>((set) => ({
  bySession: {},

  load: async () => {
    try {
      const rows = await window.app.listScheduledSends()
      set({ bySession: Object.fromEntries(rows.map((row) => [row.sessionId, row])) })
    } catch {
      // Nothing to show is the right fallback: the sidebar simply keeps its
      // ordinary ordering until the next broadcast fills the map in.
    }
  },

  apply: (sessionId, scheduled) =>
    set((state) => {
      if (!scheduled) {
        if (!(sessionId in state.bySession)) return {}
        const next = { ...state.bySession }
        delete next[sessionId]
        return { bySession: next }
      }
      return { bySession: { ...state.bySession, [sessionId]: scheduled } }
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
): ScheduledSend | null {
  if (!sessionId) return null
  const row = bySession[sessionId]
  return row?.armed ? row : null
}
