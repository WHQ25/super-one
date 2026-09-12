import type { RelayClient } from '@superone/relay-client'
import type { SessionListRow } from '../session-list-state'

/**
 * Answers the session-list commands from fixtures so the drawer, the pinned
 * section and the search screen all render offline. Everything else rejects —
 * the preview must never look like it reached a desktop.
 */
export function previewRelayClient(sessions: SessionListRow[]): RelayClient {
  const request = async (command: { type: string; query?: string; limit?: number }) => {
    if (command.type === 'list_sessions') {
      // A relay round trip takes a beat; answering synchronously would make
      // the project row's loading state impossible to review.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return { sessions, totalCount: sessions.length }
    }
    if (command.type === 'list_pinned_sessions') {
      return { sessions: sessions.filter((row) => row.isPinned) }
    }
    if (command.type === 'search_sessions') {
      const needle = (command.query ?? '').trim().toLowerCase()
      return { sessions: sessions.filter((row) => row.title.toLowerCase().includes(needle)) }
    }
    throw new Error(`preview client cannot answer ${command.type}`)
  }
  return { request } as unknown as RelayClient
}
