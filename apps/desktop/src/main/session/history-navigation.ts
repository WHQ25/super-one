import type { ChatMessage } from '@superone/shared/agent-types'
import { extendHistoryIndex, HISTORY_PREVIEW_LENGTH, type SessionHistoryIndex } from '@superone/shared/session-history-index'
import { getDb } from '../database'
import { loadSessionMessagesPaginated } from '../db-sessions'

/** SQLite projects text previews; tool payloads/metadata never enter this result. */
export function loadSessionHistoryIndex(sessionId: string): SessionHistoryIndex {
  const rows = getDb().prepare(`
    SELECT id, role, provider_id, created_at,
      substr((SELECT group_concat(preview, char(10)) FROM (
        SELECT substr(json_extract(block.value, '$.text'), 1, ?) AS preview
        FROM json_each(CASE WHEN json_type(content_json) = 'array'
          THEN content_json ELSE json_extract(content_json, '$.content') END) AS block
        WHERE json_extract(block.value, '$.type') = 'text' LIMIT 2
      )), 1, ?) AS preview
    FROM chat_messages WHERE session_id = ? ORDER BY sort_order ASC
  `).all(HISTORY_PREVIEW_LENGTH, HISTORY_PREVIEW_LENGTH, sessionId) as {
    id: string; role: ChatMessage['role']; provider_id: string; created_at: string; preview: string | null
  }[]
  return extendHistoryIndex({ messageIds: [], entries: [], compacts: [] }, rows.map(row => ({
    id: row.id, role: row.role, providerId: row.provider_id, createdAt: row.created_at,
    status: 'complete', content: row.preview ? [{ type: 'text', text: row.preview }] : [],
  })))
}

export function loadSessionMessageWindow(sessionId: string, anchorId: string, direction: 'around' | 'before' | 'after', limit = 8) {
  const db = getDb()
  const anchor = db.prepare('SELECT sort_order FROM chat_messages WHERE session_id = ? AND id = ?')
    .get(sessionId, anchorId) as { sort_order: number } | undefined
  if (!anchor) throw new Error('History message no longer exists')
  const position = (db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ? AND sort_order < ?')
    .get(sessionId, anchor.sort_order) as { count: number }).count
  const count = (db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE session_id = ?').get(sessionId) as { count: number }).count
  const size = Math.min(40, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 8)))
  const start = direction === 'before' ? Math.max(0, position - size)
    : direction === 'after' ? position + 1 : Math.max(0, position - 2)
  const end = direction === 'before' ? position : Math.min(count, start + size)
  const page = end > start ? loadSessionMessagesPaginated(sessionId, end - start, end) : { messages: [], cursor: start || null, hasMore: start > 0 }
  return { ...page, startIndex: start, endIndex: end, totalCount: count }
}
