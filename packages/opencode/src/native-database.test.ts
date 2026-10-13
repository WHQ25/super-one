import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { nativeDatabasePath, prepareNativeDatabase, interruptNativeDatabase } from './native-database'

const roots: string[] = [], databases: Database.Database[] = []
afterEach(() => { for (const db of databases.splice(0)) if (db.open) db.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'native-db-isolation-')); roots.push(root)
  const data = join(root, 'data'); mkdirSync(join(data, 'opencode'), { recursive: true })
  const source = new Database(join(data, 'opencode', 'opencode.db')); databases.push(source)
  source.pragma('journal_mode = WAL'); source.pragma('foreign_keys = ON')
  source.exec(`CREATE TABLE session_v2(id TEXT PRIMARY KEY, parent_id TEXT, time_suspended INTEGER, resume_attempts INTEGER,
    time_idle INTEGER, idle_outcome TEXT, time_updated INTEGER);
    CREATE TABLE session_message(id TEXT PRIMARY KEY, session_id TEXT REFERENCES session_v2(id) ON DELETE CASCADE, data TEXT);
    CREATE TABLE credential(id TEXT PRIMARY KEY, value TEXT);`)
  source.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, 1, NULL, NULL, 100)').run('own', null, 10)
  source.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, 1, NULL, NULL, 100)').run('child', 'own', 11)
  source.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, 1, NULL, NULL, 100)').run('sibling', null, 12)
  for (const id of ['own', 'child', 'sibling']) source.prepare('INSERT INTO session_message VALUES (?, ?, ?)').run(id, id, `${id} context`)
  source.prepare('INSERT INTO credential VALUES (?, ?)').run('key', 'fixture-native-key')
  return { root, source, home: join(root, 'services'), env: { XDG_DATA_HOME: data } }
}
describe('owned native database isolation', () => {
  it('copies committed WAL context and credentials, prunes unrelated actors and leaves the original untouched', () => {
    const { source, home, env } = fixture()
    const path = prepareNativeDatabase(home, 'host', env, 'own')
    const copy = new Database(path); databases.push(copy)
    expect(copy.prepare('SELECT id FROM session_v2 ORDER BY id').all()).toEqual([{ id: 'child' }, { id: 'own' }])
    expect(copy.prepare('SELECT data FROM session_message ORDER BY id').all()).toEqual([{ data: 'child context' }, { data: 'own context' }])
    expect(copy.prepare('SELECT value FROM credential').get()).toEqual({ value: 'fixture-native-key' })
    expect(copy.prepare('SELECT time_suspended, idle_outcome FROM session_v2').all()).toEqual([
      { time_suspended: null, idle_outcome: 'interrupted' }, { time_suspended: null, idle_outcome: 'interrupted' }])
    expect(source.prepare('SELECT id FROM session_v2 ORDER BY id').all()).toHaveLength(3)
    expect(source.prepare('SELECT time_suspended FROM session_v2 WHERE id = ?').get('own')).toEqual({ time_suspended: 10 })
    expect(statSync(path).mode & 0o077).toBe(0)
  })
  it('seeds a fresh session with no copied execution, and keeps an existing namespace across credential changes', () => {
    const { source, home, env } = fixture()
    const path = prepareNativeDatabase(home, 'fresh', env)
    const copy = new Database(path); databases.push(copy)
    expect(copy.prepare('SELECT COUNT(*) AS count FROM session_v2').get()).toEqual({ count: 0 })
    source.prepare('UPDATE credential SET value = ?').run('changed-source')
    expect(prepareNativeDatabase(home, 'fresh', env)).toBe(path)
    expect(copy.prepare('SELECT value FROM credential').get()).toEqual({ value: 'fixture-native-key' })
    expect(nativeDatabasePath(home, 'fresh')).toBe(path)
  })
  it('clears only unfinished executor claims without dropping accepted input or context', () => {
    const { home, env } = fixture()
    const path = prepareNativeDatabase(home, 'host', env, 'own')
    const copy = new Database(path); databases.push(copy)
    copy.prepare('UPDATE session_v2 SET time_suspended = ? WHERE id = ?').run(55, 'own')
    interruptNativeDatabase(path)
    expect(copy.prepare('SELECT time_suspended, idle_outcome FROM session_v2 WHERE id = ?').get('own')).toEqual({ time_suspended: null, idle_outcome: 'interrupted' })
    expect(copy.prepare('SELECT COUNT(*) AS count FROM session_message').get()).toEqual({ count: 2 })
    expect(() => prepareNativeDatabase(home, 'host', env, 'missing')).toThrow('does not contain')
  })
})
