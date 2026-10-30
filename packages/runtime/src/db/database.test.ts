import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import {
  NODE_SETTLED_RECENT_KEEP_META_KEY,
  openNodeDatabase,
  settleRecentNodeSessionsOnce,
} from './database'

let db: Database.Database | null = null

afterEach(() => {
  db?.close()
  db = null
})

describe('openNodeDatabase session providers', () => {
  it('registers the canonical dsh base provider for remote sessions', () => {
    db = openNodeDatabase(':memory:')

    expect(
      db.prepare('SELECT harness_id, is_base FROM session_providers WHERE id = ?')
        .get('dsh-base'),
    ).toEqual({ harness_id: 'dsh', is_base: 1 })
  })

  it('settles older sessions once, keeping ten recent ones in each project', () => {
    db = openNodeDatabase(':memory:')
    expect(db.prepare('SELECT value FROM meta WHERE key = ?').get(NODE_SETTLED_RECENT_KEEP_META_KEY)).toEqual({ value: '10' })
    db.prepare('DELETE FROM meta WHERE key = ?').run(NODE_SETTLED_RECENT_KEEP_META_KEY)

    const insert = db.prepare(`
      INSERT INTO sessions (
        session_id, project_id, harness_id, provider_id, status, transcript_json, created_at, updated_at, is_hidden
      ) VALUES (?, ?, 'claude', 'claude-base', 'idle', '[]', 0, ?, ?)
    `)
    for (let n = 1; n <= 12; n += 1) insert.run(`a${String(n).padStart(2, '0')}`, 'project-a', n, 0)
    for (let n = 1; n <= 3; n += 1) insert.run(`b0${n}`, 'project-b', n, 0)
    insert.run('hidden', 'project-a', 0, 1)
    insert.run('child', 'project-a', 100, 0)
    db.prepare(`
      INSERT INTO session_collaboration_grants (
        credential_hash, credential_hint, parent_session_id, child_session_id, agent_id, task, config_json, created_at
      ) VALUES ('hash', 'hint', 'a12', 'child', 'agent', 'task', '{}', '2026-01-01')
    `).run()

    settleRecentNodeSessionsOnce(db)

    const rows = db.prepare('SELECT session_id AS id, is_settled AS settled FROM sessions ORDER BY session_id').all() as Array<{
      id: string
      settled: number
    }>
    expect(Object.fromEntries(rows.map((row) => [row.id, row.settled]))).toEqual({
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
    })

    db.prepare('UPDATE sessions SET is_settled = 0 WHERE session_id = ?').run('a01')
    settleRecentNodeSessionsOnce(db)
    expect(db.prepare('SELECT is_settled AS settled FROM sessions WHERE session_id = ?').get('a01')).toEqual({ settled: 0 })
  })
})
