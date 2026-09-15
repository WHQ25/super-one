import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('./database', () => ({ getDb: getDbMock }))

import {
  addTerminalCommandRule,
  ensureTerminalCommandRulesSchema,
  isTerminalCommandPreapproved,
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
  it('scopes rules to a project key and matches by prefix', () => {
    addTerminalCommandRule('/proj/a', 'bun run storybook:*')
    addTerminalCommandRule('/proj/a', 'bun run storybook:*') // idempotent
    addTerminalCommandRule('remote:node1:/srv/b', 'python3')

    expect(listTerminalCommandRules('/proj/a').map((r) => r.pattern)).toEqual(['bun run storybook:*'])
    expect(isTerminalCommandPreapproved('/proj/a', 'bun run storybook --ci')).toBe(true)
    expect(isTerminalCommandPreapproved('/proj/a', 'python3')).toBe(false)
    expect(isTerminalCommandPreapproved('remote:node1:/srv/b', 'python3')).toBe(true)
    expect(isTerminalCommandPreapproved('/proj/other', 'bun run storybook')).toBe(false)
  })

  it('removes a rule and reports whether it existed', () => {
    addTerminalCommandRule('/proj/a', 'ssh staging:*')
    expect(removeTerminalCommandRule('/proj/a', 'ssh staging:*')).toBe(true)
    expect(removeTerminalCommandRule('/proj/a', 'ssh staging:*')).toBe(false)
    expect(listTerminalCommandRules('/proj/a')).toEqual([])
  })
})
