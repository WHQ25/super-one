import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * Absolute indexes into one transcript. `count` is the real length, including
 * rows a bounded read did not parse, so window indexes, `older`, `total` and
 * live patches stay absolute.
 */
export interface TranscriptAccess {
  count: number
  messageAt(index: number): ChatMessage
  indexOf(messageId: string): number
  /** Stored rows parsed so far. Omitted when the transcript is already in memory. */
  parsed?(): number
  /** Rows that carry a transcript boundary. Omitted when the caller already has the transcript. */
  boundaryMessages?(): readonly ChatMessage[]
}

function missingRow(): Error {
  return Object.assign(new Error('transcript index out of range'), { code: 'not_found' })
}

/** A transcript held whole in memory. The id map is built only for an anchored read. */
export function arrayTranscript(messages: readonly ChatMessage[]): TranscriptAccess {
  let ids: Map<string, number> | undefined
  return {
    count: messages.length,
    messageAt(index) {
      const message = messages[index]
      if (!message) throw missingRow()
      return message
    },
    indexOf: (messageId) => (ids ??= new Map(messages.map((message, index) => [message.id, index]))).get(messageId) ?? -1,
    boundaryMessages: () => messages.filter((message) => message.metadata?.transcriptBoundary),
  }
}

interface SqliteReads {
  prepare(sql: string): { get(...params: unknown[]): unknown; all?(...params: unknown[]): unknown[] }
}

/**
 * A session's stored rows, read by `sort_order`. `messageAt` parses a row the
 * first time its index is touched and steps from a neighbor already read, so a
 * tail or anchor walk parses the rows it visits and the one past the budget.
 * Gaps in `sort_order` are allowed.
 */
export function sqliteTranscript<Row extends { sort_order: number }>(db: SqliteReads, input: {
  table: string
  idColumn: string
  /** Selected columns; must include `sort_order`. */
  columns: string
  sessionId: string
  parse(row: Row): ChatMessage
  /** Selects the same columns, one `?` for the session id, only rows that carry a transcript boundary. */
  boundarySql?: string
}): TranscriptAccess {
  const { table, idColumn, columns, sessionId } = input
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`).get(sessionId) as { count: number }).count
  const rowBefore = db.prepare(`SELECT ${columns} FROM ${table} WHERE session_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`)
  const rowAfter = db.prepare(`SELECT ${columns} FROM ${table} WHERE session_id = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1`)
  const rowAtOffset = db.prepare(`SELECT ${columns} FROM ${table} WHERE session_id = ? ORDER BY sort_order ASC LIMIT 1 OFFSET ?`)
  const sortOfId = db.prepare(`SELECT sort_order FROM ${table} WHERE session_id = ? AND ${idColumn} = ?`)
  const countBefore = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ? AND sort_order < ?`)
  const byIndex = new Map<number, { message: ChatMessage; sortOrder: number }>()
  const idIndex = new Map<string, number>()
  let boundaries: ChatMessage[] | undefined
  return {
    count: total,
    parsed: () => byIndex.size,
    messageAt(index) {
      const cached = byIndex.get(index)
      if (cached) return cached.message
      if (index < 0 || index >= total) throw missingRow()
      const newer = byIndex.get(index + 1)
      const older = byIndex.get(index - 1)
      const row = (newer
        ? rowBefore.get(sessionId, newer.sortOrder)
        : older
          ? rowAfter.get(sessionId, older.sortOrder)
          : rowAtOffset.get(sessionId, index)) as Row | undefined
      if (!row) throw missingRow()
      const entry = { message: input.parse(row), sortOrder: row.sort_order }
      byIndex.set(index, entry)
      idIndex.set(entry.message.id, index)
      return entry.message
    },
    indexOf(messageId) {
      const cached = idIndex.get(messageId)
      if (cached !== undefined) return cached
      const row = sortOfId.get(sessionId, messageId) as { sort_order: number } | undefined
      if (!row) return -1
      const index = (countBefore.get(sessionId, row.sort_order) as { count: number }).count
      if (index >= total) return -1
      idIndex.set(messageId, index)
      return index
    },
    boundaryMessages() {
      if (!input.boundarySql) return []
      if (!boundaries) {
        const rows = db.prepare(input.boundarySql).all?.(sessionId) as Row[] | undefined
        boundaries = (rows ?? []).map((row) => input.parse(row))
      }
      return boundaries
    },
  }
}
