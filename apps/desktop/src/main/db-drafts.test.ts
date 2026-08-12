/**
 * Controller-side draft outbox. These rows are not a cache of remote drafts —
 * they hold text the user typed that has not reached its node yet, so the
 * scenarios here are about never losing that text.
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftUpsertRequest } from '@superone/shared/environment'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import {
  PENDING_DRAFT_MAX_ATTEMPTS,
  deletePendingDraft,
  enqueuePendingDraft,
  isPendingDraftQueued,
  listFlushablePendingDrafts,
  listPendingDrafts,
  localDraftStore,
  mergePendingIntoDrafts,
  recordPendingDraftFailure,
} from './db-drafts'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE pending_drafts (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
  `)
  getDbMock.mockReturnValue(db)
})

afterEach(() => {
  db.close()
  vi.clearAllMocks()
})

const draft = (overrides?: Partial<DraftUpsertRequest>): DraftUpsertRequest => ({
  id: 'd1',
  text: 'ship the outbox',
  ...overrides,
})

describe('draft outbox', () => {
  it('queues a draft for an unreachable node and lists it back', () => {
    enqueuePendingDraft('mac-mini', draft())
    const queued = listPendingDrafts('mac-mini')
    expect(queued).toHaveLength(1)
    expect(queued[0].draft.text).toBe('ship the outbox')
    expect(queued[0].attempts).toBe(0)
  })

  it('scopes the queue per connection so one node cannot flush another node drafts', () => {
    enqueuePendingDraft('mac-mini', draft({ id: 'd1' }))
    enqueuePendingDraft('gpu-box', draft({ id: 'd2' }))
    expect(listPendingDrafts('mac-mini').map((p) => p.draft.id)).toEqual(['d1'])
    expect(listPendingDrafts('gpu-box').map((p) => p.draft.id)).toEqual(['d2'])
  })

  it('re-editing the same draft while offline overwrites the queued copy and clears past failures', () => {
    enqueuePendingDraft('mac-mini', draft({ text: 'first' }))
    recordPendingDraftFailure('d1', 'node unreachable')
    enqueuePendingDraft('mac-mini', draft({ text: 'second' }))

    const queued = listPendingDrafts('mac-mini')
    expect(queued).toHaveLength(1)
    expect(queued[0].draft.text).toBe('second')
    expect(queued[0].attempts).toBe(0)
    expect(queued[0].lastError).toBeNull()
  })

  it('stops auto-retrying after the attempt ceiling but keeps the row for a manual retry', () => {
    enqueuePendingDraft('mac-mini', draft())
    for (let i = 0; i < PENDING_DRAFT_MAX_ATTEMPTS; i++) {
      recordPendingDraftFailure('d1', 'boom')
    }
    expect(listFlushablePendingDrafts('mac-mini')).toHaveLength(0)
    expect(listPendingDrafts('mac-mini')).toHaveLength(1)
  })

  it('drops the queued row once it has been flushed', () => {
    enqueuePendingDraft('mac-mini', draft())
    deletePendingDraft('d1')
    expect(listPendingDrafts('mac-mini')).toEqual([])
  })

  it('reports whether a draft id is still in the outbox (flush re-check)', () => {
    expect(isPendingDraftQueued('d1')).toBe(false)
    enqueuePendingDraft('mac-mini', draft())
    expect(isPendingDraftQueued('d1')).toBe(true)
    deletePendingDraft('d1')
    expect(isPendingDraftQueued('d1')).toBe(false)
  })
})

describe('merging queued drafts into a node list', () => {
  it('marks queued drafts as pending and lets them win over the node copy', () => {
    enqueuePendingDraft('mac-mini', draft({ text: 'newer local edit' }))
    const merged = mergePendingIntoDrafts(
      [
        {
          id: 'd1',
          title: 'older',
          text: 'older remote copy',
          docJson: null,
          attachments: [],
          projectPath: '/repo',
          harness: null,
          model: null,
          permissionMode: null,
          settings: {},
          originSessionId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      listPendingDrafts('mac-mini'),
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('newer local edit')
    expect(merged[0].pendingSync).toBe(true)
  })

  it('keeps node-only drafts untouched and unmarked', () => {
    const remote = {
      id: 'd9',
      title: 'remote',
      text: 'remote',
      docJson: null,
      attachments: [],
      projectPath: null,
      harness: null,
      model: null,
      permissionMode: null,
      settings: {},
      originSessionId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const merged = mergePendingIntoDrafts([remote], [])
    expect(merged).toEqual([remote])
  })
})

describe('local environment drafts', () => {
  it('writes straight to the desktop database with no outbox involved', () => {
    const saved = localDraftStore().upsert({ id: 'local-1', text: 'a local idea' })
    expect(saved.title).toBe('a local idea')
    expect(localDraftStore().list()).toHaveLength(1)
    expect(listPendingDrafts()).toEqual([])
  })
})
