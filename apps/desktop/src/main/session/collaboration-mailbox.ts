import { EventEmitter } from 'node:events'
import type { CollaborationMailboxMessage } from '@superone/shared/collaboration-mailbox'
import { getDb } from '../database'

const events = new EventEmitter()

export function onCollaborationMailboxChanged(listener: (sessionId: string) => void): () => void {
  events.on('changed', listener)
  return () => { events.off('changed', listener) }
}

export function notifyCollaborationMailboxChanged(sessionId: string): void {
  events.emit('changed', sessionId)
}

/** Viewing the mailbox never advances the agent's retrieval cursor. */
export function listUnreadCollaborationMessages(sessionId: string): CollaborationMailboxMessage[] {
  return getDb().prepare(`
    SELECT m.id, m.sender_session_id AS fromSessionId,
      COALESCE(NULLIF(s.title, ''), substr(m.sender_session_id, 1, 8)) AS fromTitle,
      m.content, m.created_at AS createdAt
    FROM session_collaboration_messages m
    LEFT JOIN sessions s ON s.id = m.sender_session_id
    LEFT JOIN session_collaboration_cursors c
      ON c.credential_hash = m.credential_hash AND c.session_id = m.recipient_session_id
    WHERE m.recipient_session_id = ? AND m.sequence > COALESCE(c.last_sequence, 0)
    ORDER BY m.created_at, m.rowid
  `).all(sessionId) as CollaborationMailboxMessage[]
}

interface AuthorizedMailbox {
  credentialHash: string
  credential: string
  peer: { name: string; role: string; title: string; sessionId?: string }
}

interface MailboxRow {
  id: string
  sequence: number
  sender_session_id: string
  content: string
  created_at: string
}

const MAX_MESSAGES_PER_RETRIEVE = 100

export function readCollaborationMailbox(callerSessionId: string, grants: AuthorizedMailbox[]) {
  return getDb().transaction(() => {
    const perGrantLimit = Math.max(1, Math.floor(MAX_MESSAGES_PER_RETRIEVE / grants.length))
    const messages: Array<{
      credential: string
      messageId: string
      sequence: number
      fromSessionId: string
      content: string
      createdAt: string
      from: { name: string; role: string; title: string; sessionId: string }
    }> = []
    for (const grant of grants) {
      const cursor = getDb().prepare(`
        SELECT last_sequence FROM session_collaboration_cursors
        WHERE credential_hash = ? AND session_id = ?
      `).get(grant.credentialHash, callerSessionId) as { last_sequence: number } | undefined
      const rows = getDb().prepare(`
        SELECT * FROM session_collaboration_messages
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?
      `).all(grant.credentialHash, callerSessionId, cursor?.last_sequence ?? 0, perGrantLimit) as MailboxRow[]
      if (rows.length === 0) continue
      const lastSequence = rows[rows.length - 1].sequence
      const now = new Date().toISOString()
      getDb().prepare(`
        INSERT INTO session_collaboration_cursors (credential_hash, session_id, last_sequence)
        VALUES (?, ?, ?)
        ON CONFLICT(credential_hash, session_id) DO UPDATE SET last_sequence = excluded.last_sequence
      `).run(grant.credentialHash, callerSessionId, lastSequence)
      getDb().prepare(`
        UPDATE session_collaboration_messages SET delivered_at = COALESCE(delivered_at, ?)
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence <= ?
      `).run(now, grant.credentialHash, callerSessionId, lastSequence)
      const peer = grant.peer
      for (const row of rows) {
        messages.push({
          credential: grant.credential,
          messageId: row.id,
          sequence: row.sequence,
          fromSessionId: row.sender_session_id,
          content: row.content,
          createdAt: row.created_at,
          from: {
            ...peer,
            sessionId: peer.sessionId!,
          },
        })
      }
    }
    return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, MAX_MESSAGES_PER_RETRIEVE)
  })()
}
