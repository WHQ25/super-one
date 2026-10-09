import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { parseOpenCodeGoUsage, readOpenCodeGoKey } from './opencode'

const open = (path: string) => new Database(path, { readonly: true })

function database(dir: string, name: string, rows: Array<[string, string, number | null]> | null): void {
  const db = new Database(join(dir, name))
  if (rows) {
    db.exec('CREATE TABLE credential (integration_id TEXT, value TEXT, active INTEGER)')
    for (const [id, key, active] of rows) db.prepare('INSERT INTO credential VALUES (?, ?, ?)').run(id, JSON.stringify({ key }), active)
  }
  db.close()
}

describe('readOpenCodeGoKey', () => {
  it('takes the active Go key from the stable database first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-'))
    database(dir, 'opencode-next.db', [['opencode-go', 'next-key', 1]])
    database(dir, 'opencode.db', [['opencode-go', 'old-key', 0], ['opencode-go', 'stable-key', 1]])
    expect(readOpenCodeGoKey(dir, open)).toBe('stable-key')
  })

  it('ignores the auth.json OpenCode 2 left behind once a database holds credentials', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-'))
    database(dir, 'opencode.db', [['anthropic', 'x', 1]])
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ 'opencode-go': { key: 'revived' } }))
    expect(readOpenCodeGoKey(dir, open)).toBeNull()
  })

  it('reads auth.json for OpenCode 1, whose database has no credential table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-'))
    database(dir, 'opencode.db', null)
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ 'opencode-go': { key: ' v1-key ' } }))
    expect(readOpenCodeGoKey(dir, open)).toBe('v1-key')
  })
})

describe('parseOpenCodeGoUsage', () => {
  it('maps the rolling, weekly and monthly windows', () => {
    expect(parseOpenCodeGoUsage({ usage: { rolling: { percent: 10, resetsAt: '2026-10-09T12:00:00Z' }, weekly: { percent: 40, resetsAt: null }, monthly: {} } })).toEqual({
      planType: 'Go',
      extraUsage: null,
      windows: [
        { label: '5h', usedPercent: 10, resetsAt: Date.parse('2026-10-09T12:00:00Z') / 1000 },
        { label: 'Weekly', usedPercent: 40, resetsAt: null },
      ],
    })
  })
})
