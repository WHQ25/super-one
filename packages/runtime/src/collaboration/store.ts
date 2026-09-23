import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SessionCollabLaunchMode } from '@superone/shared/agent-types'
import type { TransactionalSqliteDatabase } from '../sqlite'
import { CollaborationError } from './errors'

/**
 * Grants, messages, and cursors of the `session_collaboration_*` tables. The
 * desktop and node databases share this schema; hosts keep session lifecycle
 * and presentation, this store owns every collaboration row.
 */

export interface CollaborationGrantRow {
  credential_hash: string
  credential_secret: string | null
  parent_session_id: string
  child_session_id: string | null
  agent_id: string
  task: string
  config_json: string
  task_sent: number
  kind: SessionCollabLaunchMode
  started_at: string | null
}

export interface CollaborationMessageRow {
  id: string
  credential_hash: string
  sequence: number
  sender_session_id: string
  recipient_session_id: string
  client_message_id: string | null
  content: string
  created_at: string
}

export interface CollaborationSecretCrypto {
  encrypt(plain: string): string
  /** Returns an empty string (or throws) when the stored value cannot be decrypted. */
  decrypt(stored: string): string
}

export interface MailboxBatch {
  credentialHash: string
  rows: CollaborationMessageRow[]
}

const GRANT_COLUMNS = `credential_hash, credential_secret, parent_session_id, child_session_id,
  agent_id, task, config_json, task_sent, COALESCE(kind, 'spawn') AS kind, started_at`

export function hashCollaborationCredential(credential: string): string {
  return createHash('sha256').update(credential).digest('hex')
}

function nowIso(): string {
  return new Date().toISOString()
}

export class CollaborationStore {
  constructor(
    private readonly db: TransactionalSqliteDatabase,
    private readonly secrets: CollaborationSecretCrypto,
  ) {}

  transaction<R>(fn: () => R): R {
    return this.db.transaction(fn)()
  }

  // --- grants --------------------------------------------------------------

  grantByHash(credentialHash: string): CollaborationGrantRow | null {
    return (this.db.prepare(`SELECT ${GRANT_COLUMNS} FROM session_collaboration_grants WHERE credential_hash = ?`)
      .get(credentialHash) as CollaborationGrantRow | undefined) ?? null
  }

  grantByCredential(credential: string): CollaborationGrantRow | null {
    return this.grantByHash(hashCollaborationCredential(credential))
  }

  /** The plaintext credential of a stored grant, or null when it cannot be recovered. */
  credentialOf(grant: Pick<CollaborationGrantRow, 'credential_secret'>): string | null {
    if (!grant.credential_secret) return null
    try {
      return this.secrets.decrypt(grant.credential_secret) || null
    } catch {
      return null
    }
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
   * Issue a credential and persist its grant. Link grants bind the peer at once;
   * spawn and handoff grants bind their session on start.
   */
  createGrant(input: {
    kind: SessionCollabLaunchMode
    parentSessionId: string
    childSessionId?: string | null
    agentId: string
    task: string
    config: object
  }): { credential: string; credentialHash: string } {
    const credential = `s1sc_${randomBytes(32).toString('base64url')}`
    const credentialHash = hashCollaborationCredential(credential)
    try {
      this.db.prepare(`
        INSERT INTO session_collaboration_grants
          (credential_hash, credential_secret, credential_hint, parent_session_id, child_session_id,
           agent_id, task, config_json, created_at, kind)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        credentialHash,
        this.secrets.encrypt(credential),
        credential.slice(-8),
        input.parentSessionId,
        input.childSessionId ?? null,
        input.agentId,
        input.task,
        JSON.stringify(input.config),
        nowIso(),
        input.kind,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (input.childSessionId && /UNIQUE|unique/i.test(message)) {
        throw new CollaborationError(
          `Session ${input.childSessionId} is already bound as a collaboration endpoint `
          + '(spawn child or link peer). child_session_id is globally unique — '
          + 'a session cannot be the non-initiator endpoint of two grants.',
          'failed_precondition',
        )
      }
      throw error
    }
    return { credential, credentialHash }
  }

  updateConfig(credentialHash: string, config: object): void {
    this.db.prepare('UPDATE session_collaboration_grants SET config_json = ? WHERE credential_hash = ?')
      .run(JSON.stringify(config), credentialHash)
  }

  markTaskSent(credentialHash: string): void {
    this.db.prepare('UPDATE session_collaboration_grants SET task_sent = 1 WHERE credential_hash = ?')
      .run(credentialHash)
  }

  /** Link start. Returns false when the grant had already been started. */
  markStarted(credentialHash: string): boolean {
    return this.db.prepare(`
      UPDATE session_collaboration_grants SET started_at = ? WHERE credential_hash = ? AND started_at IS NULL
    `).run(nowIso(), credentialHash).changes === 1
  }

  /**
   * Record the session a spawn/handoff start created. Throws when a concurrent
   * start already consumed the grant.
   *
   * A handoff session is deliberately *not* written to child_session_id: that
   * column is UNIQUE and marks a session as a collaboration endpoint, which would
   * nest the sibling in parent→child queries and block it from ever being linked
   * or spawned against. The created id lives in config_json instead.
   */
  bindStartedSession(grant: CollaborationGrantRow, sessionId: string, config: object): void {
    const changes = grant.kind === 'handoff'
      ? this.db.prepare(`
          UPDATE session_collaboration_grants SET config_json = ?, started_at = ?
          WHERE credential_hash = ? AND started_at IS NULL
        `).run(JSON.stringify({ ...config, handoffSessionId: sessionId }), nowIso(), grant.credential_hash).changes
      : this.db.prepare(`
          UPDATE session_collaboration_grants SET child_session_id = ?, started_at = ?
          WHERE credential_hash = ? AND child_session_id IS NULL
        `).run(sessionId, nowIso(), grant.credential_hash).changes
    if (changes !== 1) throw new CollaborationError('Credential was already consumed', 'failed_precondition')
  }

  // --- mailbox -------------------------------------------------------------

  private nextSequence(credentialHash: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM session_collaboration_messages WHERE credential_hash = ?
    `).get(credentialHash) as { next_sequence: number }
    return row.next_sequence
  }

  private insertMessage(row: CollaborationMessageRow): void {
    this.db.prepare(`
      INSERT INTO session_collaboration_messages
        (id, credential_hash, sequence, sender_session_id, recipient_session_id, client_message_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.credential_hash, row.sequence, row.sender_session_id,
      row.recipient_session_id, row.client_message_id, row.content, row.created_at,
    )
  }

  private buildMessage(input: {
    credentialHash: string
    senderSessionId: string
    recipientSessionId: string
    clientMessageId: string | null
    content: string
  }): CollaborationMessageRow {
    return {
      id: randomUUID(),
      credential_hash: input.credentialHash,
      sequence: this.nextSequence(input.credentialHash),
      sender_session_id: input.senderSessionId,
      recipient_session_id: input.recipientSessionId,
      client_message_id: input.clientMessageId,
      content: input.content,
      created_at: nowIso(),
    }
  }

  /** Append one message; a repeated `clientMessageId` returns the stored row. */
  appendMessage(input: {
    credentialHash: string
    senderSessionId: string
    recipientSessionId: string
    clientMessageId?: string
    content: string
  }): { row: CollaborationMessageRow; reused: boolean } {
    return this.transaction(() => {
      if (input.clientMessageId) {
        const existing = this.db.prepare(`
          SELECT * FROM session_collaboration_messages
          WHERE credential_hash = ? AND sender_session_id = ? AND client_message_id = ?
        `).get(input.credentialHash, input.senderSessionId, input.clientMessageId) as CollaborationMessageRow | undefined
        if (existing) return { row: existing, reused: true }
      }
      const row = this.buildMessage({ ...input, clientMessageId: input.clientMessageId ?? null })
      this.insertMessage(row)
      return { row, reused: false }
    })
  }

  /** Queue a link grant's opening body for the peer exactly once, then mark the task sent. */
  appendLinkOpening(grant: CollaborationGrantRow, recipientSessionId: string, content: string): void {
    this.transaction(() => {
      try {
        this.insertMessage(this.buildMessage({
          credentialHash: grant.credential_hash,
          senderSessionId: grant.parent_session_id,
          recipientSessionId,
          clientMessageId: `link-opening:${grant.credential_hash}`,
          content,
        }))
      } catch {
        // Unique client_message_id on retry — already delivered.
      }
      this.markTaskSent(grant.credential_hash)
    })
  }

  /**
   * Drain unread messages addressed to `sessionId` across grants, advancing this
   * endpoint's cursor. Batches keep the order of `credentialHashes` (grant keys).
   */
  readMailbox(sessionId: string, credentialHashes: string[], limitPerGrant: number): MailboxBatch[] {
    return this.transaction(() => credentialHashes.flatMap((credentialHash) => {
      const cursor = this.db.prepare(`
        SELECT last_sequence FROM session_collaboration_cursors WHERE credential_hash = ? AND session_id = ?
      `).get(credentialHash, sessionId) as { last_sequence: number } | undefined
      const rows = this.db.prepare(`
        SELECT * FROM session_collaboration_messages
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence > ?
        ORDER BY sequence LIMIT ?
      `).all(credentialHash, sessionId, cursor?.last_sequence ?? 0, limitPerGrant) as CollaborationMessageRow[]
      if (rows.length === 0) return []
      const lastSequence = rows[rows.length - 1].sequence
      this.db.prepare(`
        INSERT INTO session_collaboration_cursors (credential_hash, session_id, last_sequence)
        VALUES (?, ?, ?)
        ON CONFLICT(credential_hash, session_id) DO UPDATE SET last_sequence = excluded.last_sequence
      `).run(credentialHash, sessionId, lastSequence)
      this.db.prepare(`
        UPDATE session_collaboration_messages SET delivered_at = COALESCE(delivered_at, ?)
        WHERE credential_hash = ? AND recipient_session_id = ? AND sequence <= ?
      `).run(nowIso(), credentialHash, sessionId, lastSequence)
      return [{ credentialHash, rows }]
    }))
  }
}
