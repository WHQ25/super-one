import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import {
  addTerminalCommandRule,
  ensureTerminalCommandRulesSchema,
  isTerminalCommandPreapproved,
  listAllTerminalCommandRules,
  listTerminalCommandRules,
  removeTerminalCommandRule,
} from './db-terminal-command-rules'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  ensureTerminalCommandRulesSchema(db)
  getDbMock.mockReturnValue(db)
})

afterEach(() => db.close())

describe('terminal command rules store', () => {
  it('scopes rules to a project key and matches by regex', () => {
    addTerminalCommandRule('/proj/a', 'bun run storybook( .*)?')
    addTerminalCommandRule('/proj/a', 'bun run storybook( .*)?') // idempotent
    addTerminalCommandRule('remote:node1:/srv/b', 'python3')

    expect(listTerminalCommandRules('/proj/a').map((r) => r.pattern)).toEqual(['bun run storybook( .*)?'])
    expect(isTerminalCommandPreapproved('/proj/a', 'bun run storybook --ci')).toBe(true)
    expect(isTerminalCommandPreapproved('/proj/a', 'python3')).toBe(false)
    expect(isTerminalCommandPreapproved('remote:node1:/srv/b', 'python3')).toBe(true)
    expect(isTerminalCommandPreapproved('/proj/other', 'bun run storybook')).toBe(false)
  })

  it('refuses to store a rule that is not a valid regex', () => {
    expect(() => addTerminalCommandRule('/proj/a', 'bun run (')).toThrow(/Invalid terminal command rule/)
    expect(listTerminalCommandRules('/proj/a')).toEqual([])
  })

  it('removes a rule and reports whether it existed', () => {
    addTerminalCommandRule('/proj/a', 'ssh staging( .*)?')
    expect(removeTerminalCommandRule('/proj/a', 'ssh staging( .*)?')).toBe(true)
    expect(removeTerminalCommandRule('/proj/a', 'ssh staging( .*)?')).toBe(false)
    expect(listTerminalCommandRules('/proj/a')).toEqual([])
  })

  it('lists every project for the settings page, grouped in project order', () => {
    addTerminalCommandRule('/proj/b', 'python3')
    addTerminalCommandRule('/proj/a', 'bun run dev( .*)?')
    addTerminalCommandRule('remote:node1:/srv/c', 'ssh staging( .*)?')
    expect(listAllTerminalCommandRules().map((r) => [r.projectKey, r.pattern])).toEqual([
      ['/proj/a', 'bun run dev( .*)?'],
      ['/proj/b', 'python3'],
      ['remote:node1:/srv/c', 'ssh staging( .*)?'],
    ])
  })

  it('rewrites rules stored in the pre-regex grammar exactly once', () => {
    const legacy = new Database(':memory:')
    legacy.exec(`
      CREATE TABLE terminal_command_rules (
        project_key TEXT NOT NULL,
        pattern TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(project_key, pattern)
      );
      INSERT INTO terminal_command_rules VALUES ('/proj/a', 'bun run storybook:*', '2026-09-01T00:00:00.000Z');
      INSERT INTO terminal_command_rules VALUES ('/proj/a', 'python3', '2026-09-02T00:00:00.000Z');
    `)
    getDbMock.mockReturnValue(legacy)

    ensureTerminalCommandRulesSchema(legacy)
    ensureTerminalCommandRulesSchema(legacy) // idempotent: already-converted rows are left alone

    expect(listTerminalCommandRules('/proj/a').map((r) => [r.pattern, r.createdAt])).toEqual([
      ['bun run storybook( .*)?', '2026-09-01T00:00:00.000Z'],
      ['python3', '2026-09-02T00:00:00.000Z'],
    ])
    expect(isTerminalCommandPreapproved('/proj/a', 'bun run storybook --ci')).toBe(true)
    expect(isTerminalCommandPreapproved('/proj/a', 'python3 -i')).toBe(false)
    const grammars = legacy.prepare('SELECT DISTINCT grammar FROM terminal_command_rules').all() as Array<{ grammar: string }>
    expect(grammars).toEqual([{ grammar: 'regex' }])
    legacy.close()
  })
})
