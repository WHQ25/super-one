/**
 * Local-environment draft store + the controller-side outbox.
 *
 * The drafts table is the desktop's own environment storage and shares its
 * implementation with the node via `@superone/runtime/drafts` — a local draft
 * and a remote draft behave identically, they just live on different machines.
 *
 * `pending_drafts` is different in kind: it is not a mirror of remote drafts
 * (a mirror could be dropped), it is an outbox of writes that have not reached
 * their node yet. Losing a row here means losing something the user typed.
 */

import { createDraftStore, deriveDraftTitle, type DraftStore } from '@superone/runtime/drafts'
import type { DraftListEntry, DraftRecord, DraftUpsertRequest } from '@superone/shared/environment'
import { getDb } from './database'

let store: DraftStore | null = null

/** Local-environment drafts (connectionId === 'local'). */
export function localDraftStore(): DraftStore {
  store ??= createDraftStore(getDb())
  return store
}

export interface PendingDraft {
  draft: DraftUpsertRequest
  connectionId: string
  queuedAt: string
  attempts: number
  lastError: string | null
}

interface DbPendingRow {
  id: string
  connection_id: string
  payload_json: string
  queued_at: string
  attempts: number
  last_error: string | null
}

/** Give up automatic retries after this many failures; the row stays for a manual retry. */
export const PENDING_DRAFT_MAX_ATTEMPTS = 8

function toPending(row: DbPendingRow): PendingDraft {
  return {
    draft: JSON.parse(row.payload_json) as DraftUpsertRequest,
    connectionId: row.connection_id,
    queuedAt: row.queued_at,
    attempts: row.attempts,
    lastError: row.last_error,
  }
}

/**
 * Queue a draft for an environment we could not reach. Keyed by draft id, so
 * re-editing the same draft while offline overwrites the queued copy instead
 * of stacking duplicates.
 */
export function enqueuePendingDraft(connectionId: string, draft: DraftUpsertRequest): void {
  getDb()
    .prepare(
      `INSERT INTO pending_drafts (id, connection_id, payload_json, queued_at, attempts, last_error)
       VALUES (?, ?, ?, ?, 0, NULL)
       ON CONFLICT(id) DO UPDATE SET
         connection_id = excluded.connection_id,
         payload_json = excluded.payload_json,
         queued_at = excluded.queued_at,
         attempts = 0,
         last_error = NULL`,
    )
    .run(draft.id, connectionId, JSON.stringify(draft), new Date().toISOString())
}

export function listPendingDrafts(connectionId?: string): PendingDraft[] {
  const rows = (
    connectionId
      ? getDb()
          .prepare('SELECT * FROM pending_drafts WHERE connection_id = ? ORDER BY queued_at DESC')
          .all(connectionId)
      : getDb().prepare('SELECT * FROM pending_drafts ORDER BY queued_at DESC').all()
  ) as DbPendingRow[]
  return rows.map(toPending)
}

/** Rows still worth retrying automatically. */
export function listFlushablePendingDrafts(connectionId: string): PendingDraft[] {
  return listPendingDrafts(connectionId).filter((p) => p.attempts < PENDING_DRAFT_MAX_ATTEMPTS)
}

export function deletePendingDraft(draftId: string): void {
  getDb().prepare('DELETE FROM pending_drafts WHERE id = ?').run(draftId)
}

/** True while a draft id is still in the outbox (flush re-checks around upserts). */
export function isPendingDraftQueued(draftId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS ok FROM pending_drafts WHERE id = ?').get(draftId) as
    | { ok: number }
    | undefined
  return !!row
}

export function recordPendingDraftFailure(draftId: string, error: string): void {
  getDb()
    .prepare('UPDATE pending_drafts SET attempts = attempts + 1, last_error = ? WHERE id = ?')
    .run(error.slice(0, 500), draftId)
}

/**
 * Merge a node's drafts with anything still queued for it. The queued copy
 * wins on id collision: it is by definition the newer edit that has not
 * landed yet.
 */
export function mergePendingIntoDrafts(
  drafts: DraftRecord[],
  pending: PendingDraft[],
): DraftListEntry[] {
  const byId = new Map<string, DraftListEntry>()
  for (const d of drafts) byId.set(d.id, d)
  for (const p of pending) {
    const existing = byId.get(p.draft.id)
    byId.set(p.draft.id, {
      id: p.draft.id,
      title: deriveDraftTitle(p.draft.text),
      text: p.draft.text,
      docJson: p.draft.docJson ?? null,
      attachments: p.draft.attachments ?? [],
      projectPath: p.draft.projectPath ?? null,
      harness: p.draft.harness ?? null,
      model: p.draft.model ?? null,
      permissionMode: p.draft.permissionMode ?? null,
      settings: p.draft.settings ?? existing?.settings ?? {},
      originSessionId: p.draft.originSessionId ?? null,
      createdAt: p.draft.createdAt ?? existing?.createdAt ?? p.queuedAt,
      updatedAt: p.queuedAt,
      pendingSync: true,
    })
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
