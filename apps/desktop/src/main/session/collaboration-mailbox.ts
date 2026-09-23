import { EventEmitter } from 'node:events'
import type { CollaborationMailboxMessage } from '@superone/shared/collaboration-mailbox'
import { CollaborationStore } from '@superone/runtime/collaboration'
import { decryptSecret, encryptSecret } from '../crypto/secret-store'
import { getDb } from '../database'

const events = new EventEmitter()

/** getDb() is resolved per call: tests and app startup swap the database handle. */
export function collaborationStore(): CollaborationStore {
  return new CollaborationStore(getDb(), { encrypt: encryptSecret, decrypt: decryptSecret })
}

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
