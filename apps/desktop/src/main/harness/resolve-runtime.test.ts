import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const harnessHome = { current: '' as string }
let testDb: Database.Database | null = null

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../database', () => ({
  getDb: () => {
    if (!testDb) {
      testDb = new Database(':memory:')
      testDb.exec(`
        CREATE TABLE harness_installations (
          harness_id TEXT PRIMARY KEY NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'disabled',
          runtime_version TEXT,
          command TEXT,
          config_json TEXT,
          secret_ref TEXT,
          diagnostic_code TEXT,
          diagnostic_message TEXT,
          last_probed_at INTEGER,
          updated_at INTEGER NOT NULL
        );
      `)
    }
    return testDb
  },
}))

vi.mock('../providers/credential-store', () => ({
  getBinding: vi.fn(() => undefined),
  listCredentials: vi.fn(() => []),
  getCredentialDecrypted: vi.fn(() => undefined),
}))

vi.mock('./home', () => ({
  resolveHarnessHomeRoot: () => harnessHome.current,
}))

vi.mock('../agent/claude-binary', () => ({
  resolveSdkClaudeBinary: vi.fn(() => undefined),
}))

vi.mock('../codex/app-server-connection', () => ({
  findSystemCodexCli: vi.fn(() => null),
  resolveCodexNativeBinary: vi.fn(() => null),
  resolveCodexPlatformPackage: vi.fn(() => null),
  hasCodexPlatformPackage: vi.fn(() => false),
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.52.0-test', getPath: () => tmpdir() },
}))

const { getHarnessManager, resetHarnessManagerForTests, enableDesktopHarness } = await import(
  './service'
)
const { resolveHarnessRuntime, HarnessNotReadyError, isHarnessNotReadyError } = await import(
  './resolve-runtime'
)

function resetDb(): void {
  testDb?.close()
  testDb = null
  resetHarnessManagerForTests()
}

describe('resolveHarnessRuntime', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'so-rt-'))
    harnessHome.current = home
    resetDb()
    delete process.env.SUPERONE_CLAUDE_BINARY
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
    resetDb()
  })

  it('throws HarnessNotReadyError when nothing is installed', () => {
    expect(() => resolveHarnessRuntime('claude')).toThrow(HarnessNotReadyError)
    try {
      resolveHarnessRuntime('claude')
    } catch (err) {
      expect(isHarnessNotReadyError(err)).toBe(true)
      if (err instanceof HarnessNotReadyError) {
        expect(err.harnessId).toBe('claude')
        expect(err.enabled).toBe(false)
      }
    }
  })

  it('resolves after enable pins an existing binary via env', async () => {
    const bin = join(home, 'fake-claude')
    writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 })
    process.env.SUPERONE_CLAUDE_BINARY = bin

    const status = await enableDesktopHarness({ harnessId: 'claude' })
    expect(status.enabled).toBe(true)
    expect(status.command).toBe(bin)

    const resolved = resolveHarnessRuntime('claude')
    expect(resolved).toBe(bin)
  })

  it('manager ensures harness_installations rows exist', () => {
    const m = getHarnessManager()
    const list = m.list()
    expect(list.map((h) => h.id).sort()).toEqual(['acp-grok', 'claude', 'codex', 'cursor', 'opencode'])
    expect(list.every((h) => h.enabled === false && h.state === 'disabled')).toBe(true)
  })
})
