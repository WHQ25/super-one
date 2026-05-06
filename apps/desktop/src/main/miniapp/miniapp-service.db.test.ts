import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

interface FakeStmtCall {
  sql: string
  method: 'all' | 'run' | 'get'
  params: unknown[] | Record<string, unknown>
}

const { fakeCalls, fakePragmas, openedDbs, resetFakeState } = vi.hoisted(() => {
  const fakeCalls: FakeStmtCall[] = []
  const fakePragmas: string[] = []
  const openedDbs: string[] = []
  let nextLastInsertRowid = 1

  function normalizeArgs(args: unknown[]): unknown[] | Record<string, unknown> {
    if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && !Buffer.isBuffer(args[0])) {
      return args[0] as Record<string, unknown>
    }
    return args
  }

  class FakeDatabase {
    open = true
    constructor(public path: string) {
      openedDbs.push(path)
    }
    pragma(expr: string) {
      fakePragmas.push(expr)
      if (expr === 'user_version') return [{ user_version: 0 }]
      if (expr.startsWith('table_info')) return [{ name: 'id', type: 'INTEGER' }]
      return []
    }
    prepare(sql: string) {
      return {
        all: (...args: unknown[]) => {
          fakeCalls.push({ sql, method: 'all', params: normalizeArgs(args) })
          return [{ sql }]
        },
        run: (...args: unknown[]) => {
          fakeCalls.push({ sql, method: 'run', params: normalizeArgs(args) })
          const id = nextLastInsertRowid++
          return { changes: 1, lastInsertRowid: id }
        },
        get: (...args: unknown[]) => {
          fakeCalls.push({ sql, method: 'get', params: normalizeArgs(args) })
          return { sql }
        },
      }
    }
    transaction<T>(fn: (...args: unknown[]) => T) {
      return (...args: unknown[]) => fn(...args)
    }
    close() {
      this.open = false
    }
  }

  vi.doMock('better-sqlite3', () => ({ default: FakeDatabase }))

  return {
    fakeCalls,
    fakePragmas,
    openedDbs,
    resetFakeState() {
      fakeCalls.length = 0
      fakePragmas.length = 0
      openedDbs.length = 0
      nextLastInsertRowid = 1
    },
  }
})

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../git-run', () => ({ gitRun: vi.fn() }))
vi.mock('../path-security', () => ({ sanitizeGitRef: vi.fn((s: string) => s) }))
vi.mock('../git-status-utils', () => ({ parseGitStatusFiles: vi.fn(() => []) }))

import { cacheAppPaths } from './miniapp-service'
import { handleDbRequest, closeDbForApp, closeAllDbConnections } from './miniapp-db'

let testRoot: string

function setupApp(appId: string) {
  const installDir = join(testRoot, appId)
  cacheAppPaths(appId, { installDir, assetDir: installDir })
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'miniapp-db-test-'))
  resetFakeState()
})

afterEach(() => {
  for (const id of ['app-a', 'app-b', 'app-isolation-1', 'app-isolation-2']) {
    closeDbForApp(id)
  }
  if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true })
})

describe('DB file location and bootstrap', () => {
  it('creates the data dir and opens DB at <installDir>/data/main.db', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 1' })

    expect(openedDbs).toEqual([join(testRoot, 'app-a', 'data', 'main.db')])
    expect(existsSync(join(testRoot, 'app-a', 'data'))).toBe(true)
  })

  it('sets WAL + trusted_schema=OFF + foreign_keys=ON on first open', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 1' })

    expect(fakePragmas).toContain('journal_mode = WAL')
    expect(fakePragmas).toContain('trusted_schema = OFF')
    expect(fakePragmas).toContain('foreign_keys = ON')
  })

  it('reuses cached connection across requests', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 1' })
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 2' })

    expect(openedDbs).toHaveLength(1)
  })

  it('opens distinct DB files for distinct apps', async () => {
    setupApp('app-isolation-1')
    setupApp('app-isolation-2')

    await handleDbRequest('app-isolation-1', 'query', { sql: 'SELECT 1' })
    await handleDbRequest('app-isolation-2', 'query', { sql: 'SELECT 1' })

    expect(openedDbs).toEqual([
      join(testRoot, 'app-isolation-1', 'data', 'main.db'),
      join(testRoot, 'app-isolation-2', 'data', 'main.db'),
    ])
  })
})

describe('handleDbRequest — query/exec routing', () => {
  it('query forwards to stmt.all with positional params', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', {
      sql: 'SELECT * FROM notes WHERE id = ?',
      params: [42],
    })

    const call = fakeCalls.find((c) => c.sql.includes('SELECT'))!
    expect(call.method).toBe('all')
    expect(call.params).toEqual([42])
  })

  it('query forwards named params as a single object', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', {
      sql: 'SELECT * FROM notes WHERE ts > @since',
      params: { since: 1234 },
    })

    const call = fakeCalls.find((c) => c.method === 'all')!
    expect(call.params).toEqual({ since: 1234 })
  })

  it('exec forwards to stmt.run and returns changes/lastInsertRowid', async () => {
    setupApp('app-a')
    const result = await handleDbRequest('app-a', 'exec', {
      sql: 'INSERT INTO notes (content) VALUES (?)',
      params: ['hi'],
    }) as { changes: number; lastInsertRowid: number }

    expect(result).toEqual({ changes: 1, lastInsertRowid: 1 })
    const call = fakeCalls.find((c) => c.method === 'run')!
    expect(call.params).toEqual(['hi'])
  })

  it('Uint8Array params are marshalled to Buffer for better-sqlite3', async () => {
    setupApp('app-a')
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await handleDbRequest('app-a', 'exec', {
      sql: 'INSERT INTO files (blob) VALUES (?)',
      params: [data],
    })

    const call = fakeCalls.find((c) => c.method === 'run')!
    const params = call.params as Buffer[]
    expect(Buffer.isBuffer(params[0])).toBe(true)
    expect(Array.from(params[0])).toEqual([1, 2, 3, 4, 5])
  })

  it('ArrayBuffer params are marshalled to Buffer', async () => {
    setupApp('app-a')
    const buf = new ArrayBuffer(3)
    new Uint8Array(buf).set([10, 20, 30])
    await handleDbRequest('app-a', 'exec', { sql: 'INSERT INTO x VALUES (?)', params: [buf] })

    const call = fakeCalls.find((c) => c.method === 'run')!
    const params = call.params as Buffer[]
    expect(Buffer.isBuffer(params[0])).toBe(true)
    expect(Array.from(params[0])).toEqual([10, 20, 30])
  })
})

describe('handleDbRequest — batch', () => {
  it('runs all statements (each as a stmt.run call)', async () => {
    setupApp('app-a')
    const results = await handleDbRequest('app-a', 'batch', {
      statements: [
        { sql: 'INSERT INTO a VALUES (?)', params: [1] },
        { sql: 'INSERT INTO b VALUES (?)', params: [2] },
      ],
    }) as Array<{ changes: number; lastInsertRowid: number }>

    expect(results).toHaveLength(2)
    expect(results[0].changes).toBe(1)
    const runs = fakeCalls.filter((c) => c.method === 'run')
    expect(runs.map((c) => c.params)).toEqual([[1], [2]])
  })

  it('rejects empty statements array', async () => {
    setupApp('app-a')
    await expect(handleDbRequest('app-a', 'batch', { statements: [] })).rejects.toThrow(/non-empty/i)
  })
})

describe('handleDbRequest — pragma whitelist', () => {
  it('reads user_version', async () => {
    setupApp('app-a')
    const result = await handleDbRequest('app-a', 'pragma', { name: 'user_version' }) as Array<{ user_version: number }>
    expect(result).toEqual([{ user_version: 0 }])
  })

  it('writes user_version with a numeric value', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'pragma', { name: 'user_version', value: 7 })
    expect(fakePragmas).toContain('user_version = 7')
  })

  it('writes string-valued pragma with quoting', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'pragma', { name: 'journal_mode', value: 'WAL' })
    expect(fakePragmas).toContain("journal_mode = 'WAL'")
  })

  it('reads table_info(notes) whitelist entry', async () => {
    setupApp('app-a')
    const result = await handleDbRequest('app-a', 'pragma', { name: 'table_info(notes)' }) as Array<{ name: string }>
    expect(result[0].name).toBe('id')
  })

  it('rejects PRAGMA outside whitelist', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'compile_options' })
    ).rejects.toThrow(/not allowed/i)
  })

  it('rejects PRAGMA with empty name', async () => {
    setupApp('app-a')
    await expect(handleDbRequest('app-a', 'pragma', { name: '' })).rejects.toThrow(/required/i)
  })

  it('rejects PRAGMA name with multi-statement injection', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'table_info(notes); SELECT 1' })
    ).rejects.toThrow(/invalid format/i)
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version=99' })
    ).rejects.toThrow(/invalid format/i)
  })

  it('rejects PRAGMA name with whitespace inside identifier', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version foo' })
    ).rejects.toThrow(/invalid format/i)
  })

  it('rejects non-string non-number value', async () => {
    setupApp('app-a')
    const malicious = { toString: () => "1; ATTACH '/tmp/o.db' AS o" }
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version', value: malicious })
    ).rejects.toThrow(/string or number/i)
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version', value: true })
    ).rejects.toThrow(/string or number/i)
  })

  it('rejects non-finite numeric value', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version', value: NaN })
    ).rejects.toThrow(/finite/i)
    await expect(
      handleDbRequest('app-a', 'pragma', { name: 'user_version', value: Infinity })
    ).rejects.toThrow(/finite/i)
  })
})

describe('handleDbRequest — security (SQL keyword blacklist)', () => {
  it('blocks ATTACH DATABASE in query/exec', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'exec', { sql: "ATTACH DATABASE '/tmp/o.db' AS o" })
    ).rejects.toThrow(/forbidden/i)
    await expect(
      handleDbRequest('app-a', 'query', { sql: "ATTACH DATABASE '/tmp/o.db' AS o; SELECT 1" })
    ).rejects.toThrow(/forbidden/i)
  })

  it('blocks DETACH DATABASE', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'exec', { sql: 'DETACH DATABASE other' })
    ).rejects.toThrow(/forbidden/i)
  })

  it('blocks load_extension in any case', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'query', { sql: "SELECT load_extension('/x.so')" })
    ).rejects.toThrow(/forbidden/i)
    await expect(
      handleDbRequest('app-a', 'query', { sql: "select LOAD_EXTENSION('/x.so')" })
    ).rejects.toThrow(/forbidden/i)
  })

  it('blocks ATTACH inside batch — first statement wins', async () => {
    setupApp('app-a')
    await expect(
      handleDbRequest('app-a', 'batch', {
        statements: [
          { sql: 'CREATE TABLE x (id INTEGER)' },
          { sql: "ATTACH DATABASE '/tmp/o.db' AS o" },
        ],
      })
    ).rejects.toThrow(/forbidden/i)
    expect(fakeCalls.filter((c) => c.method === 'run')).toHaveLength(0)
  })

  it('rejects empty SQL', async () => {
    setupApp('app-a')
    await expect(handleDbRequest('app-a', 'exec', { sql: '' })).rejects.toThrow(/non-empty/i)
  })

  it('rejects non-string SQL', async () => {
    setupApp('app-a')
    await expect(handleDbRequest('app-a', 'exec', { sql: null })).rejects.toThrow(/non-empty/i)
  })
})

describe('closeDbForApp', () => {
  it('forces re-open on next request', async () => {
    setupApp('app-a')
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 1' })
    expect(openedDbs).toHaveLength(1)

    closeDbForApp('app-a')
    await handleDbRequest('app-a', 'query', { sql: 'SELECT 1' })
    expect(openedDbs).toHaveLength(2)
  })

  it('is a no-op for unknown appId', () => {
    expect(() => closeDbForApp('never-opened')).not.toThrow()
  })
})

describe('closeAllDbConnections', () => {
  it('closes every cached connection so each re-opens fresh', async () => {
    setupApp('app-isolation-1')
    setupApp('app-isolation-2')
    await handleDbRequest('app-isolation-1', 'query', { sql: 'SELECT 1' })
    await handleDbRequest('app-isolation-2', 'query', { sql: 'SELECT 1' })
    expect(openedDbs).toHaveLength(2)

    closeAllDbConnections()

    await handleDbRequest('app-isolation-1', 'query', { sql: 'SELECT 1' })
    await handleDbRequest('app-isolation-2', 'query', { sql: 'SELECT 1' })
    expect(openedDbs).toHaveLength(4)
  })

  it('is a no-op when no connections are open', () => {
    expect(() => closeAllDbConnections()).not.toThrow()
  })
})

describe('handleDbRequest — unknown op', () => {
  it('throws for unrecognized op', async () => {
    setupApp('app-a')
    await expect(handleDbRequest('app-a', 'bogus' as never, {})).rejects.toThrow(/unknown db operation/i)
  })
})
