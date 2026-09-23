import type Database from 'better-sqlite3'

const GRANTS_TABLE = 'session_collaboration_grants'

/**
 * Grant uniqueness follows the relation, not the column: a spawn child has one
 * parent and a link is unique per (initiator, peer) pair, but any number of
 * sessions may link the same peer. Databases created before this carry a
 * column-level `child_session_id UNIQUE`, whose autoindex SQLite cannot drop,
 * so the table is rebuilt from its own stored DDL minus that keyword.
 *
 * Idempotent. The rebuild drops the table, which with foreign keys on would
 * cascade-delete every mailbox row referencing a grant. Outside a transaction
 * this turns them off for the rebuild; inside one (where the pragma is a no-op)
 * the caller must already have them off.
 */
export function ensureCollaborationGrantUniqueness(db: Database.Database): void {
  const needsRebuild = hasColumnUniqueChild(db)
  const apply = () => {
    if (needsRebuild) rebuildWithoutColumnUnique(db)
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_collaboration_spawn_child
        ON ${GRANTS_TABLE}(child_session_id) WHERE kind = 'spawn';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_collaboration_link_pair
        ON ${GRANTS_TABLE}(parent_session_id, child_session_id) WHERE kind = 'link';
    `)
  }
  const foreignKeysOn = needsRebuild && db.pragma('foreign_keys', { simple: true }) === 1
  if (db.inTransaction) {
    if (foreignKeysOn) {
      throw new Error(`Rebuilding ${GRANTS_TABLE} inside a transaction requires foreign keys off`)
    }
    apply()
    return
  }
  if (foreignKeysOn) db.pragma('foreign_keys = OFF')
  try {
    db.transaction(apply)()
  } finally {
    if (foreignKeysOn) db.pragma('foreign_keys = ON')
  }
}

function hasColumnUniqueChild(db: Database.Database): boolean {
  const indexes = db.prepare(`PRAGMA index_list(${GRANTS_TABLE})`).all() as Array<{ name: string; origin: string }>
  return indexes.some((index) => {
    if (index.origin !== 'u') return false
    const columns = db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all() as Array<{ name: string }>
    return columns.length === 1 && columns[0].name === 'child_session_id'
  })
}

function rebuildWithoutColumnUnique(db: Database.Database): void {
  const { sql } = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(GRANTS_TABLE) as { sql: string }
  const indexes = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
  `).all(GRANTS_TABLE) as Array<{ sql: string }>
  const withoutUnique = sql.replace(/(\bchild_session_id\s+TEXT)\s+UNIQUE\b/i, '$1')
  if (withoutUnique === sql) throw new Error(`Cannot find child_session_id UNIQUE in ${GRANTS_TABLE} DDL`)
  const rebuilt = `${GRANTS_TABLE}_rebuild`
  db.exec(withoutUnique.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?session_collaboration_grants["`]?/i, `CREATE TABLE ${rebuilt}`))
  db.exec(`INSERT INTO ${rebuilt} SELECT * FROM ${GRANTS_TABLE}`)
  // Same columns, looser constraint: a build that predates this reads the
  // rebuilt table exactly as before (see database-migrations-policy.test.ts).
  db.exec('DROP TABLE session_collaboration_grants')
  db.exec(`ALTER TABLE ${rebuilt} RENAME TO session_collaboration_grants`)
  for (const index of indexes) db.exec(index.sql)
}
