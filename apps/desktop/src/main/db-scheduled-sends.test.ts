import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))
vi.mock('./logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  ensureScheduledSendsSchema,
  getScheduledSend,
  getScheduledSendRemoteTarget,
  upsertScheduledSend,
} from './db-scheduled-sends'

const REMOTE_KEY = 'remote:conn-1:/srv/app'
const SEND_AT = Date.UTC(2026, 0, 1, 13, 0, 0)

let db: Database.Database

/** Just enough of `sessions` for the trigger, the existence check and list notifications. */
function createSessions(): void {
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, path TEXT NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id));
    INSERT INTO projects VALUES ('p1', '/proj');
    INSERT INTO sessions VALUES ('local-1', 'p1');
  `)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  getDbMock.mockReturnValue(db)
})

afterEach(() => db.close())

describe('scheduled sends schema', () => {
  it('loosens a pre-remote table and keeps its rows', () => {
    createSessions()
    db.exec(`
      CREATE TABLE scheduled_sends (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        send_at TEXT NOT NULL,
        message TEXT,
        armed INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_scheduled_sends_due ON scheduled_sends(armed, send_at);
    `)
    db.prepare(`INSERT INTO scheduled_sends VALUES ('local-1', ?, 'hi', 1, 'manual', ?)`)
      .run(new Date(SEND_AT).toISOString(), new Date(0).toISOString())

    ensureScheduledSendsSchema(db)
    ensureScheduledSendsSchema(db) // idempotent

    expect(db.prepare('PRAGMA foreign_key_list(scheduled_sends)').all()).toEqual([])
    expect(getScheduledSend('local-1')).toMatchObject({ sendAt: SEND_AT, message: 'hi', armed: true })
    const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'scheduled_sends'`).all()
    expect(indexes).toContainEqual({ name: 'idx_scheduled_sends_due' })
  })

  it('still drops a local row with its session', () => {
    createSessions()
    ensureScheduledSendsSchema(db)
    upsertScheduledSend('local-1', { sendAt: SEND_AT, armed: true })

    db.prepare('DELETE FROM sessions WHERE id = ?').run('local-1')

    expect(getScheduledSend('local-1')).toBeNull()
  })
})

describe('scheduled sends store', () => {
  beforeEach(() => {
    createSessions()
    ensureScheduledSendsSchema(db)
  })

  it('refuses a local session that has no row yet', () => {
    expect(upsertScheduledSend('never-sent', { sendAt: SEND_AT, armed: true })).toBeNull()
  })

  it('stores a remote-node session, which never has a local row', () => {
    const turn = { providerId: 'claude', model: 'opus' }
    upsertScheduledSend('node-1', { sendAt: SEND_AT, armed: true }, { projectKey: REMOTE_KEY, turn })

    expect(getScheduledSend('node-1')).toMatchObject({ armed: true, sendAt: SEND_AT })
    expect(getScheduledSendRemoteTarget('node-1')).toEqual({ projectKey: REMOTE_KEY, turn })
    expect(getScheduledSendRemoteTarget('local-1')).toBeNull()
  })

  it('keeps the remote target across writes that do not restate it', () => {
    upsertScheduledSend('node-1', { sendAt: SEND_AT }, { projectKey: REMOTE_KEY, turn: { providerId: 'codex' } })
    upsertScheduledSend('node-1', { armed: true })
    upsertScheduledSend('node-1', { message: 'later' }, { projectKey: REMOTE_KEY, turn: { providerId: 'codex', model: 'gpt-5' } })

    expect(getScheduledSendRemoteTarget('node-1')).toEqual({
      projectKey: REMOTE_KEY,
      turn: { providerId: 'codex', model: 'gpt-5' },
    })
  })
})
