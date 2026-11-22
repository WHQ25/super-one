import type Database from 'better-sqlite3'
import type {
  ReviewDiffSource,
  ReviewFileDiff,
  ReviewTurnDiff,
} from '@superone/shared/review-types'
import { getDb } from '../database'

export interface StoredSessionNetDiff {
  sessionId: string
  cwd: string
  source: ReviewDiffSource
  hasConcurrentTurns: boolean
  files: ReviewFileDiff[]
  totalAdditions: number
  totalDeletions: number
  updatedAt: number
}

interface TurnDiffRow {
  session_id: string
  turn_index: number
  user_message_id: string
  assistant_message_id: string | null
  prompt_preview: string
  cwd: string
  source: string
  concurrent: number
  files_json: string
  total_additions: number
  total_deletions: number
  created_at: number
}

interface SessionNetRow {
  session_id: string
  cwd: string
  source: string
  has_concurrent_turns: number
  files_json: string
  total_additions: number
  total_deletions: number
  updated_at: number
}

export function ensureSessionTurnDiffsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_turn_diffs (
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      user_message_id TEXT NOT NULL,
      assistant_message_id TEXT,
      prompt_preview TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'tool-fallback',
      concurrent INTEGER NOT NULL DEFAULT 0,
      files_json TEXT NOT NULL DEFAULT '[]',
      total_additions INTEGER NOT NULL DEFAULT 0,
      total_deletions INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, turn_index)
    );
    CREATE INDEX IF NOT EXISTS idx_session_turn_diffs_session
      ON session_turn_diffs (session_id, turn_index);
    CREATE TABLE IF NOT EXISTS session_review_nets (
      session_id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'tool-fallback',
      has_concurrent_turns INTEGER NOT NULL DEFAULT 0,
      files_json TEXT NOT NULL DEFAULT '[]',
      total_additions INTEGER NOT NULL DEFAULT 0,
      total_deletions INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `)
}

function safeParseFiles(json: string): ReviewFileDiff[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as ReviewFileDiff[]) : []
  } catch {
    return []
  }
}

export function saveTurnDiff(sessionId: string, turn: ReviewTurnDiff): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO session_turn_diffs (
      session_id, turn_index, user_message_id, assistant_message_id,
      prompt_preview, cwd, source, concurrent, files_json,
      total_additions, total_deletions, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, turn_index) DO UPDATE SET
      user_message_id = excluded.user_message_id,
      assistant_message_id = excluded.assistant_message_id,
      prompt_preview = excluded.prompt_preview,
      cwd = excluded.cwd,
      source = excluded.source,
      concurrent = excluded.concurrent,
      files_json = excluded.files_json,
      total_additions = excluded.total_additions,
      total_deletions = excluded.total_deletions,
      created_at = excluded.created_at
  `).run(
    sessionId,
    turn.turnIndex,
    turn.userMessageId,
    turn.assistantMessageId,
    turn.promptPreview,
    turn.cwd,
    turn.source,
    turn.concurrent ? 1 : 0,
    JSON.stringify(turn.files),
    turn.totalAdditions,
    turn.totalDeletions,
    turn.createdAt,
  )
}

export function listTurnDiffs(sessionId: string): ReviewTurnDiff[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM session_turn_diffs WHERE session_id = ? ORDER BY turn_index ASC')
    .all(sessionId) as TurnDiffRow[]
  return rows.map((row) => ({
    turnIndex: row.turn_index,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    promptPreview: row.prompt_preview,
    cwd: row.cwd,
    source: row.source as ReviewDiffSource,
    concurrent: row.concurrent === 1,
    createdAt: row.created_at,
    files: safeParseFiles(row.files_json),
    totalAdditions: row.total_additions,
    totalDeletions: row.total_deletions,
  }))
}

export function saveSessionNetDiff(net: StoredSessionNetDiff): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO session_review_nets (
      session_id, cwd, source, has_concurrent_turns, files_json,
      total_additions, total_deletions, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      cwd = excluded.cwd,
      source = excluded.source,
      has_concurrent_turns = excluded.has_concurrent_turns,
      files_json = excluded.files_json,
      total_additions = excluded.total_additions,
      total_deletions = excluded.total_deletions,
      updated_at = excluded.updated_at
  `).run(
    net.sessionId,
    net.cwd,
    net.source,
    net.hasConcurrentTurns ? 1 : 0,
    JSON.stringify(net.files),
    net.totalAdditions,
    net.totalDeletions,
    net.updatedAt,
  )
}

export function loadSessionNetDiff(sessionId: string): StoredSessionNetDiff | null {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM session_review_nets WHERE session_id = ?')
    .get(sessionId) as SessionNetRow | undefined
  if (!row) return null
  return {
    sessionId: row.session_id,
    cwd: row.cwd,
    source: row.source as ReviewDiffSource,
    hasConcurrentTurns: row.has_concurrent_turns === 1,
    files: safeParseFiles(row.files_json),
    totalAdditions: row.total_additions,
    totalDeletions: row.total_deletions,
    updatedAt: row.updated_at,
  }
}

export function deleteSessionReviewData(sessionId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM session_turn_diffs WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM session_review_nets WHERE session_id = ?').run(sessionId)
}
