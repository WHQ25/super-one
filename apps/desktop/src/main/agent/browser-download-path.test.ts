import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ configuredDir: null as string | null, osDownloads: '', userData: '/tmp' }))

// The zone's delivery record: a table that cannot be read protects every zone file (R5).
vi.mock('../database', async () => (await import('../../test/fixtures/delivery-db')).deliveryDatabase())
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'downloads' ? state.osDownloads : state.userData) },
}))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../app-settings-service', () => ({
  readAppSettings: () => ({ browserDownloadDir: state.configuredDir }),
}))

import { producerDir, sessionZoneDir } from '../media-output-paths'
import { collectArtifacts, resetArtifactRegistry, takeArtifacts } from '../mcp/artifact-registry'
import { adoptCapturedDownload, reserveDownloadPath, resolveDownloadDir, systemDownloadDir } from './browser-download-store'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'so-dl-'))
  state.osDownloads = join(root, 'os-downloads')
  state.userData = root
  state.configuredDir = null
  resetArtifactRegistry()
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

describe('downloads for a remote session', () => {
  it("lands in the session sync zone rather than this machine's Downloads folder, and is registered", async () => {
    // The agent runs on the node and is handed this path; a file in the
    // desktop's Downloads folder is one it can never open
    // (docs/design/session-sync-zone.md §6).
    const path = await collectArtifacts('s1', 'call-1', async () => reserveDownloadPath('report.pdf', null, 's1'), 'conn-1')
    expect(path).toBe(join(producerDir('s1', 'download'), 'report.pdf'))
    expect(takeArtifacts('s1', 'call-1')).toEqual([{ path, producer: 'download', final: false, deliveryId: expect.any(String) }])
  })

  it('honours a directory inside the zone, which is how a node path arrives after input mapping', async () => {
    const inZone = join(producerDir('s1', 'download'), 'reports')
    const path = await collectArtifacts('s1', 'call-2', async () => reserveDownloadPath('q3.pdf', inZone, 's1'), 'conn-1')
    expect(path).toBe(join(inZone, 'q3.pdf'))
  })

  it('refuses a desktop directory a remote agent could never read, saying what to do instead', async () => {
    await collectArtifacts('s1', 'call-3', async () => {
      expect(() => reserveDownloadPath('q3.pdf', join(root, 'elsewhere'), 's1'))
        .toThrow(/remote session|session directory|SUPERONE_SESSION_DIR/i)
    }, 'conn-1')
  })

  it("refuses another session's zone, and a directory linked out of it", async () => {
    // `dir` is agent input. Containment has to be checked against this
    // session's own canonical directory, not against the zone root as text.
    const { mkdirSync, symlinkSync } = await import('node:fs')
    const other = join(producerDir('s2', 'download'))
    await collectArtifacts('s1', 'call-5', async () => {
      expect(() => reserveDownloadPath('q3.pdf', other, 's1')).toThrow(/remote session|session directory|SUPERONE_SESSION_DIR/i)
    }, 'conn-1')

    const outside = join(root, 'outside')
    mkdirSync(outside, { recursive: true })
    const linked = join(producerDir('s1', 'download'), 'linked')
    mkdirSync(join(linked, '..'), { recursive: true })
    symlinkSync(outside, linked)
    await collectArtifacts('s1', 'call-6', async () => {
      expect(() => reserveDownloadPath('q3.pdf', linked, 's1')).toThrow()
    }, 'conn-1')
    expect(existsSync(join(outside, 'q3.pdf'))).toBe(false)
  })

  it("fails rather than dropping a remote session's download into this machine's Downloads folder", async () => {
    // The zone is the only directory the node's agent can read. Degrading to
    // ~/Downloads the way a broken *configured* default does would report a
    // path that works here and nowhere the agent can look.
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(root, 'sync', 's1'), { recursive: true })
    writeFileSync(producerDir('s1', 'download'), 'a file where the directory should be')
    await collectArtifacts('s1', 'call-7', async () => {
      expect(() => reserveDownloadPath('a.bin', null, 's1')).toThrow()
    }, 'conn-1')
    expect(existsSync(join(state.osDownloads, 'a.bin'))).toBe(false)
  })

  it('adopts a page download without overwriting a zone file of the same name, and only once', async () => {
    // A transcript can already name `download/report.csv`; a page that saves
    // the same name must not replace the bytes that path used to mean. And
    // the agent may list twice — the second call has to return the first
    // adoption rather than copy the file again under a new name.
    const zoneDir = producerDir('s1', 'download')
    mkdirSync(zoneDir, { recursive: true })
    writeFileSync(join(zoneDir, 'report.csv'), 'prior transcript file')
    mkdirSync(state.osDownloads, { recursive: true })
    const captured = join(state.osDownloads, 'report.csv')
    writeFileSync(captured, 'freshly downloaded')

    const first = await collectArtifacts('s1', 'call-8', async () => adoptCapturedDownload('s1', captured), 'conn-1')
    expect(first).not.toBe(join(zoneDir, 'report.csv'))
    expect(readFileSync(join(zoneDir, 'report.csv'), 'utf8')).toBe('prior transcript file')
    expect(readFileSync(first, 'utf8')).toBe('freshly downloaded')

    const second = await collectArtifacts('s1', 'call-9', async () => adoptCapturedDownload('s1', captured), 'conn-1')
    expect(second).toBe(first)
    // Reusing the copy is not the same as having nothing to report: each
    // reply is rewritten from the refs of its own call, so a listing that
    // registers nothing hands the agent the desktop path again.
    // One delivery, named by both replies (R3a): the second listing observes
    // the first adoption's row rather than opening another.
    const [firstRef] = takeArtifacts('s1', 'call-8')
    expect(firstRef).toEqual({ path: first, producer: 'download', final: true, deliveryId: expect.any(String) })
    expect(takeArtifacts('s1', 'call-9')).toEqual([{ path: first, producer: 'download', final: true, deliveryId: firstRef!.deliveryId }])
  })

  it('refuses a session whose own zone directory is a link, explicit dir or not', async () => {
    // Resolving `sync/<id>` through a link would move the boundary to
    // wherever it points, so everything under it then looks "inside the
    // zone" — including the directory it was pointed at.
    const outside = join(root, 'outside')
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(root, 'sync'), { recursive: true })
    symlinkSync(outside, sessionZoneDir('s9'))
    await collectArtifacts('s9', 'call-10', async () => {
      expect(() => reserveDownloadPath('a.txt', null, 's9')).toThrow()
      expect(() => reserveDownloadPath('a.txt', join(sessionZoneDir('s9'), 'download'), 's9')).toThrow()
    }, 'conn-1')
    expect(existsSync(join(outside, 'a.txt'))).toBe(false)
    expect(existsSync(join(outside, 'download', 'a.txt'))).toBe(false)
  })

  it('lands in the zone for a caller that names the connection itself, with no tool call in flight', () => {
    // A page-triggered download is captured by an event handler, outside any
    // tool call scope; the capture knows the driver and says so explicitly.
    expect(resolveDownloadDir(null, 's1', { connectionId: 'conn-1' })).toBe(producerDir('s1', 'download'))
    expect(resolveDownloadDir(null, 's1', { connectionId: null })).toBe(state.osDownloads)
    // And the directory it creates is marked for that node, event handler or not.
    reserveDownloadPath('a.bin', null, 's1', { connectionId: 'conn-1' })
    expect(readFileSync(join(root, 'sync', 's1', '.owner'), 'utf8')).toBe('conn-1')
  })

  it('registers a zone file it is asked to adopt instead of copying it again', async () => {
    // A download captured straight into the zone needs no copy; it still
    // needs a ref, or the listing reply is not rewritten to the node path.
    const zoneDir = producerDir('s1', 'download')
    mkdirSync(zoneDir, { recursive: true })
    const path = join(zoneDir, 'export.csv')
    writeFileSync(path, 'captured into the zone')
    const reported = await collectArtifacts('s1', 'call-11', async () => adoptCapturedDownload('s1', path), 'conn-1')
    expect(reported).toBe(path)
    expect(takeArtifacts('s1', 'call-11')).toEqual([{ path, producer: 'download', final: true, deliveryId: expect.any(String) }])
  })

  it('leaves a local session downloading into the configured folder', async () => {
    state.configuredDir = join(root, 'custom')
    const path = await collectArtifacts('s1', 'call-4', async () => reserveDownloadPath('a.txt', null, 's1'))
    expect(path).toBe(join(root, 'custom', 'a.txt'))
  })
})
