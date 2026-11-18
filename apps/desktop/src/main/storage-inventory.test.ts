import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessRuntimeUsage, measureStorageInventory, unusedHarnessPaths, type StorageRoots } from './storage-inventory'

let root: string
afterEach(() => rmSync(root, { recursive: true, force: true }))

function roots(): StorageRoots {
  root = mkdtempSync(join(tmpdir(), 'superone-storage-'))
  return { userData: join(root, 'user'), logs: join(root, 'logs'), harnessHome: join(root, 'harness') }
}

function write(path: string, bytes: number): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 1))
}

describe('measureStorageInventory', () => {
  it('sums each category and hides empty leftovers', () => {
    const paths = roots()
    write(join(paths.userData, 'superone.db'), 100)
    write(join(paths.userData, 'superone.db-wal'), 10)
    write(join(paths.userData, 'backups', 'superone-schema2-20260201-020202.db'), 40)
    write(join(paths.userData, 'backups', 'superone-schema1-20260101-010101.db'), 30)
    write(join(paths.userData, 'backups', 'superone-schema1-20260101-010101.db.tmp'), 5)
    write(join(paths.userData, 'superone.corrupt-20260101-010101.db'), 20)
    write(join(paths.userData, 'Partitions', 'browser', 'Cache', 'data'), 15)
    write(join(paths.userData, 'Partitions', 'browser', 'Code Cache', 'js'), 8)
    write(join(paths.userData, 'Partitions', 'browser', 'Service Worker', 'cache'), 50)
    write(join(paths.userData, 'node-host', 'node.db'), 70)
    write(join(paths.userData, 'sync', 'session-a', 'attachment', 'a.png'), 12)
    write(join(paths.userData, 'sync', 'session-a', 'media-gen', 'b.png'), 9)
    write(join(paths.userData, 'Cache', 'cache'), 6)
    write(join(paths.userData, 'cursor-sdk', 'hash', 'agent-store.db'), 11)
    write(join(paths.logs, 'main.log'), 4)

    const inventory = measureStorageInventory({
      roots: paths,
      nodeEventStats: { rows: 12, retentionFloor: '3', lastCompactAt: 9, lastFreedBytes: 100 },
    })
    const byId = Object.fromEntries(inventory.categories.map((category) => [category.id, category]))

    expect(byId['chat-database']?.bytes).toBe(121)
    expect(byId['chat-database']?.actions).toEqual(['reveal'])
    expect(byId.backup?.bytes).toBe(75)
    expect(byId.backup?.unusedBytes).toBe(35)
    expect(byId.backup?.path).toBe(join(paths.userData, 'backups'))
    expect(byId.backup?.actions).toEqual(['reveal', 'delete-backups'])
    expect(byId['recovery-leftovers']?.bytes).toBe(20)
    expect(byId['browser-http-cache']?.bytes).toBe(15)
    expect(byId['browser-code-cache']?.bytes).toBe(8)
    expect(byId['browser-site-data']?.bytes).toBe(50)
    expect(byId['node-event-log']?.bytes).toBe(70)
    expect(byId['node-event-log']?.count).toBe(12)
    expect(byId['sync-attachments']?.bytes).toBe(12)
    expect(byId['sync-media']?.bytes).toBe(9)
    expect(byId['app-cache']?.bytes).toBe(6)
    expect(byId['app-cache']?.unusedBytes).toBe(6)
    expect(byId['cursor-sdk']).toBeUndefined()
    expect(inventory.harnessRuntimes).toEqual([])
    expect(byId.logs?.bytes).toBe(4)
    expect(inventory.nodeEvents?.retentionFloor).toBe('3')
  })

  it('counts the GPU cache in the total and leaves it out of the clearable bytes', () => {
    const paths = roots()
    write(join(paths.userData, 'Cache', 'data'), 6)
    write(join(paths.userData, 'Code Cache', 'js'), 4)
    write(join(paths.userData, 'GPUCache', 'data'), 8)
    const category = measureStorageInventory({ roots: paths }).categories.find((item) => item.id === 'app-cache')
    expect(category?.bytes).toBe(18)
    expect(category?.unusedBytes).toBe(10)
  })

  it('keeps the zero rows a person can still clear and omits an empty snapshot', () => {
    const inventory = measureStorageInventory({ roots: roots() })
    const ids = inventory.categories.map((category) => category.id)
    expect(ids).toContain('chat-database')
    expect(ids).toContain('browser-http-cache')
    expect(ids).toContain('node-event-log')
    expect(ids).toContain('sync-attachments')
    expect(ids).toContain('app-cache')
    expect(ids).toContain('logs')
    expect(ids).not.toContain('backup')
    expect(ids).not.toContain('recovery-leftovers')
    expect(ids).not.toContain('cursor-sdk')
    expect(ids).not.toContain('harness-runtimes')
    expect(inventory.harnessRuntimes).toEqual([])
  })
})

describe('unusedHarnessPaths', () => {
  it('keeps only the current runtime and drops older copies and partial downloads', () => {
    const paths = roots()
    const prefix = join(paths.harnessHome, 'claude')
    const versions = join(prefix, 'versions')
    write(join(versions, '1.0', 'bin'), 10)
    write(join(versions, '1.1', 'bin'), 10)
    write(join(versions, '1.2', 'bin'), 10)
    write(join(versions, '1.2', 'payload.download'), 5)
    write(join(paths.harnessHome, '.download', 'part'), 7)
    const stamp = (version: string, seconds: number) => utimesSync(join(versions, version), seconds, seconds)
    stamp('1.0', 1)
    stamp('1.1', 2)
    stamp('1.2', 3)
    mkdirSync(prefix, { recursive: true })
    writeFileSync(join(prefix, 'current'), JSON.stringify({ runtimeVersion: '1.2' }))

    const unused = unusedHarnessPaths(paths.harnessHome).sort()
    expect(unused).toEqual([
      join(paths.harnessHome, '.download'),
      join(versions, '1.0'),
      join(versions, '1.1'),
      join(versions, '1.2', 'payload.download'),
    ].sort())
  })

  it('keeps each harness active version independently and marks all other versions unused', () => {
    const paths = roots()
    const claude = join(paths.harnessHome, 'claude', 'versions')
    const codex = join(paths.harnessHome, 'codex', 'versions')
    write(join(claude, '1.0', 'bin'), 10)
    write(join(claude, '1.1', 'bin'), 10)
    write(join(claude, '1.2', 'bin'), 30)
    write(join(codex, '9.0', 'bin'), 40)
    write(join(codex, '9.1', 'bin'), 50)
    const stamp = (dir: string, version: string, seconds: number) => utimesSync(join(dir, version), seconds, seconds)
    stamp(claude, '1.0', 1)
    stamp(claude, '1.1', 2)
    stamp(claude, '1.2', 3)
    stamp(codex, '9.0', 1)
    stamp(codex, '9.1', 4)
    writeFileSync(join(paths.harnessHome, 'claude', 'current'), JSON.stringify({ runtimeVersion: '1.2' }))
    writeFileSync(join(paths.harnessHome, 'codex', 'current'), JSON.stringify({ runtimeVersion: '9.1' }))

    const byId = Object.fromEntries(harnessRuntimeUsage(paths.harnessHome).map((row) => [row.id, row]))
    expect(byId.claude?.unusedPaths).toEqual([join(claude, '1.1'), join(claude, '1.0')])
    expect(byId.claude?.unusedBytes).toBe(20)
    expect(byId.codex?.unusedPaths).toEqual([join(codex, '9.0')])
    expect(byId.codex?.unusedBytes).toBe(40)
    expect(unusedHarnessPaths(paths.harnessHome)).toEqual([
      join(claude, '1.1'),
      join(claude, '1.0'),
      join(codex, '9.0'),
    ])
  })

  it('counts the whole retired Antigravity install as unused', () => {
    const paths = roots()
    const home = join(paths.harnessHome, 'acp-antigravity')
    write(join(home, 'versions', 'lib', 'python'), 20)
    write(join(home, 'bootstrap', 'bin', 'tool'), 8)
    const row = harnessRuntimeUsage(paths.harnessHome).find((item) => item.id === 'acp-antigravity')
    expect(row?.bytes).toBe(28)
    expect(row?.unusedBytes).toBe(28)
    expect(row?.unusedPaths).toEqual([home])
    expect(unusedHarnessPaths(paths.harnessHome)).toEqual([home])
    expect(unusedHarnessPaths(paths.harnessHome, 'acp-antigravity')).toEqual([home])
  })

  it('retains the newest installed version when current points at a missing version', () => {
    const paths = roots()
    const prefix = join(paths.harnessHome, 'claude')
    const versions = join(prefix, 'versions')
    write(join(versions, '1.0', 'bin'), 10)
    write(join(versions, '1.1', 'bin'), 20)
    utimesSync(join(versions, '1.0'), 1, 1)
    utimesSync(join(versions, '1.1'), 2, 2)
    writeFileSync(join(prefix, 'current'), JSON.stringify({ runtimeVersion: '9.9' }))

    expect(unusedHarnessPaths(paths.harnessHome, 'claude')).toEqual([join(versions, '1.0')])
    expect(unusedHarnessPaths(paths.harnessHome)).toEqual([join(versions, '1.0')])
  })

  it('protects pointer installRoot even when its directory name differs from runtimeVersion', () => {
    const paths = roots()
    const prefix = join(paths.harnessHome, 'codex')
    const versions = join(prefix, 'versions')
    const custom = join(versions, 'custom-root')
    write(join(custom, 'bin'), 15)
    write(join(versions, '2.0', 'bin'), 25)
    utimesSync(custom, 1, 1)
    utimesSync(join(versions, '2.0'), 2, 2)
    writeFileSync(join(prefix, 'current'), JSON.stringify({ runtimeVersion: '9.9', installRoot: custom }))

    expect(unusedHarnessPaths(paths.harnessHome, 'codex')).toEqual([join(versions, '2.0')])
  })

  it('ignores non-harness directories like releases and skips harnesses with active installs', () => {
    const paths = roots()
    write(join(paths.harnessHome, 'releases', '0.1.0', 'harnesses', 'claude', '1.0', 'artifact.download'), 50)
    const claudeVersions = join(paths.harnessHome, 'claude', 'versions')
    write(join(claudeVersions, '1.0', 'bin'), 10)
    write(join(claudeVersions, '1.1', 'bin'), 10)
    write(join(claudeVersions, '1.2', 'bin'), 10)
    write(join(paths.harnessHome, '.download', 'active.partial'), 30)
    utimesSync(join(claudeVersions, '1.0'), 1, 1)
    utimesSync(join(claudeVersions, '1.1'), 2, 2)
    utimesSync(join(claudeVersions, '1.2'), 3, 3)
    writeFileSync(join(paths.harnessHome, 'claude', 'current'), JSON.stringify({ runtimeVersion: '1.2' }))

    expect(harnessRuntimeUsage(paths.harnessHome).map((row) => row.id)).toEqual(['claude'])
    expect(unusedHarnessPaths(paths.harnessHome, undefined, new Set(['claude']))).toEqual([])
    expect(unusedHarnessPaths(paths.harnessHome, 'claude', new Set(['claude']))).toEqual([])
  })

  it('marks older Claude copies when the only extract directory is empty', () => {
    const paths = roots()
    const prefix = join(paths.harnessHome, 'claude')
    const versions = join(prefix, 'versions')
    write(join(versions, '1.0', 'bin'), 10)
    write(join(versions, '1.2', 'bin'), 30)
    utimesSync(join(versions, '1.0'), 1, 1)
    utimesSync(join(versions, '1.2'), 2, 2)
    writeFileSync(join(prefix, 'current'), JSON.stringify({ runtimeVersion: '1.2' }))
    const leftover = join(prefix, '.extract-claude-abc')
    mkdirSync(leftover)

    const row = harnessRuntimeUsage(paths.harnessHome).find((item) => item.id === 'claude')
    expect(row?.unusedPaths).toEqual([join(versions, '1.0'), leftover])
    expect(row?.unusedBytes).toBe(10)
    expect(unusedHarnessPaths(paths.harnessHome)).toEqual([join(versions, '1.0'), leftover])

    write(join(leftover, 'partial'), 4)
    expect(harnessRuntimeUsage(paths.harnessHome).find((item) => item.id === 'claude')?.unusedPaths).toEqual([])
    expect(unusedHarnessPaths(paths.harnessHome)).toEqual([])
  })

  it('ignores symlinks and nested producer-like directories inside sync downloads', () => {
    const paths = roots()
    const external = join(root, 'external-keep')
    write(join(external, 'secret.txt'), 99)
    mkdirSync(join(paths.userData, 'sync', 's1'), { recursive: true })
    symlinkSync(external, join(paths.userData, 'sync', 's1', 'attachment'))
    write(join(paths.userData, 'sync', 's1', 'download', 'repo', 'attachment', 'keep.png'), 40)
    write(join(paths.userData, 'sync', 's1', 'agent', 'attachments', 'keep2.png'), 40)
    write(join(paths.userData, 'sync', 's2', 'attachment', 'real.png'), 12)

    const inventory = measureStorageInventory({ roots: paths })
    const attachments = inventory.categories.find((item) => item.id === 'sync-attachments')
    expect(attachments?.bytes).toBe(12)
  })

  it('marks sync files from reclaimable sessions as unusedBytes and preserves syncIssues', () => {
    const paths = roots()
    write(join(paths.userData, 'sync', 'live', 'attachment', 'keep.png'), 15)
    write(join(paths.userData, 'sync', 'dead', 'attachment', 'old.png'), 25)
    write(join(paths.userData, 'sync', 'dead', 'media-gen', 'gen.png'), 10)
    const syncIssues = {
      failedHandoffs: { files: 1, bytes: 4, lastError: 'SQLITE_BUSY' },
      needsRedelivery: { files: 0, bytes: 0 },
    }

    const inventory = measureStorageInventory({
      roots: paths,
      reclaimableSyncSessions: new Set(['dead']),
      syncIssues,
    })
    const attachments = inventory.categories.find((item) => item.id === 'sync-attachments')
    const media = inventory.categories.find((item) => item.id === 'sync-media')
    expect(attachments?.bytes).toBe(40)
    expect(attachments?.unusedBytes).toBe(25)
    expect(media?.bytes).toBe(10)
    expect(media?.unusedBytes).toBe(10)
    expect(inventory.syncIssues).toEqual(syncIssues)
  })
})
