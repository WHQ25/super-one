import { todoRestoreDecision } from '@superone/chat-core'
import type { ChatMessage } from '@superone/shared/agent-types'
import { sqliteTranscript, type TranscriptAccess } from '@superone/runtime/stream/delivery/transcript-access'
import { getDb } from '../database'
import { rowToChatMessage, type PersistedMessageRow } from './session-repo'

const MESSAGE_COLUMNS = `id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id`

interface ColdMessageRow extends PersistedMessageRow {
  sort_order: number
}

const TODO_MATCH = `instr(content_json, '"toolName":"TodoWrite"') > 0 OR instr(content_json, '"toolName":"TaskCreate"') > 0 OR instr(content_json, '"toolName":"TaskUpdate"') > 0`
const QUESTION_MATCH = `id LIKE 'codex_async_answer:%' OR instr(content_json, '"codexAsyncQuestions"') > 0 OR instr(COALESCE(metadata_json, ''), '"codexAsyncQuestions"') > 0`
const CONTEXT_MATCH = `instr(content_json, '"appInstanceId"') > 0 OR instr(COALESCE(metadata_json, ''), '"appInstanceId"') > 0`

/**
 * Absolute-index view of a session that is not in memory. `count` stays the
 * real transcript length; only the rows a window walk touches are parsed.
 */
export function openColdTranscript(sessionId: string): TranscriptAccess {
  return sqliteTranscript<ColdMessageRow>(getDb(), {
    table: 'chat_messages', idColumn: 'id', columns: MESSAGE_COLUMNS, sessionId, parse: rowToChatMessage,
  })
}

/** The message that holds the newest todo tool, or null when the transcript has none. */
export function coldTodoMessage(sessionId: string): ChatMessage | null {
  const rows = getDb().prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE session_id = ? AND (${TODO_MATCH}) ORDER BY sort_order DESC`).iterate(sessionId) as Iterable<ColdMessageRow>
  for (const row of rows) {
    const message = rowToChatMessage(row)
    if (todoRestoreDecision(message).found) return message
  }
  return null
}

/** Question rows and their answer rows, in transcript order. Other rows cannot change the queue. */
export function coldQuestionMessages(sessionId: string): ChatMessage[] {
  const rows = getDb().prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE session_id = ? AND (${QUESTION_MATCH}) ORDER BY sort_order ASC`).all(sessionId) as ColdMessageRow[]
  return rows.map(rowToChatMessage)
}

/** Messages that carry an App attachment, in transcript order. The latest one per App wins. */
export function coldMcpMessages(sessionId: string): ChatMessage[] {
  const rows = getDb().prepare(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE session_id = ? AND (${CONTEXT_MATCH}) ORDER BY sort_order ASC`).all(sessionId) as ColdMessageRow[]
  return rows.map(rowToChatMessage)
}
