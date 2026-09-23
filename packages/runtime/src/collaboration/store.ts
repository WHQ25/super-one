import { randomUUID } from 'node:crypto'
import type { SessionCollabLaunchMode } from '@superone/shared/agent-types'
import type { TransactionalSqliteDatabase } from '../sqlite'
import { CollaborationError } from './errors'

/**
 * Grants, messages, and cursors of the `session_collaboration_*` tables. The
 * desktop and node databases share this schema; hosts keep session lifecycle
 * and presentation, this store owns every collaboration row.
 *
 * A grant is keyed by the legacy `credential_hash` column. It once held the hash
 * of a bearer credential the agent had to present; access is now decided from
 * the calling session, so new grants store an opaque random key there and no
 * secret at all. Older rows keep working because the key is only ever compared.
 */

export interface CollaborationGrantRow {
  /** Grant key (`credential_hash` column). */
  grant_id: string
  parent_session_id: string
  child_session_id: string | null
  agent_id: string
  /** Empty until session_collab_start supplies the brief. */
  task: string
  config_json: string
  task_sent: number
  kind: SessionCollabLaunchMode
  started_at: string | null
}

export interface CollaborationMessageRow {
  id: string
  sequence: number
  sender_session_id: string
  recipient_session_id: string
  client_message_id: string | null
  content: string
  created_at: string
}

export interface MailboxBatch {
  grantId: string
  rows: CollaborationMessageRow[]
}

const GRANT_COLUMNS = `credential_hash AS grant_id, parent_session_id, child_session_id,
  agent_id, task, config_json, task_sent, COALESCE(kind, 'spawn') AS kind, started_at`

const MESSAGE_COLUMNS = `id, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at`

function nowIso(): string {
  return new Date().toISOString()
}

export class CollaborationStore {
  constructor(private readonly db: TransactionalSqliteDatabase) {}

  transaction<R>(fn: () => R): R {
    return this.db.transaction(fn)()
  }

  // --- grants --------------------------------------------------------------

  grantById(grantId: string): CollaborationGrantRow | null {
    return (this.db.prepare(`SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(grantId) as CollaborationGrantRow | undefined) ?? null
  }

  /**
   * The grant an approved launch created. launchIds are agent-chosen and may
   * repeat across requests, so the latest approval wins.
   */
  grantForLaunch(parentSessionId: string, launchId: string): CollaborationGrantRow | null {
    return (this.db.prepare(`
      SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants
      WHERE parent_session_id = ? AND json_extract(config_json, '$.launchId') = ?
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).get(parentSessionId, launchId) as CollaborationGrantRow | undefined) ?? null
  }

  /** True when `sessionId` is a spawn child (nested collaboration is unsupported). */
  isSpawnChild(sessionId: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM session_collaboration_grants
      WHERE child_session_id = ? AND COALESCE(kind, 'spawn') = 'spawn' LIMIT 1
    `).get(sessionId))
  }

  spawnGrantForChild(childSessionId: string): CollaborationGrantRow | null {
    return (this.db.prepare(`
      SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants
      WHERE child_session_id = ? AND COALESCE(kind, 'spawn') = 'spawn'
    `).get(childSessionId) as CollaborationGrantRow | undefined) ?? null
  }

  startedSpawnGrants(): CollaborationGrantRow[] {
    return this.db.prepare(`
      SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants
      WHERE child_session_id IS NOT NULL AND COALESCE(kind, 'spawn') = 'spawn'
    `).all() as CollaborationGrantRow[]
  }

  /**
   * Open mailbox channels of `sessionId`: spawn grants with a bound child and
   * started link grants, oldest first. Handoff grants are never channels.
   */
  channelsFor(sessionId: string): CollaborationGrantRow[] {
    return this.db.prepare(`
      SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants
      WHERE (parent_session_id = ? OR child_session_id = ?)
        AND child_session_id IS NOT NULL
        AND (COALESCE(kind, 'spawn') = 'spawn' OR (kind = 'link' AND started_at IS NOT NULL))
      ORDER BY created_at, rowid
    `).all(sessionId, sessionId) as CollaborationGrantRow[]
  }

  /** True when one of the two sessions was created by a handoff from the other. */
  isHandoffPair(a: string, b: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM session_collaboration_grants
      WHERE kind = 'handoff' AND (
        (parent_session_id = ? AND json_extract(config_json, '$.handoffSessionId') = ?)
        OR (parent_session_id = ? AND json_extract(config_json, '$.handoffSessionId') = ?)
      ) LIMIT 1
    `).get(a, b, b, a))
  }

  findLinkGrant(initiatorSessionId: string, peerSessionId: string): CollaborationGrantRow | null {
    return (this.db.prepare(`
      SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants
      WHERE parent_session_id = ? AND child_session_id = ? AND kind = 'link'
    `).get(initiatorSessionId, peerSessionId) as CollaborationGrantRow | undefined) ?? null
  }

  /**
   * Persist an approved launch. Link grants bind the peer at once; spawn and
   * handoff grants bind their session on start. The brief arrives on start.
   */
  createGrant(input: {
    kind: SessionCollabLaunchMode
    parentSessionId: string
    childSessionId?: string | null
    agentId: string
    config: { launchId: string } & Record<string, unknown>
  }): string {
    const grantId = randomUUID()
    try {
      this.db.prepare(`
        INSERT INTO session_collaboration_grants
          (credential_hash, credential_secret, credential_hint, parent_session_id, child_session_id,
           agent_id, task, config_json, created_at, kind)
        VALUES (?, NULL, '', ?, ?, ?, '', ?, ?, ?)
      `).run(
        grantId,
        input.parentSessionId,
        input.childSessionId ?? null,
        input.agentId,
        JSON.stringify(input.config),
        nowIso(),
        input.kind,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (input.childSessionId && /UNIQUE|unique/i.test(message)) {
        // Only a concurrent approval of the same initiator→peer link gets here;
        // a sequential one reuses the grant in recordApprovedLaunch.
        throw new CollaborationError(
          `Session ${input.parentSessionId} already has a link to ${input.childSessionId}; request it again to reuse it.`,
          'failed_precondition',
        )
      }
      throw error
    }
    return grantId
  }

  updateConfig(grantId: string, config: object): void {
    this.db.prepare('UPDATE session_collaboration_grants SET config_json = ? WHERE credential_hash = ?')
      .run(JSON.stringify(config), grantId)
  }

  /** Record the brief of a grant whose task has not been delivered yet. */
  setTask(grantId: string, task: string): void {
    this.db.prepare('UPDATE session_collaboration_grants SET task = ? WHERE credential_hash = ? AND task_sent = 0')
      .run(task, grantId)
  }

  markTaskSent(grantId: string): void {
    this.db.prepare('UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?')
      .run(grantId)
  }

  /** Link start. Returns false when the grant had already been started. */
  markStarted(grantId: string): boolean {
    return this.db.prepare(`
      UPDATE session_collaboration_grants SET started_at = ? WHERE credential_hash = ? AND started_at IS NULL
    `).run(nowIso(), grantId).changes === 1
  }

  /**
   * Record the session a spawn/handoff start created. Throws when a concurrent
   * start already consumed the grant.
   *
   * A handoff session is deliberately *not* written to child_session_id: that
   * column holds channel endpoints (spawn children, link peers), and a handoff
   * sibling is neither. The created id lives in config_json instead.
   */
  bindStartedSession(grant: CollaborationGrantRow, sessionId: string, config: object): void {
    const changes = grant.kind === 'handoff'
      ? this.db.prepare(`
          UPDATE session_collaboration_grants SET config_json = ?, started_at = ?
          WHERE credential_hash = ? AND started_at IS NULL
        `).run(JSON.stringify({ ...config, handoffSessionId: sessionId }), nowIso(), grant.grant_id).changes
      : this.db.prepare(`
          UPDATE session_collaboration_grants SET child_session_id = ?, started_at = ?
          WHERE credential_hash = ? AND child_session_id IS NULL
        `).run(sessionId, nowIso(), grant.grant_id).changes
    if (changes !== 1) throw new CollaborationError('This launch was already started', 'failed_precondition')
  }

  // --- mailbox -------------------------------------------------------------

  private nextSequence(grantId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM session_collaboration_messages WHERE credential_hash = ?
    `).get(grantId) as { next_sequence: number }
    return row.next_sequence
  }

  private insertMessage(grantId: string, input: {
    senderSessionId: string
    recipientSessionId: string
    clientMessageId: string | null
    content: string
  }): CollaborationMessageRow {
    const row: CollaborationMessageRow = {
      id: randomUUID(),
      sequence: this.nextSequence(grantId),
      sender_session_id: input.senderSessionId,
      recipient_session_id: input.recipientSessionId,
      client_message_id: input.clientMessageId,
      content: input.content,
      created_at: nowIso(),
    }
    this.db.prepare(`
      INSERT INTO session_collaboration_messages
        (id, credential_hash, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, grantId, row.sequence, row.sender_session_id,
      row.recipient_session_id, row.client_message_id, row.content, row.created_at,
    )
    return row
  }

  /** Append one message; a repeated `clientMessageId` returns the stored row. */
  appendMessage(input: {
    grantId: string
    senderSessionId: string
    recipientSessionId: string
    clientMessageId?: string
    content: string
  }): { row: CollaborationMessageRow; reused: boolean } {
    return this.transaction(() => {
      if (input.clientMessageId) {
        const existing = this.db.prepare(`
          SELECT ${MESSAGE_COLUMNS} FROM session_collaboration_messages
          WHERE credential_hash = ? AND sender_session_id = ? AND client_message_id = ?
        `).get(input.grantId, input.senderSessionId, input.clientMessageId) as CollaborationMessageRow | undefined
        if (existing) return { row: existing, reused: true }
      }
      const row = this.insertMessage(input.grantId, { ...input, clientMessageId: input.clientMessageId ?? null })
      return { row, reused: false }
    })
  }

  /** Queue a link grant's opening body for the peer exactly once, then mark the task sent. */
  appendLinkOpening(grant: CollaborationGrantRow, recipientSessionId: string, content: string): void {
    this.transaction(() => {
      try {
        this.insertMessage(grant.grant_id, {
          senderSessionId: grant.parent_session_id,
          recipientSessionId,
          clientMessageId: `link-opening:${grant.grant_id}`,
          content,
        })
      } catch {
        // Unique client_message_id on retry — already delivered.
      }
      this.markTaskSent(grant.grant_id)
    })
  }

  /**
   * Drain unread messages addressed to `sessionId` across grants, advancing this
   * endpoint's cursor. Batches keep the order of `grantIds`.
   */
  readMailbox(sessionId: string, grantIds: string[], limitPerGrant: number): MailboxBatch[] {
    return this.transaction(() => grantIds.flatMap((grantId) => {
      const cursor = this.db.prepare(`
        SELECT last_sequence FROM session_collaboration_cursors WHERE credential_hash = ? AND session_id = ?
      `).get(grantId, sessionId) as { last_sequence: number } | undefined
      const rows = this.db.prepare(`
        SELECT ${MESSAGE_COLUMNS} FROM session_collaboration_messages
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?
      `).all(grantId, sessionId, cursor?.last_sequence ?? 0, limitPerGrant) as CollaborationMessageRow[]
      if (rows.length === 0) return []
      const lastSequence = rows[rows.length - 1].sequence
      this.db.prepare(`
        INSERT INTO session_collaboration_cursors (credential_hash, session_id, last_sequence)
        VALUES (?, ?, ?)
        ON CONFLICT(credential_hash, session_id) DO UPDATE SET last_sequence = excluded.last_sequence
      `).run(grantId, sessionId, lastSequence)
      this.db.prepare(`
        UPDATE session_collaboration_messages SET delivered_at = COALESCE(delivered_at, ?)
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence <= ?
      `).run(nowIso(), grantId, sessionId, lastSequence)
      return [{ grantId, rows }]
    }))
  }
}
