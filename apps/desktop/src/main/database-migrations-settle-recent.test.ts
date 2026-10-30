import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  SETTLED_RECENT_KEEP_META_KEY,
  settleRecentSessionsOnce,
} from './database-migrations'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test', isReady: () => true, quit: vi.fn() },
  dialog: { showErrorBox: vi.fn(), showMessageBoxSync: vi.fn(() => 1) },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

function openFixture(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_user_message_at TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      is_pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE session_collaboration_grants (child_session_id TEXT, kind TEXT);
    CREATE TABLE scheduled_sends (session_id TEXT);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  return db
}

function insert(
  db: Database.Database,
  id: string,
  projectId: string,
  lastActive: string | null,
  extra: { hidden?: boolean; pinned?: boolean; createdAt?: string } = {},
): void {
  db.prepare(`
    INSERT INTO sessions (id, project_id, created_at, last_user_message_at, is_hidden, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    extra.createdAt ?? lastActive ?? '2020-01-01T00:00:00.000Z',
    lastActive,
    extra.hidden ? 1 : 0,
    extra.pinned ? 1 : 0,
  )
}

function settled(db: Database.Database): Record<string, number> {
  const rows = db.prepare('SELECT id, is_settled, is_hidden, is_pinned FROM sessions ORDER BY id').all() as Array<{
    id: string
    is_settled: number
    is_hidden: number
    is_pinned: number
  }>
  return Object.fromEntries(rows.map((row) => [row.id, row.is_settled]))
}

describe('settleRecentSessionsOnce', () => {
  const open: Database.Database[] = []
  afterEach(() => {
    for (const db of open) db.close()
    open.length = 0
  })

  it('keeps the ten most recently active sessions in each project and settles the rest once', () => {
    const db = openFixture()
    open.push(db)
    for (let n = 1; n <= 12; n += 1) {
      const id = `a${String(n).padStart(2, '0')}`
      insert(db, id, 'project-a', n === 12 ? null : `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`, {
        createdAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
        pinned: n === 1,
      })
    }
    for (let n = 1; n <= 3; n += 1) {
      insert(db, `b0${n}`, 'project-b', `2026-02-0${n}T00:00:00.000Z`)
    }
    insert(db, 'hidden', 'project-a', '2020-01-01T00:00:00.000Z', { hidden: true })
    insert(db, 'child', 'project-a', '2020-01-01T00:00:00.000Z')
    insert(db, 'recent-child', 'project-a', '2026-03-01T00:00:00.000Z')
    insert(db, 'scheduled', 'project-a', '2020-01-01T00:00:00.000Z')
    db.prepare('INSERT INTO session_collaboration_grants (child_session_id, kind) VALUES (?, ?)').run('child', 'spawn')
    db.prepare('INSERT INTO session_collaboration_grants (child_session_id, kind) VALUES (?, ?)').run('recent-child', 'spawn')
    db.prepare('INSERT INTO scheduled_sends (session_id) VALUES (?)').run('scheduled')

    settleRecentSessionsOnce(db)

    expect(settled(db)).toEqual({
      a01: 1,
      a02: 1,
      a03: 0,
      a04: 0,
      a05: 0,
      a06: 0,
      a07: 0,
      a08: 0,
      a09: 0,
      a10: 0,
      a11: 0,
      a12: 0,
      b01: 0,
      b02: 0,
      b03: 0,
      hidden: 1,
      child: 1,
      'recent-child': 1,
      scheduled: 1,
    })
    expect(db.prepare('SELECT is_pinned AS pinned FROM sessions WHERE id = ?').get('a01')).toEqual({ pinned: 1 })
    expect(db.prepare('SELECT is_hidden AS hidden FROM sessions WHERE id = ?').get('hidden')).toEqual({ hidden: 1 })
    expect(db.prepare('SELECT value FROM app_meta WHERE key = ?').get(SETTLED_RECENT_KEEP_META_KEY)).toEqual({ value: '10' })

    db.prepare('UPDATE sessions SET is_settled = 0 WHERE id = ?').run('a01')
    settleRecentSessionsOnce(db)
    expect(db.prepare('SELECT is_settled AS settled FROM sessions WHERE id = ?').get('a01')).toEqual({ settled: 0 })
    expect(db.prepare('SELECT is_settled AS settled FROM sessions WHERE id = ?').get('a02')).toEqual({ settled: 1 })
  })
})
