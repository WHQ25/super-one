import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureCollaborationGrantUniqueness } from './schema'

// The desktop DDL before multi-link: column-level UNIQUE, FKs into sessions,
// a mailbox referencing grants, and `kind` appended by a later ALTER.
const LEGACY_DDL = `
  CREATE TABLE sessions (id TEXT PRIMARY KEY);
  CREATE TABLE session_collaboration_grants (
    credential_hash TEXT PRIMARY KEY,
    credential_secret TEXT,
    credential_hint TEXT NOT NULL,
    parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    child_session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    task TEXT NOT NULL,
    config_json TEXT NOT NULL,
    task_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT
  );
  CREATE INDEX idx_session_collaboration_child ON session_collaboration_grants(child_session_id);
  CREATE TABLE session_collaboration_messages (
    id TEXT PRIMARY KEY,
    credential_hash TEXT NOT NULL REFERENCES session_collaboration_grants(credential_hash) ON DELETE CASCADE,
    content TEXT NOT NULL
  );
  ALTER TABLE session_collaboration_grants ADD COLUMN kind TEXT NOT NULL DEFAULT 'spawn';
`

let db: Database.Database

function insertGrant(id: string, kind: string, parent: string, child: string | null) {
  db.prepare(`
    INSERT INTO session_collaboration_grants
      (credential_hash, credential_hint, parent_session_id, child_session_id, agent_id, task, config_json, created_at, kind)
    VALUES (?, '', ?, ?, '', '', '{}', '2026-09-23T00:00:00.000Z', ?)
  `).run(id, parent, child, kind)
}

function indexNames(): string[] {
  return (db.prepare(`PRAGMA index_list(session_collaboration_grants)`).all() as Array<{ name: string }>)
    .map((index) => index.name)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(LEGACY_DDL)
  for (const id of ['lead-a', 'lead-b', 'parent', 'child', 'peer']) {
    db.prepare('INSERT INTO sessions (id) VALUES (?)').run(id)
  }
  insertGrant('spawn-1', 'spawn', 'parent', 'child')
  insertGrant('link-1', 'link', 'lead-a', 'peer')
  db.prepare(`INSERT INTO session_collaboration_messages (id, credential_hash, content) VALUES ('m1', 'link-1', 'hi')`).run()
})

afterEach(() => {
  db.close()
})

describe('ensureCollaborationGrantUniqueness', () => {
  it('rebuilds a legacy table so a second session can link the same peer', () => {
    expect(() => insertGrant('link-2', 'link', 'lead-b', 'peer')).toThrow(/UNIQUE/)

    ensureCollaborationGrantUniqueness(db)

    insertGrant('link-2', 'link', 'lead-b', 'peer')
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_collaboration_grants').get()).toEqual({ n: 3 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    expect(indexNames()).toEqual(expect.arrayContaining([
      'idx_session_collaboration_child',
      'idx_session_collaboration_spawn_child',
      'idx_session_collaboration_link_pair',
    ]))
    const constraintIndexes = (db.prepare(`PRAGMA index_list(session_collaboration_grants)`).all() as Array<{ origin: string }>)
      .filter((index) => index.origin === 'u')
    expect(constraintIndexes).toEqual([])
  })

  it('still allows one spawn parent per child and one link per initiator→peer pair', () => {
    ensureCollaborationGrantUniqueness(db)

    expect(() => insertGrant('spawn-2', 'spawn', 'lead-a', 'child')).toThrow(/UNIQUE/)
    expect(() => insertGrant('link-dup', 'link', 'lead-a', 'peer')).toThrow(/UNIQUE/)
    insertGrant('link-child', 'link', 'lead-a', 'child')
  })

  it('refuses to rebuild inside a transaction that still enforces foreign keys', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() => db.transaction(() => ensureCollaborationGrantUniqueness(db))()).toThrow(/foreign keys off/)
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_collaboration_messages').get()).toEqual({ n: 1 })
  })

  it('skips a DDL it cannot rewrite with a warning instead of failing the migration', () => {
    const odd = new Database(':memory:')
    odd.exec(`
      CREATE TABLE session_collaboration_grants (
        credential_hash TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
        child_session_id VARCHAR UNIQUE, kind TEXT NOT NULL DEFAULT 'spawn'
      );
      INSERT INTO session_collaboration_grants VALUES ('link-1', 'lead-a', 'peer', 'link');
    `)
    const warnings: string[] = []

    expect(() => ensureCollaborationGrantUniqueness(odd, { warn: (message) => warnings.push(message) })).not.toThrow()

    expect(warnings).toEqual([expect.stringMatching(/unrecognized child_session_id UNIQUE DDL/)])
    expect(odd.prepare('SELECT COUNT(*) AS n FROM session_collaboration_grants').get()).toEqual({ n: 1 })
    expect(() => odd.prepare(`INSERT INTO session_collaboration_grants VALUES ('link-2', 'lead-b', 'peer', 'link')`).run())
      .toThrow(/UNIQUE/)
    odd.close()
  })

  it('is idempotent and keeps the rows and mailbox it found', () => {
    ensureCollaborationGrantUniqueness(db)
    ensureCollaborationGrantUniqueness(db)

    expect(db.prepare('SELECT credential_hash, kind, child_session_id FROM session_collaboration_grants ORDER BY 1').all())
      .toEqual([
        { credential_hash: 'link-1', kind: 'link', child_session_id: 'peer' },
        { credential_hash: 'spawn-1', kind: 'spawn', child_session_id: 'child' },
      ])
    expect(db.prepare('SELECT credential_hash FROM session_collaboration_messages').all())
      .toEqual([{ credential_hash: 'link-1' }])
  })
})
