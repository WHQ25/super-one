import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ configuredDir: null as string | null, osDownloads: '' }))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'downloads' ? state.osDownloads : '/tmp') },
}))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({ browserDownloadDir: state.configuredDir }),
}))

import { reserveDownloadPath, resolveDownloadDir, systemDownloadDir } from './browser-download-store'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'so-dl-'))
  state.osDownloads = join(root, 'os-downloads')
  state.configuredDir = null
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('download directory resolution', () => {
  it('falls back to the OS Downloads folder when nothing is configured', () => {
    expect(resolveDownloadDir()).toBe(state.osDownloads)
    expect(reserveDownloadPath('a.txt')).toBe(join(state.osDownloads, 'a.txt'))
  })

  it("prefers the user's configured directory over the OS folder", () => {
    state.configuredDir = join(root, 'custom')
    expect(reserveDownloadPath('a.txt')).toBe(join(root, 'custom', 'a.txt'))
  })

  it('lets an explicit directory win over the configured default, creating it', () => {
    state.configuredDir = join(root, 'custom')
    const path = reserveDownloadPath('a.txt', join(root, 'project', 'assets'))
    expect(path).toBe(join(root, 'project', 'assets', 'a.txt'))
    expect(existsSync(path)).toBe(true)
  })

  it('rejects a relative directory rather than resolving it against the main process cwd', () => {
    expect(() => reserveDownloadPath('a.txt', './downloads')).toThrow(/absolute path/)
  })

  it('surfaces the error when an explicit directory cannot be created', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'not a directory')
    expect(() => reserveDownloadPath('a.txt', join(blocker, 'sub'))).toThrow()
  })

  it('degrades to the OS folder when the configured default cannot be created', () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'not a directory')
    state.configuredDir = join(blocker, 'sub')
    expect(reserveDownloadPath('a.txt')).toBe(join(state.osDownloads, 'a.txt'))
  })
})

describe('download filename collisions', () => {
  beforeEach(() => {
    state.configuredDir = join(root, 'custom')
  })

  it('numbers repeats instead of overwriting an existing file', () => {
    expect(reserveDownloadPath('report.pdf')).toBe(join(root, 'custom', 'report.pdf'))
    expect(reserveDownloadPath('report.pdf')).toBe(join(root, 'custom', 'report (1).pdf'))
    expect(reserveDownloadPath('report.pdf')).toBe(join(root, 'custom', 'report (2).pdf'))
  })

  it('keeps the suffix before the extension so the file type still resolves', () => {
    reserveDownloadPath('archive.tar.gz')
    expect(reserveDownloadPath('archive.tar.gz')).toBe(join(root, 'custom', 'archive.tar (1).gz'))
  })

  it('numbers extensionless names too', () => {
    reserveDownloadPath('LICENSE')
    expect(reserveDownloadPath('LICENSE')).toBe(join(root, 'custom', 'LICENSE (1)'))
  })

  it('reserves the path on disk so a concurrent download cannot claim it', () => {
    const first = reserveDownloadPath('data.csv')
    expect(existsSync(first)).toBe(true)
  })
})

describe('systemDownloadDir', () => {
  it('reports the OS Downloads folder', () => {
    expect(systemDownloadDir()).toBe(state.osDownloads)
  })
})
