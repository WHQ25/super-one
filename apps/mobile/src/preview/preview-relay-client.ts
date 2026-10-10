import type { RelayClient } from '@superone/relay-client'
import type { SessionListRow } from '../session-list-state'

/**
 * Answers native session-list RPCs from fixtures so the drawer, the pinned
 * section and the search screen all render offline. Everything else rejects —
 * the preview must never look like it reached a desktop.
 */
export function previewRelayClient(sessions: SessionListRow[]): RelayClient {
  const rpc = async (method: string, payload: { query?: string; limit?: number } = {}) => {
    if (method === 'sessionList.page') {
      // A relay round trip takes a beat; answering synchronously would make
      // the project row's loading state impossible to review.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return { sessions, totalCount: sessions.length }
    }
    if (method === 'sessionList.pinned') {
      return { sessions: sessions.filter((row) => row.isPinned) }
    }
    if (method === 'sessionList.search') {
      const needle = (payload.query ?? '').trim().toLowerCase()
      return { sessions: sessions.filter((row) => row.title.toLowerCase().includes(needle)) }
    }
    throw new Error(`preview client cannot answer ${method}`)
  }
  return { rpc, resolveProject: async () => ({ environmentId: 'preview', projectId: 'project' }) } as unknown as RelayClient
}
