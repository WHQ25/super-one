import { randomUUID } from 'node:crypto'
import type { NodeDatabase } from '../db/database'
import type { EventLog } from './event-log'

export interface CollaborationMessage {
  messageId: string
  environmentId: string
  fromSessionId: string
  toSessionId: string | null
  mailbox: string
  body: unknown
  createdAt: number
}

/**
 * Same-environment Agent collaboration mailbox.
 * Messages are durable in SQLite and survive client/node restart.
 */
export class CollaborationMailbox {
  constructor(
    private readonly db: NodeDatabase,
    private readonly events: EventLog,
    private readonly environmentId: string,
  ) {}

  send(input: {
    fromSessionId: string
    toSessionId?: string | null
    mailbox: string
    body: unknown
  }): CollaborationMessage {
    const message: CollaborationMessage = {
      messageId: randomUUID(),
      environmentId: this.environmentId,
      fromSessionId: input.fromSessionId,
      toSessionId: input.toSessionId ?? null,
      mailbox: input.mailbox,
      body: input.body,
      createdAt: Date.now(),
    }
    this.db
      .prepare(
        `INSERT INTO collaboration_messages
         (message_id, environment_id, from_session_id, to_session_id, mailbox, body_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.messageId,
        message.environmentId,
        message.fromSessionId,
        message.toSessionId,
        message.mailbox,
        JSON.stringify(message.body),
        message.createdAt,
      )
    this.events.append({
      aggregateType: 'session',
      aggregateId: message.fromSessionId,
      eventType: 'collaboration.message',
      payload: {
        messageId: message.messageId,
        mailbox: message.mailbox,
        toSessionId: message.toSessionId,
      },
    })
    return message
  }

  list(input?: { mailbox?: string; sessionId?: string }): CollaborationMessage[] {
    let sql = `SELECT message_id, environment_id, from_session_id, to_session_id, mailbox, body_json, created_at
               FROM collaboration_messages WHERE environment_id = ?`
    const params: unknown[] = [this.environmentId]
    if (input?.mailbox) {
      sql += ` AND mailbox = ?`
      params.push(input.mailbox)
    }
    if (input?.sessionId) {
      sql += ` AND (from_session_id = ? OR to_session_id = ? OR to_session_id IS NULL)`
      params.push(input.sessionId, input.sessionId)
    }
    sql += ` ORDER BY created_at ASC`
    const rows = this.db.prepare(sql).all(...params) as Array<{
      message_id: string
      environment_id: string
      from_session_id: string
      to_session_id: string | null
      mailbox: string
      body_json: string
      created_at: number
    }>
    return rows.map((r) => ({
      messageId: r.message_id,
      environmentId: r.environment_id,
      fromSessionId: r.from_session_id,
      toSessionId: r.to_session_id,
      mailbox: r.mailbox,
      body: JSON.parse(r.body_json),
      createdAt: r.created_at,
    }))
  }
}
