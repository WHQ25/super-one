import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyStorageAction, type StorageActionContext } from './storage-actions'
import { measureStorageInventory, type StorageRoots } from './storage-inventory'

let root: string
afterEach(() => {
  if (root) spawnSync('chflags', ['-R', 'nouchg', root])
  rmSync(root, { recursive: true, force: true })
})

function paths(): StorageRoots {
  root = mkdtempSync(join(tmpdir(), 'superone-storage-action-'))
  return { userData: join(root, 'user'), logs: join(root, 'logs'), harnessHome: join(root, 'harness') }
}

function write(path: string, text = 'x'): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function ctx(roots: StorageRoots, patch: Partial<StorageActionContext> = {}): StorageActionContext {
  return {
    roots,
    compactNodeEvents: vi.fn(async () => ({ removedRows: 2, freedBytes: 80, floor: '9', vacuum: 'skipped' as const })),
    clearBrowserCache: vi.fn(async () => {}),
    clearBrowserCodeCache: vi.fn(async () => {}),
    clearBrowserSiteData: vi.fn(async () => {}),
    clearAppCache: vi.fn(async () => {}),
    clearAppCodeCache: vi.fn(async () => {}),
    ...patch,
  }
}

describe('applyStorageAction', () => {
  it('deletes every chat backup and leaves the live database', async () => {
    const roots = paths()
    const live = join(roots.userData, 'superone.db')
    const retained = join(roots.userData, 'backups', 'superone-schema4-20260401-040404.db')
    const older = join(roots.userData, 'backups', 'superone-schema1-20260101-010101.db')
    const partial = join(roots.userData, 'backups', 'superone-schema4-20260401-040404.db.tmp')
    const corrupt = join(roots.userData, 'superone.corrupt-20260101-010101.db')
    write(live, 'live')
    write(retained, 'snap')
    write(older, 'old')
    write(partial, 'tmp')
    write(corrupt, 'bad')

    const result = await applyStorageAction('delete-backups', ctx(roots))

    expect(result.removedBytes).toBeGreaterThan(0)
    expect(existsSync(retained)).toBe(false)
    expect(existsSync(older)).toBe(false)
    expect(existsSync(partial)).toBe(false)
    expect(existsSync(live)).toBe(true)
    expect(existsSync(corrupt)).toBe(true)
  })

  it('clears extra copies of one harness and leaves the other harness alone', async () => {
    const roots = paths()
    const claudeOld = join(roots.harnessHome, 'claude', 'versions', '1.0', 'bin')
    const claudeCurrent = join(roots.harnessHome, 'claude', 'versions', '1.2', 'bin')
    const claudePrevious = join(roots.harnessHome, 'claude', 'versions', '1.1', 'bin')
    const codexPrevious = join(roots.harnessHome, 'codex', 'versions', '9.0', 'bin')
    const codexCurrent = join(roots.harnessHome, 'codex', 'versions', '9.1', 'bin')
    write(claudeOld)
    write(claudePrevious)
    write(claudeCurrent)
    write(codexPrevious)
    write(codexCurrent)
    const stamp = (file: string, seconds: number) => utimesSync(join(file, '..'), seconds, seconds)
    stamp(claudeOld, 1)
    stamp(claudePrevious, 2)
    stamp(claudeCurrent, 3)
    stamp(codexPrevious, 1)
    stamp(codexCurrent, 4)
    writeFileSync(join(roots.harnessHome, 'claude', 'current'), JSON.stringify({ runtimeVersion: '1.2' }))
    writeFileSync(join(roots.harnessHome, 'codex', 'current'), JSON.stringify({ runtimeVersion: '9.1' }))

    await applyStorageAction('clear-unused-harness-runtimes', { ...ctx(roots), harnessId: 'claude' })

    expect(existsSync(claudeOld)).toBe(false)
    expect(existsSync(claudePrevious)).toBe(false)
    expect(existsSync(claudeCurrent)).toBe(true)
    expect(existsSync(codexPrevious)).toBe(true)
    expect(existsSync(codexCurrent)).toBe(true)
  })

  it('removes previous versions of every harness and keeps only active versions when optimizing at once', async () => {
    const roots = paths()
    const claudePrevious = join(roots.harnessHome, 'claude', 'versions', '1.1', 'bin')
    const claudeCurrent = join(roots.harnessHome, 'claude', 'versions', '1.2', 'bin')
    const claudeOld = join(roots.harnessHome, 'claude', 'versions', '1.0', 'bin')
    const codexPrevious = join(roots.harnessHome, 'codex', 'versions', '9.0', 'bin')
    const codexCurrent = join(roots.harnessHome, 'codex', 'versions', '9.1', 'bin')
    write(claudeOld)
    write(claudePrevious)
    write(claudeCurrent)
    write(codexPrevious)
    write(codexCurrent)
    const stamp = (file: string, seconds: number) => utimesSync(join(file, '..'), seconds, seconds)
    stamp(claudeOld, 1)
    stamp(claudePrevious, 2)
    stamp(claudeCurrent, 3)
    stamp(codexPrevious, 2)
    stamp(codexCurrent, 4)
    writeFileSync(join(roots.harnessHome, 'claude', 'current'), JSON.stringify({ runtimeVersion: '1.2' }))
    writeFileSync(join(roots.harnessHome, 'codex', 'current'), JSON.stringify({ runtimeVersion: '9.1' }))

    await applyStorageAction('clear-unused-harness-runtimes', ctx(roots))

    expect(existsSync(claudeOld)).toBe(false)
    expect(existsSync(claudePrevious)).toBe(false)
    expect(existsSync(claudeCurrent)).toBe(true)
    expect(existsSync(codexPrevious)).toBe(false)
    expect(existsSync(codexCurrent)).toBe(true)
  })

  it('deletes the whole retired Antigravity runtime and leaves the harness that is still in use', async () => {
    const roots = paths()
    const retired = join(roots.harnessHome, 'acp-antigravity', 'bootstrap', 'bin', 'tool')
    const venv = join(roots.harnessHome, 'acp-antigravity', 'versions', 'lib', 'python')
    const claudeCurrent = join(roots.harnessHome, 'claude', 'versions', '1.2', 'bin')
    write(retired)
    write(venv)
    write(claudeCurrent)
    writeFileSync(join(roots.harnessHome, 'claude', 'current'), JSON.stringify({ runtimeVersion: '1.2' }))

    await applyStorageAction('clear-unused-harness-runtimes', { ...ctx(roots), harnessId: 'acp-antigravity' })

    expect(existsSync(join(roots.harnessHome, 'acp-antigravity'))).toBe(false)
    expect(existsSync(claudeCurrent)).toBe(true)
  })

  it('trims older backups and keeps the restore point', async () => {
    const roots = paths()
    const live = join(roots.userData, 'superone.db')
    const retained = join(roots.userData, 'backups', 'superone-schema4-20260401-040404.db')
    const older = join(roots.userData, 'backups', 'superone-schema1-20260101-010101.db')
    const partial = join(roots.userData, 'backups', 'superone-schema4-20260401-040404.db.tmp')
    write(live, 'live')
    write(retained, 'snap')
    write(older, 'old')
    write(partial, 'tmp')

    await applyStorageAction('trim-extra-backups', ctx(roots))

    expect(existsSync(retained)).toBe(true)
    expect(existsSync(older)).toBe(false)
    expect(existsSync(partial)).toBe(false)
    expect(existsSync(live)).toBe(true)
  })

  it('clears attachment directories and leaves generated media', async () => {
    const roots = paths()
    const attachment = join(roots.userData, 'sync', 's1', 'attachment', 'a.png')
    const media = join(roots.userData, 'sync', 's1', 'media-gen', 'b.png')
    write(attachment)
    write(media)

    await applyStorageAction('clear-sync-attachments', ctx(roots))

    expect(existsSync(attachment)).toBe(false)
    expect(existsSync(media)).toBe(true)
    const inventory = measureStorageInventory({ roots })
    expect(inventory.categories.find((category) => category.id === 'sync-media')?.bytes).toBeGreaterThan(0)
  })

  it('asks the browser session to clear site data and reports the bytes that went away', async () => {
    const roots = paths()
    const file = join(roots.userData, 'Partitions', 'browser', 'Service Worker', 'cache')
    write(file, 'offline')
    const clearBrowserSiteData = vi.fn(async () => { rmSync(file) })

    const result = await applyStorageAction('clear-browser-site-data', ctx(roots, { clearBrowserSiteData }))

    expect(clearBrowserSiteData).toHaveBeenCalledOnce()
    expect(result.removedBytes).toBe(Buffer.byteLength('offline'))
    expect(existsSync(file)).toBe(false)
  })

  it('compacts through the injected node connection and returns its result', async () => {
    const roots = paths()
    const compactNodeEvents = vi.fn(async () => ({ removedRows: 4, freedBytes: 20, floor: '11', vacuum: 'done' as const }))

    const result = await applyStorageAction('compact-node-events', ctx(roots, { compactNodeEvents }))

    expect(compactNodeEvents).toHaveBeenCalledWith(true)
    expect(result.compact).toMatchObject({ removedRows: 4, floor: '11', vacuum: 'done' })
  })

  it('clears app cache through the default session and leaves the GPU cache', async () => {
    const roots = paths()
    const http = join(roots.userData, 'Cache', 'data')
    const code = join(roots.userData, 'Code Cache', 'js')
    const gpu = join(roots.userData, 'GPUCache', 'data')
    write(http, 'http-cache')
    write(code, 'code')
    write(gpu, 'gpu')
    const clearAppCache = vi.fn(async () => { rmSync(http) })
    const clearAppCodeCache = vi.fn(async () => { rmSync(code) })

    const result = await applyStorageAction('clear-app-cache', ctx(roots, { clearAppCache, clearAppCodeCache }))

    expect(clearAppCache).toHaveBeenCalledOnce()
    expect(clearAppCodeCache).toHaveBeenCalledOnce()
    expect(result.removedBytes).toBe(Buffer.byteLength('http-cache') + Buffer.byteLength('code'))
    expect(existsSync(http)).toBe(false)
    expect(existsSync(code)).toBe(false)
    expect(existsSync(gpu)).toBe(true)
  })

  it.skipIf(process.platform !== 'darwin')('counts only the log bytes that were actually removed', async () => {
    const roots = paths()
    const free = join(roots.logs, 'old.log')
    const busy = join(roots.logs, 'live.log')
    write(free, '12345')
    write(busy, '123')
    expect(spawnSync('chflags', ['uchg', busy]).status).toBe(0)

    const result = await applyStorageAction('clear-logs', ctx(roots))

    expect(existsSync(roots.logs)).toBe(true)
    expect(existsSync(free)).toBe(false)
    expect(existsSync(busy)).toBe(true)
    expect(result.removedBytes).toBe(5)
  })

  it('empties a log directory without removing the directory', async () => {
    const roots = paths()
    write(join(roots.logs, 'main.log'), 'log')

    await applyStorageAction('clear-logs', ctx(roots))

    expect(existsSync(roots.logs)).toBe(true)
    expect(existsSync(join(roots.logs, 'main.log'))).toBe(false)
  })

  it.skipIf(process.platform !== 'darwin')('never follows a directory symlink into external files during fallback deletion', async () => {
    const roots = paths()
    const externalDir = join(root, 'outside')
    const externalFile = join(externalDir, 'important.txt')
    write(externalFile, 'keep-me')
    const subLogDir = join(roots.logs, 'nested')
    const lockedFile = join(subLogDir, 'locked.log')
    write(lockedFile, 'locked')
    symlinkSync(externalDir, join(subLogDir, 'linked-outside'))
    expect(spawnSync('chflags', ['uchg', lockedFile]).status).toBe(0)

    await applyStorageAction('clear-logs', ctx(roots))

    expect(existsSync(externalFile)).toBe(true)
    expect(existsSync(join(subLogDir, 'linked-outside'))).toBe(false)
  })

  it('skips sync directories with active uploads and leaves nested download folders intact', async () => {
    const roots = paths()
    const uploading = join(roots.userData, 'sync', 's-uploading', 'attachment', 'draft.png')
    const idle = join(roots.userData, 'sync', 's-idle', 'attachment', 'old.png')
    const nestedDownload = join(roots.userData, 'sync', 's-idle', 'download', 'archive', 'attachment', 'keep.png')
    write(uploading, '1234')
    write(idle, '123456')
    write(nestedDownload, 'keep')
    const cleared: string[] = []

    const result = await applyStorageAction('clear-sync-attachments', ctx(roots, {
      isSyncDirProtected: (sessionId) => sessionId === 's-uploading',
      onSyncDirCleared: (sessionId) => { cleared.push(sessionId) },
    }))

    expect(result.removedBytes).toBe(6)
    expect(existsSync(uploading)).toBe(true)
    expect(existsSync(idle)).toBe(false)
    expect(existsSync(nestedDownload)).toBe(true)
    expect(cleared).toEqual(['s-idle'])
  })
})
